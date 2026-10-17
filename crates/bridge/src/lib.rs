//! The YandexMusicSync core, run for a player in another process.
//!
//! The patched Yandex Music app starts this as a child and talks to it over
//! stdin and stdout (see [`protocol`]). Everything that makes a room work вЂ” the
//! relay link, the shared clock, the queue, В«РњРѕСЏ РІРѕР»РЅР°В» and its feedback to
//! Yandex вЂ” is the core's engine; the [`Playback`] it drives is a
//! [`remote::RemotePlayback`] that steers the app's own player.
//!
//! [`Playback`]: ymsync::playback::Playback

#![forbid(unsafe_code)]

pub mod protocol;
pub mod remote;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::{mpsc, watch};
use tracing::{debug, info, warn};
use ymsync::api::YandexMusic;
use ymsync::config::{CacheConfig, Config, HostConfig, ShareConfig};
use ymsync::engine::{Command, Snapshot, WaveFeedbackKind};
use ymsync::session;

use crate::protocol::{FeedbackKind, Input, Output, SessionState, StartConfig, UiCommand};
use crate::remote::RemotePlayback;

/// Snapshots change on every engine tick, mostly because the playhead moved. The
/// panel needs a few a second; anything that changes the queue goes out at once.
const SNAPSHOT_EVERY: Duration = Duration::from_millis(250);

/// Waits between reconnect attempts, growing to the last value.
const BACKOFF: [Duration; 4] = [
    Duration::from_secs(1),
    Duration::from_secs(3),
    Duration::from_secs(7),
    Duration::from_secs(15),
];

/// Runs until `input` closes or says `quit`.
pub async fn run<R, W>(input: R, output: W) -> Result<()>
where
    R: AsyncBufRead + Unpin,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let (out_tx, out_rx) = mpsc::unbounded_channel::<Output>();
    let writer = tokio::spawn(write_lines(out_rx, output));

    let (op_tx, mut op_rx) = mpsc::unbounded_channel();
    let player = Arc::new(RemotePlayback::new(op_tx));
    {
        let out = out_tx.clone();
        tokio::spawn(async move {
            while let Some(op) = op_rx.recv().await {
                let _ = out.send(Output::Player { op });
            }
        });
    }

    let (wanted_tx, wanted_rx) = watch::channel::<Option<StartConfig>>(None);
    let (command_tx, command_rx) = mpsc::unbounded_channel::<Command>();
    let supervisor = tokio::spawn(supervise(
        wanted_rx,
        command_rx,
        Arc::clone(&player),
        out_tx.clone(),
    ));

    let mut reports = 0u64;
    let mut lines = input.lines();
    while let Some(line) = lines.next_line().await.context("reading stdin")? {
        if line.trim().is_empty() {
            continue;
        }
        let message: Input = match serde_json::from_str(&line) {
            Ok(message) => message,
            Err(err) => {
                warn!("РЅРµРїРѕРЅСЏС‚РЅР°СЏ СЃС‚СЂРѕРєР° РѕС‚ РјРѕРґР°: {err}");
                continue;
            }
        };
        match message {
            Input::Start { config } => {
                let _ = wanted_tx.send(Some(config));
            }
            Input::Stop => {
                let _ = wanted_tx.send(None);
            }
            Input::Quit => break,
            Input::Command { command } => {
                let _ = command_tx.send(engine_command(command));
            }
            Input::Player { state } => {
                reports += 1;
                if reports % 25 == 1 {
                    debug!(reports, ?state, "player report");
                }
                player.report(state)
            }
            Input::Loaded { result } => player.loaded(result),
        }
    }

    // Leaving: the supervisor says goodbye to the room before we go.
    let _ = wanted_tx.send(None);
    drop(wanted_tx);
    let _ = tokio::time::timeout(Duration::from_secs(3), supervisor).await;
    drop(out_tx);
    let _ = tokio::time::timeout(Duration::from_secs(1), writer).await;
    Ok(())
}

async fn write_lines<W: AsyncWrite + Unpin>(mut rx: mpsc::UnboundedReceiver<Output>, mut output: W) {
    while let Some(message) = rx.recv().await {
        let Ok(mut line) = serde_json::to_vec(&message) else {
            continue;
        };
        line.push(b'\n');
        if output.write_all(&line).await.is_err() || output.flush().await.is_err() {
            return;
        }
    }
}

/// The mod's command, as the engine knows it.
pub fn engine_command(command: UiCommand) -> Command {
    match command {
        UiCommand::Toggle => Command::TogglePause,
        UiCommand::Next => Command::Next,
        UiCommand::Prev => Command::Prev,
        UiCommand::Seek { ms } => Command::SeekTo(ms),
        UiCommand::Index { index } => Command::PlayIndex(index),
        UiCommand::SetQueue { tracks, start } => Command::SetQueue { tracks, start },
        UiCommand::Enqueue { tracks } => Command::Enqueue { tracks },
        UiCommand::PlayNext { tracks } => Command::PlayNext { tracks },
        UiCommand::Wave { seeds } => Command::PlayWave { seeds },
        UiCommand::WaveFeedback { kind, track_id } => Command::WaveFeedback {
            track_id,
            kind: match kind {
                FeedbackKind::Like => WaveFeedbackKind::Like,
                FeedbackKind::Unlike => WaveFeedbackKind::Unlike,
                FeedbackKind::Dislike => WaveFeedbackKind::Dislike,
                FeedbackKind::Undislike => WaveFeedbackKind::Undislike,
            },
        },
        UiCommand::StopWave => Command::StopStation,
        UiCommand::Repeat { mode } => Command::SetRepeat(mode),
        UiCommand::Shuffle { on } => Command::SetShuffle(on),
        UiCommand::Name { name } => Command::SetName(name),
        UiCommand::Like { track, liked } => Command::Like { track, liked },
    }
}

/// The core's configuration for one session.
pub fn core_config(start: &StartConfig) -> Config {
    let data = PathBuf::from(&start.data_dir);
    let mut cfg = Config {
        relay: start.relay.trim().to_string(),
        room: start.room.trim().to_string(),
        room_token: start.password.trim().to_string(),
        yandex_token: start.yandex_token.trim().to_string(),
        name: start.name.trim().to_string(),
        volume: 1.0,
        cache: CacheConfig {
            dir: data.join("tracks").to_string_lossy().to_string(),
            limit_gb: 1.0,
            auto: false,
        },
        // The app streams by itself, so there is nothing of ours to offer the
        // others over the local network.
        share: ShareConfig {
            enabled: false,
            port: 0,
        },
        host: HostConfig {
            enabled: start.host,
            port: start.host_port,
            advertise: start.advertise.trim().to_string(),
            ..HostConfig::default()
        },
        ..Config::default()
    };
    cfg.sync.position_bias_ms = start.position_bias_ms;
    cfg
}

/// Keeps a session running for as long as one is wanted, reconnecting when it
/// drops, and replacing it when the wanted configuration changes.
async fn supervise(
    mut wanted: watch::Receiver<Option<StartConfig>>,
    mut commands: mpsc::UnboundedReceiver<Command>,
    player: Arc<RemotePlayback>,
    out: mpsc::UnboundedSender<Output>,
) {
    let status = |state, error: Option<String>| {
        let _ = out.send(Output::Status { state, error });
    };
    let mut attempt = 0usize;

    loop {
        let Some(start) = wanted.borrow_and_update().clone() else {
            // Nothing wanted: drop stale commands and wait.
            while commands.try_recv().is_ok() {}
            if wanted.changed().await.is_err() {
                return;
            }
            continue;
        };

        status(
            if attempt == 0 {
                SessionState::Connecting
            } else {
                SessionState::Reconnecting
            },
            None,
        );
        player.reset();

        let started = start_session(&start, Arc::clone(&player)).await;
        let session = match started {
            Ok(session) => session,
            Err(err) => {
                let message = format!("{err:#}");
                warn!("РЅРµ СѓРґР°Р»РѕСЃСЊ РїРѕРґРєР»СЋС‡РёС‚СЊСЃСЏ: {message}");
                status(SessionState::Reconnecting, Some(message));
                let wait = BACKOFF[attempt.min(BACKOFF.len() - 1)];
                attempt += 1;
                tokio::select! {
                    _ = tokio::time::sleep(wait) => {}
                    changed = wanted.changed() => {
                        if changed.is_err() { return; }
                        attempt = 0;
                    }
                }
                continue;
            }
        };
        attempt = 0;
        status(SessionState::Connected, None);
        info!(room = %start.room, "РІ РєРѕРјРЅР°С‚Рµ");

        let mut snapshots = session.handle().subscribe();
        let mut last_sent = tokio::time::Instant::now() - SNAPSHOT_EVERY;
        let mut last_revision = None;
        let mut pending = false;
        let mut tick = tokio::time::interval(SNAPSHOT_EVERY);

        // Why the session ended: the mod asked, or the connection died.
        let asked = loop {
            tokio::select! {
                changed = wanted.changed() => {
                    if changed.is_err() {
                        break true;
                    }
                    if wanted.borrow().as_ref() != Some(&start) {
                        break true;
                    }
                    // The same room asked for again: a reloaded window, which has to
                    // hear where it is rather than wait for a change that will not come.
                    status(SessionState::Connected, None);
                    last_sent = tokio::time::Instant::now();
                    send_snapshot(&out, &snapshots.borrow().clone());
                    // Its player starts out empty: give it the track again. After the
                    // snapshot, so the window already knows the queue it belongs to.
                    player.restage();
                }
                command = commands.recv() => match command {
                    Some(command) => session.handle().send(command),
                    None => break true,
                },
                changed = snapshots.changed() => {
                    if changed.is_err() {
                        break false;
                    }
                    let snapshot = snapshots.borrow_and_update().clone();
                    let queue_moved = last_revision != Some(snapshot.queue_revision);
                    if queue_moved || last_sent.elapsed() >= SNAPSHOT_EVERY {
                        last_revision = Some(snapshot.queue_revision);
                        last_sent = tokio::time::Instant::now();
                        pending = false;
                        send_snapshot(&out, &snapshot);
                    } else {
                        pending = true;
                    }
                }
                _ = tick.tick() => {
                    if pending {
                        pending = false;
                        last_sent = tokio::time::Instant::now();
                        send_snapshot(&out, &snapshots.borrow().clone());
                    }
                }
            }
        };

        let outcome = session.shutdown().await;
        if asked {
            debug!("СЃРµСЃСЃРёСЏ Р·Р°РєСЂС‹С‚Р° РїРѕ Р·Р°РїСЂРѕСЃСѓ");
            status(SessionState::Stopped, None);
            continue;
        }
        let message = match outcome {
            Ok(()) => "СЃРѕРµРґРёРЅРµРЅРёРµ СЃ РєРѕРјРЅР°С‚РѕР№ Р·Р°РєСЂС‹Р»РѕСЃСЊ".to_string(),
            Err(err) => format!("{err:#}"),
        };
        warn!("СЃРµСЃСЃРёСЏ РѕР±РѕСЂРІР°Р»Р°СЃСЊ: {message}");
        status(SessionState::Reconnecting, Some(message));
        tokio::select! {
            _ = tokio::time::sleep(BACKOFF[0]) => {}
            changed = wanted.changed() => if changed.is_err() { return; },
        }
    }
}

fn send_snapshot(out: &mpsc::UnboundedSender<Output>, snapshot: &Snapshot) {
    let Ok(mut value) = serde_json::to_value(snapshot) else {
        return;
    };
    if let Some(map) = value.as_object_mut() {
        map.remove("cached");
        map.remove("on_lan");
    }
    let _ = out.send(Output::Snapshot { snapshot: value });
}

async fn start_session(start: &StartConfig, player: Arc<RemotePlayback>) -> Result<session::Session> {
    let cfg = core_config(start);
    let api = match cfg.yandex_token.as_str() {
        "" => None,
        token => Some(Arc::new(YandexMusic::new(token)?)),
    };
    let cache = session::open_cache(&cfg)?;
    let likes = session::open_likes(&cache);
    session::start(&cfg, api, player, cache, likes).await
}
