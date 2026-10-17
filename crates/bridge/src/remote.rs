//! A [`Playback`] whose audio comes out of another process.
//!
//! The Yandex Music app plays; this only says what it should be doing. Every call
//! the engine makes becomes an instruction on the way out ([`PlayerOp`]), and the
//! app reports back where its playhead is ([`PlayerReport`]) several times a
//! second. Between reports the position is extrapolated, the same way the room's
//! own anchor is: a playing player moves on by itself.
//!
//! Three things are kept apart here, because mixing them up was the bug where
//! the panel showed one track while another played: the track the engine
//! *staged*, whether the app *confirmed* it, and what the app *reports* it is on
//! now. The app's player can move to another track by itself, and until it is
//! put back nothing the engine says may be applied to it.
//!
//! [`Playback::load`] is the one call that waits. The engine treats a track as
//! staged — and tells the room it is ready to start — once `load` returns, and
//! with a streaming player in another process that is only true once that player
//! says so.

use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Result, bail};
use tokio::sync::mpsc;
use ymsync::playback::{AudioSource, Playback};
use ymsync_proto::TrackRef;

use crate::protocol::{LoadReport, PlayerOp, PlayerReport};

/// How long the app gets to start loading a track before the engine is told it
/// failed — and, as with any failed load, tries again a little later.
pub const LOAD_TIMEOUT: Duration = Duration::from_secs(15);

/// A report older than this says nothing reliable about a playing player: the
/// window may be frozen, or the renderer reloading. Position is then held, not
/// extrapolated into the future, and the engine stops steering.
const STALE_REPORT: Duration = Duration::from_secs(2);

/// How long the app has to report another track of the room's queue before
/// the staged one counts as lost. Long enough for a report that was already on
/// its way when the track changed, short enough to be put right within a beat.
const LOST_AFTER: Duration = Duration::from_millis(600);

#[derive(Debug, Default)]
struct State {
    /// What the engine asked for last. The engine's idea of "staged".
    staged: Option<TrackRef>,
    /// The app's answer to the last load: `Some(Ok)` once it has the track.
    load: Option<(String, Result<(), String>)>,
    /// Which track the app says its player is on.
    reported_track: Option<String>,
    /// Whether that track is on the room's queue rather than one the listener
    /// just started.
    reported_ours: bool,
    /// When the app last said anything about its player.
    reported_at: Option<Instant>,
    /// Since when the app has said it is on another track of the room's queue
    /// than the staged one, after it confirmed the staged one.
    off_since: Option<Instant>,
    /// The app has reported since it confirmed the last load. Until it has,
    /// the position held here is the previous track's — steering by it seeked
    /// a freshly started track to where the old one ended.
    heard_since_load: bool,
    position_ms: f64,
    playing: bool,
    ended: bool,
    /// When `position_ms` was true.
    at: Option<Instant>,
    volume: f32,
    /// The speed the app was last told to play at; 1.0 is normal.
    rate: f64,
}

pub struct RemotePlayback {
    ops: mpsc::UnboundedSender<PlayerOp>,
    state: Mutex<State>,
    loaded: Condvar,
    load_timeout: Duration,
}

impl RemotePlayback {
    pub fn new(ops: mpsc::UnboundedSender<PlayerOp>) -> Self {
        Self::with_timeout(ops, LOAD_TIMEOUT)
    }

    pub fn with_timeout(ops: mpsc::UnboundedSender<PlayerOp>, load_timeout: Duration) -> Self {
        Self {
            ops,
            state: Mutex::new(State {
                volume: 1.0,
                rate: 1.0,
                heard_since_load: true,
                ..State::default()
            }),
            loaded: Condvar::new(),
            load_timeout,
        }
    }

    /// Forgets the staged track, for a new session, and puts the speed back to
    /// normal: the new session's engine starts out assuming it is.
    pub fn reset(&self) {
        let mut state = self.state.lock().expect("player state");
        state.staged = None;
        state.load = None;
        state.off_since = None;
        if state.rate != 1.0 {
            state.rate = 1.0;
            drop(state);
            self.send(PlayerOp::Rate { rate: 1.0 });
        }
    }

    /// Sends the staged track to the app again — for a window that reloaded and
    /// lost it. The engine is not involved: as far as it knows, the track never
    /// left, and the app's answer is taken like any other.
    pub fn restage(&self) {
        let staged = self.state.lock().expect("player state").staged.clone();
        if let Some(track) = staged {
            self.send(PlayerOp::Load { track });
        }
    }

    /// Where the app's player is, as it just said.
    pub fn report(&self, report: PlayerReport) {
        let now = Instant::now();
        let mut state = self.state.lock().expect("player state");
        let off = match (&state.staged, &report.track_id) {
            (Some(staged), Some(reported)) => report.ours && *reported != staged.track_id,
            _ => false,
        };
        state.off_since = if off { state.off_since.or(Some(now)) } else { None };
        state.reported_track = report.track_id;
        state.reported_ours = report.ours;
        state.reported_at = Some(now);
        state.heard_since_load = true;
        state.position_ms = report.position_ms.max(0.0);
        state.playing = report.playing;
        state.ended = report.ended;
        state.at = Some(now);
    }

    /// The app's answer to a [`PlayerOp::Load`].
    pub fn loaded(&self, report: LoadReport) {
        let mut state = self.state.lock().expect("player state");
        let wanted = state.staged.as_ref().map(|t| t.track_id.as_str());
        if wanted != Some(report.track_id.as_str()) {
            // An answer to a load the engine has already moved on from.
            return;
        }
        let result = if report.ok {
            // The app is on it now, whatever its last report said: that report
            // was sent before the track changed.
            state.reported_track = Some(report.track_id.clone());
            state.reported_ours = true;
            state.off_since = None;
            state.heard_since_load = false;
            Ok(())
        } else {
            Err(report
                .error
                .unwrap_or_else(|| "плеер Яндекс Музыки не смог поставить трек".to_string()))
        };
        state.load = Some((report.track_id, result));
        self.loaded.notify_all();
    }

    fn on_staged(state: &State) -> bool {
        match (&state.staged, &state.reported_track) {
            (Some(staged), Some(reported)) => &staged.track_id == reported,
            _ => false,
        }
    }

    fn fresh(state: &State) -> bool {
        state.reported_at.is_some_and(|at| at.elapsed() < STALE_REPORT)
    }

    /// The staged track's id, for the instructions that act on it.
    fn staged_id(&self) -> Option<String> {
        let state = self.state.lock().expect("player state");
        state.staged.as_ref().map(|t| t.track_id.clone())
    }

    fn current_position(state: &State) -> f64 {
        let Some(at) = state.at else {
            return state.position_ms;
        };
        let elapsed = at.elapsed();
        if state.playing && elapsed < STALE_REPORT {
            state.position_ms + elapsed.as_secs_f64() * 1000.0 * state.rate
        } else {
            state.position_ms
        }
    }

    fn send(&self, op: PlayerOp) {
        let _ = self.ops.send(op);
    }
}

impl Playback for RemotePlayback {
    fn needs_bytes(&self) -> bool {
        false
    }

    fn plays_by_id(&self) -> bool {
        true
    }

    fn load(&self, track: TrackRef, _source: AudioSource) -> Result<()> {
        let id = track.track_id.clone();
        {
            let mut state = self.state.lock().expect("player state");
            state.staged = Some(track.clone());
            state.load = None;
            state.off_since = None;
            state.playing = false;
            state.position_ms = 0.0;
            state.at = Some(Instant::now());
        }
        // The app plays by track id from its own account.
        self.send(PlayerOp::Load { track });

        let wait = || {
            let state = self.state.lock().expect("player state");
            let (state, timeout) = self
                .loaded
                .wait_timeout_while(state, self.load_timeout, |state| {
                    !matches!(&state.load, Some((loaded, _)) if *loaded == id)
                        && state.staged.as_ref().map(|t| &t.track_id) == Some(&id)
                })
                .expect("player state");
            if timeout.timed_out() {
                return Err(format!(
                    "плеер Яндекс Музыки не взял трек за {} с",
                    self.load_timeout.as_secs()
                ));
            }
            match &state.load {
                Some((loaded, result)) if *loaded == id => result.clone(),
                // Superseded by a newer load while waiting.
                _ => Err("загрузка трека отменена".to_string()),
            }
        };
        // The engine calls this from its own tasks; waiting is fine as long as the
        // runtime is told, so it can move other work off this thread meanwhile.
        let outcome = match tokio::runtime::Handle::try_current() {
            Ok(handle) if handle.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread => {
                tokio::task::block_in_place(wait)
            }
            _ => wait(),
        };
        match outcome {
            Ok(()) => Ok(()),
            Err(message) => {
                let mut state = self.state.lock().expect("player state");
                if state.staged.as_ref().map(|t| &t.track_id) == Some(&id) {
                    state.staged = None;
                }
                bail!(message)
            }
        }
    }

    fn play(&self) {
        {
            let mut state = self.state.lock().expect("player state");
            let position = Self::current_position(&state);
            state.position_ms = position;
            state.playing = true;
            state.at = Some(Instant::now());
        }
        let track_id = self.staged_id();
        self.send(PlayerOp::Play { track_id });
    }

    fn pause(&self) {
        {
            let mut state = self.state.lock().expect("player state");
            if !state.playing {
                return;
            }
            let position = Self::current_position(&state);
            state.position_ms = position;
            state.playing = false;
            state.at = Some(Instant::now());
        }
        let track_id = self.staged_id();
        self.send(PlayerOp::Pause { track_id });
    }

    fn seek_ms(&self, ms: u64) -> Result<()> {
        {
            let mut state = self.state.lock().expect("player state");
            state.position_ms = ms as f64;
            state.at = Some(Instant::now());
        }
        let track_id = self.staged_id();
        self.send(PlayerOp::Seek { ms, track_id });
        Ok(())
    }

    fn position_ms(&self) -> u64 {
        let state = self.state.lock().expect("player state");
        if !Self::on_staged(&state) {
            return 0;
        }
        Self::current_position(&state) as u64
    }

    fn is_playing(&self) -> bool {
        let state = self.state.lock().expect("player state");
        Self::on_staged(&state) && state.playing
    }

    fn is_finished(&self) -> bool {
        let state = self.state.lock().expect("player state");
        state.staged.is_none() || (Self::on_staged(&state) && state.ended)
    }

    fn current_track_id(&self) -> Option<String> {
        let state = self.state.lock().expect("player state");
        state.staged.as_ref().map(|t| t.track_id.clone())
    }

    fn playing_track_id(&self) -> Option<String> {
        let state = self.state.lock().expect("player state");
        if Self::fresh(&state) {
            state.reported_track.clone()
        } else {
            state.staged.as_ref().map(|t| t.track_id.clone())
        }
    }

    fn lost_track(&self) -> bool {
        let state = self.state.lock().expect("player state");
        let Some(staged) = state.staged.as_ref() else {
            return false;
        };
        // Until the app has confirmed the track it is still on its way there.
        let confirmed = matches!(&state.load, Some((id, Ok(()))) if *id == staged.track_id);
        confirmed
            && Self::fresh(&state)
            && state.off_since.is_some_and(|since| since.elapsed() >= LOST_AFTER)
    }

    fn is_live(&self) -> bool {
        let state = self.state.lock().expect("player state");
        Self::fresh(&state) && state.heard_since_load
    }

    fn supports_rate(&self) -> bool {
        true
    }

    fn set_rate(&self, rate: f32) {
        {
            let mut state = self.state.lock().expect("player state");
            // The estimate so far ran at the old speed; from here on, the new one.
            let position = Self::current_position(&state);
            state.position_ms = position;
            state.at = Some(Instant::now());
            state.rate = f64::from(rate);
        }
        self.send(PlayerOp::Rate { rate });
    }

    fn set_volume(&self, volume: f32) {
        self.state.lock().expect("player state").volume = volume;
    }

    fn volume(&self) -> f32 {
        self.state.lock().expect("player state").volume
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn track(id: &str) -> TrackRef {
        TrackRef {
            track_id: id.to_string(),
            album_id: None,
            album: None,
            title: format!("Title {id}"),
            artist: "Artist".to_string(),
            duration_ms: 200_000,
            cover_uri: None,
        }
    }

    fn player(timeout: Duration) -> (Arc<RemotePlayback>, mpsc::UnboundedReceiver<PlayerOp>) {
        let (tx, rx) = mpsc::unbounded_channel();
        (Arc::new(RemotePlayback::with_timeout(tx, timeout)), rx)
    }

    fn url() -> AudioSource {
        AudioSource::Url("https://example/track.mp3".to_string())
    }

    /// The engine must not think a track is ready before the app has it: that is
    /// what would make the room start while one listener is still buffering.
    #[test]
    fn a_load_waits_for_the_app_to_confirm() {
        let (player, mut ops) = player(Duration::from_secs(5));
        let worker = {
            let player = Arc::clone(&player);
            std::thread::spawn(move || player.load(track("1"), url()))
        };
        // The instruction goes out at once, and the call is still waiting.
        let op = loop {
            if let Ok(op) = ops.try_recv() {
                break op;
            }
            std::thread::sleep(Duration::from_millis(5));
        };
        assert!(matches!(op, PlayerOp::Load { ref track } if track.track_id == "1"));
        assert!(!worker.is_finished());

        player.loaded(LoadReport {
            track_id: "1".to_string(),
            ok: true,
            error: None,
        });
        worker.join().unwrap().expect("loaded");
        assert_eq!(player.current_track_id().as_deref(), Some("1"));
    }

    #[test]
    fn a_refused_load_is_an_error_and_leaves_nothing_staged() {
        let (player, _ops) = player(Duration::from_secs(5));
        let worker = {
            let player = Arc::clone(&player);
            std::thread::spawn(move || player.load(track("1"), url()))
        };
        while player.current_track_id().is_none() {
            std::thread::sleep(Duration::from_millis(5));
        }
        player.loaded(LoadReport {
            track_id: "1".to_string(),
            ok: false,
            error: Some("трек недоступен".to_string()),
        });
        let err = worker.join().unwrap().expect_err("refused");
        assert!(err.to_string().contains("недоступен"), "{err}");
        assert_eq!(player.current_track_id(), None);
    }

    #[test]
    fn a_silent_app_times_out() {
        let (player, _ops) = player(Duration::from_millis(50));
        let err = player.load(track("1"), url()).expect_err("no answer");
        assert!(err.to_string().contains("не взял трек"), "{err}");
        assert_eq!(player.current_track_id(), None);
    }

    /// An answer for a track the engine is no longer loading must not satisfy
    /// the load that replaced it.
    #[test]
    fn a_late_answer_for_an_old_track_is_ignored() {
        let (player, _ops) = player(Duration::from_millis(100));
        player.state.lock().unwrap().staged = Some(track("2"));
        player.loaded(LoadReport {
            track_id: "1".to_string(),
            ok: true,
            error: None,
        });
        assert!(player.state.lock().unwrap().load.is_none());
    }

    #[test]
    fn the_position_runs_on_between_reports_while_playing() {
        let (player, _ops) = player(Duration::from_secs(1));
        player.state.lock().unwrap().staged = Some(track("1"));
        player.report(PlayerReport {
            track_id: Some("1".to_string()),
            position_ms: 10_000.0,
            playing: true,
            ended: false,
            ours: true,
        });
        std::thread::sleep(Duration::from_millis(60));
        let position = player.position_ms();
        assert!((10_050..10_500).contains(&position), "{position}");
        assert!(player.is_playing());

        player.report(PlayerReport {
            track_id: Some("1".to_string()),
            position_ms: 20_000.0,
            playing: false,
            ended: false,
            ours: true,
        });
        std::thread::sleep(Duration::from_millis(30));
        assert_eq!(player.position_ms(), 20_000, "a paused player stays put");
        assert!(!player.is_playing());
    }

    /// While the app is still on another track, nothing it says about its
    /// playhead applies to the staged one.
    #[test]
    fn reports_about_another_track_do_not_count() {
        let (player, _ops) = player(Duration::from_secs(1));
        player.state.lock().unwrap().staged = Some(track("2"));
        player.report(PlayerReport {
            track_id: Some("1".to_string()),
            position_ms: 90_000.0,
            playing: true,
            ended: true,
            ours: true,
        });
        assert_eq!(player.position_ms(), 0);
        assert!(!player.is_playing());
        assert!(!player.is_finished());
    }

    /// A reloaded window is handed the track again; nothing else changes.
    #[test]
    fn restaging_resends_the_staged_track() {
        let (player, mut ops) = player(Duration::from_secs(1));
        player.restage();
        assert!(ops.try_recv().is_err(), "nothing staged, nothing to send");
        player.state.lock().unwrap().staged = Some(track("7"));
        player.restage();
        assert!(matches!(ops.try_recv(), Ok(PlayerOp::Load { track }) if track.track_id == "7"));
        assert_eq!(player.current_track_id().as_deref(), Some("7"));
    }

    /// The position estimate runs at the speed the app was told to play at.
    #[test]
    fn a_slower_speed_slows_the_estimate_and_goes_out() {
        let (player, mut ops) = player(Duration::from_secs(1));
        player.state.lock().unwrap().staged = Some(track("1"));
        player.report(PlayerReport {
            track_id: Some("1".to_string()),
            position_ms: 10_000.0,
            playing: true,
            ended: false,
            ours: true,
        });
        player.set_rate(0.5);
        assert!(matches!(ops.try_recv(), Ok(PlayerOp::Rate { rate }) if rate == 0.5));
        std::thread::sleep(Duration::from_millis(200));
        let position = player.position_ms();
        // 200 ms at half speed is 100 ms of track, give or take the scheduler.
        assert!((10_080..10_160).contains(&position), "{position}");

        // A new session starts at normal speed, and the app is told so.
        player.reset();
        assert!(matches!(ops.try_recv(), Ok(PlayerOp::Rate { rate }) if rate == 1.0));
        player.reset();
        assert!(ops.try_recv().is_err(), "already normal: nothing to say");
    }

    #[test]
    fn commands_go_out_and_move_the_local_estimate() {
        let (player, mut ops) = player(Duration::from_secs(1));
        player.state.lock().unwrap().staged = Some(track("1"));
        player.seek_ms(42_000).unwrap();
        player.play();
        player.pause();
        // Pausing an already paused player says nothing.
        player.pause();
        let sent: Vec<PlayerOp> = std::iter::from_fn(|| ops.try_recv().ok()).collect();
        assert!(matches!(
            &sent[..],
            [PlayerOp::Seek { ms: 42_000, track_id: Some(a) }, PlayerOp::Play { track_id: Some(b) }, PlayerOp::Pause { .. }]
                if a == "1" && b == "1"
        ));
    }

    fn report(track_id: &str, position_ms: f64, ours: bool) -> PlayerReport {
        PlayerReport {
            track_id: Some(track_id.to_string()),
            position_ms,
            playing: true,
            ended: false,
            ours,
        }
    }

    /// Stages a track and has the app confirm it, as a finished load leaves it.
    fn confirmed(player: &RemotePlayback, id: &str) {
        player.state.lock().unwrap().staged = Some(track(id));
        player.loaded(LoadReport {
            track_id: id.to_string(),
            ok: true,
            error: None,
        });
    }

    /// The app moving to another track of the room's queue by itself is the
    /// moment everything the engine says starts landing on the wrong track. It
    /// has to be noticed — after a moment, since a report already on its way
    /// may still name the old one.
    #[test]
    fn a_player_that_moves_on_by_itself_has_lost_the_staged_track() {
        let (player, _ops) = player(Duration::from_secs(1));
        confirmed(&player, "1");
        player.report(report("1", 5_000.0, true));
        assert!(!player.lost_track());

        player.report(report("2", 100.0, true));
        assert!(!player.lost_track(), "one report is not yet a verdict");
        assert_eq!(player.playing_track_id().as_deref(), Some("2"));
        assert_eq!(player.current_track_id().as_deref(), Some("1"), "staged is still what the engine asked for");
        assert!(!player.is_playing(), "it does not play the staged track");

        std::thread::sleep(LOST_AFTER + Duration::from_millis(50));
        player.report(report("2", 800.0, true));
        assert!(player.lost_track());

        // Back on it: found again.
        player.report(report("1", 5_900.0, true));
        assert!(!player.lost_track());
    }

    /// Something the listener started in the app is about to become the room's
    /// queue; pulling the player back to the room's track would undo it.
    #[test]
    fn a_track_the_listener_started_is_not_a_lost_track() {
        let (player, _ops) = player(Duration::from_secs(1));
        confirmed(&player, "1");
        player.report(report("99", 0.0, false));
        std::thread::sleep(LOST_AFTER + Duration::from_millis(50));
        player.report(report("99", 700.0, false));
        assert!(!player.lost_track());
    }

    /// While the app is still on its way to a track, the old one in its reports
    /// is expected, not a sign of anything.
    #[test]
    fn before_the_app_confirms_a_load_the_old_track_does_not_count_as_lost() {
        let (player, _ops) = player(Duration::from_secs(1));
        player.state.lock().unwrap().staged = Some(track("2"));
        player.report(report("1", 179_000.0, true));
        std::thread::sleep(LOST_AFTER + Duration::from_millis(50));
        player.report(report("1", 179_600.0, true));
        assert!(!player.lost_track());

        // The confirmation outranks the report sent before it.
        player.loaded(LoadReport {
            track_id: "2".to_string(),
            ok: true,
            error: None,
        });
        assert!(!player.lost_track());
        assert_eq!(player.playing_track_id().as_deref(), Some("2"));
    }

    /// A window that stopped reporting is neither playing nor paused as far as
    /// anybody knows, and the engine must not steer it on a guess.
    #[test]
    fn an_app_that_stops_reporting_is_not_live() {
        let (player, _ops) = player(Duration::from_secs(1));
        assert!(!player.is_live(), "nothing heard yet");
        confirmed(&player, "1");
        player.report(report("1", 1_000.0, true));
        assert!(player.is_live());
        std::thread::sleep(STALE_REPORT + Duration::from_millis(100));
        assert!(!player.is_live());
        assert!(!player.lost_track(), "a silent player has not lost anything it is known to");
        assert_eq!(player.playing_track_id().as_deref(), Some("1"));
    }

    /// The confirmation of a load comes before any report from the new track.
    /// Until one arrives, the playhead held here is the old track's, and the
    /// engine must not steer by it.
    #[test]
    fn after_a_load_the_player_is_not_steered_until_it_reports_again() {
        let (player, _ops) = player(Duration::from_secs(1));
        confirmed(&player, "1");
        player.report(report("1", 243_000.0, true));
        player.state.lock().unwrap().staged = Some(track("2"));
        player.loaded(LoadReport {
            track_id: "2".to_string(),
            ok: true,
            error: None,
        });
        assert!(!player.is_live(), "the old track's playhead is not the new one's");
        player.report(report("2", 120.0, true));
        assert!(player.is_live());
        assert!(player.position_ms() < 1_000);
    }
}
