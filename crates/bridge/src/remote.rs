//! A [`Playback`] whose audio comes out of another process.
//!
//! The Yandex Music app plays; this only says what it should be doing. Every call
//! the engine makes becomes an instruction on the way out ([`PlayerOp`]), and the
//! app reports back where its playhead is ([`PlayerReport`]) several times a
//! second. Between reports the position is extrapolated, the same way the room's
//! own anchor is: a playing player moves on by itself.
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
/// extrapolated into the future.
const STALE_REPORT: Duration = Duration::from_secs(2);

#[derive(Debug, Default)]
struct State {
    /// What the engine asked for last. The engine's idea of "staged".
    staged: Option<TrackRef>,
    /// The app's answer to the last load: `Some(Ok)` once it has the track.
    load: Option<(String, Result<(), String>)>,
    /// Which track the app says its player is on.
    reported_track: Option<String>,
    position_ms: f64,
    playing: bool,
    ended: bool,
    /// When `position_ms` was true.
    at: Option<Instant>,
    volume: f32,
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
                ..State::default()
            }),
            loaded: Condvar::new(),
            load_timeout,
        }
    }

    /// Forgets the staged track, for a new session.
    pub fn reset(&self) {
        let mut state = self.state.lock().expect("player state");
        state.staged = None;
        state.load = None;
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
        let mut state = self.state.lock().expect("player state");
        state.reported_track = report.track_id;
        state.position_ms = report.position_ms.max(0.0);
        state.playing = report.playing;
        state.ended = report.ended;
        state.at = Some(Instant::now());
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

    fn current_position(state: &State) -> f64 {
        let Some(at) = state.at else {
            return state.position_ms;
        };
        let elapsed = at.elapsed();
        if state.playing && elapsed < STALE_REPORT {
            state.position_ms + elapsed.as_secs_f64() * 1000.0
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

    fn load(&self, track: TrackRef, _source: AudioSource) -> Result<()> {
        let id = track.track_id.clone();
        {
            let mut state = self.state.lock().expect("player state");
            state.staged = Some(track.clone());
            state.load = None;
            state.playing = false;
            state.position_ms = 0.0;
            state.at = Some(Instant::now());
        }
        // The app plays by track id from its own account; the source the engine
        // resolved is not needed beyond having proved the track is available.
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
        self.send(PlayerOp::Play);
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
        self.send(PlayerOp::Pause);
    }

    fn seek_ms(&self, ms: u64) -> Result<()> {
        {
            let mut state = self.state.lock().expect("player state");
            state.position_ms = ms as f64;
            state.at = Some(Instant::now());
        }
        self.send(PlayerOp::Seek { ms });
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
        assert!(matches!(sent[..], [PlayerOp::Seek { ms: 42_000 }, PlayerOp::Play, PlayerOp::Pause]));
    }
}
