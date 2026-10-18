//! One phone session: the engine, kept connected.
//!
//! The phone is always in a room. With a server configured it is that server's
//! room; without one it holds a room of its own, on loopback and invisible to
//! the network — the core has one path for both («hosting is also what offline
//! means», see `ymsync::session`), so listening alone needs nothing new.
//!
//! The connection is kept the way the bridge keeps it on the desktop: when it
//! drops, the session says «reconnecting» and tries again, backing off, until it
//! is back or Kotlin stops it.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::Value;
use tokio::sync::{mpsc, watch};
use tracing::{info, warn};
use ymsync::api::{Quality, TokenRejected, WavePreset, YandexMusic};
use ymsync::cache::Cache;
use ymsync::config::{CacheConfig, Config, HostConfig, ShareConfig};
use ymsync::engine::{Command, Snapshot};
use ymsync::likes::Likes;
use ymsync::link::RoomsError;
use ymsync::playback::Playback;
use ymsync::session as core;
use ymsync::ui::{UiCommand, engine_command};
use ymsync_proto::RoomListing;

/// Waits between reconnect attempts, growing to the last value — the bridge's.
const BACKOFF: [Duration; 4] = [
    Duration::from_secs(1),
    Duration::from_secs(3),
    Duration::from_secs(7),
    Duration::from_secs(15),
];

/// The name of the phone's own room when no server is configured. Nobody else
/// can see it, so it only has to be stable.
const SOLO_ROOM: &str = "телефон";

/// A server's room to join.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct RoomConfig {
    pub relay: String,
    pub room: String,
    pub password: String,
}

/// What Kotlin hands `start`, as JSON.
#[derive(Debug, Clone, Deserialize)]
pub struct StartConfig {
    /// The Yandex OAuth token; empty plays only what is on the phone.
    #[serde(default)]
    pub token: String,
    /// This installation's id, kept by the app; how the room knows its admin.
    #[serde(default)]
    pub client_id: String,
    /// An app-private directory: the only place the app may write unasked.
    pub data_dir: String,
    #[serde(default)]
    pub quality: Quality,
    #[serde(default)]
    pub name: String,
    /// `None`: the phone's own room.
    #[serde(default)]
    pub room: Option<RoomConfig>,
    /// Where the Yandex API is; empty for Yandex's own. For tests.
    #[serde(default)]
    pub api_base: String,
}

/// The core's configuration for this session.
fn core_config(start: &StartConfig) -> Config {
    let data = PathBuf::from(&start.data_dir);
    let (relay, room, token, host) = match &start.room {
        Some(room) => (
            room.relay.trim().to_string(),
            room.room.trim().to_string(),
            room.password.trim().to_string(),
            HostConfig::default(),
        ),
        None => (
            String::new(),
            SOLO_ROOM.to_string(),
            // Any secret will do for a room nobody else can reach; it only has
            // to be there, since a relay will not come up without one.
            format!("solo-{}", ymsync_proto::unix_ms()),
            HostConfig {
                enabled: true,
                bind: "127.0.0.1".to_string(),
                port: 0,
                advertise: "127.0.0.1".to_string(),
                discoverable: false,
            },
        ),
    };
    Config {
        relay,
        room,
        room_token: token,
        yandex_token: start.token.trim().to_string(),
        name: start.name.trim().to_string(),
        client_id: start.client_id.trim().to_string(),
        volume: 1.0,
        cache: CacheConfig {
            dir: data.join("tracks").to_string_lossy().to_string(),
            limit_gb: 1.0,
            auto: false,
        },
        // Nothing to offer the others over the Wi-Fi from a phone yet.
        share: ShareConfig {
            enabled: false,
            port: 0,
        },
        host,
        ..Config::default()
    }
}

fn api_for(start: &StartConfig) -> Result<Option<Arc<YandexMusic>>> {
    Ok(match (start.token.trim(), start.api_base.trim()) {
        ("", _) => None,
        (token, "") => Some(Arc::new(YandexMusic::new(token)?.with_quality(start.quality))),
        (token, base) => Some(Arc::new(YandexMusic::with_base(token, base)?.with_quality(start.quality))),
    })
}

/// What `snapshot` reads, written by the supervisor.
#[derive(Default)]
struct Shared {
    snapshot: Option<Snapshot>,
    status: &'static str,
    error: Option<String>,
    /// The queue revision Kotlin was last given; see [`Session::snapshot`].
    sent_revision: Option<u64>,
}

pub struct Session {
    runtime: tokio::runtime::Runtime,
    shared: Arc<Mutex<Shared>>,
    commands: mpsc::UnboundedSender<Command>,
    stop: watch::Sender<bool>,
    supervisor: tokio::task::JoinHandle<()>,
    api: Option<Arc<YandexMusic>>,
    likes: Arc<Likes>,
}

impl Session {
    /// Starts the session and returns at once; whether it is connected yet is in
    /// [`Session::snapshot`]'s `status`.
    pub fn start(start: StartConfig, player: Arc<dyn Playback>) -> Result<Self> {
        // `rustls` has no default provider in the phone's build, and the
        // WebSocket client picks one from the process, so this comes first.
        #[cfg(target_os = "android")]
        ymsync::install_tls_provider();
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("ymsync-rt")
            .enable_all()
            .build()
            .context("создание рантайма")?;
        let cfg = core_config(&start);
        let api = api_for(&start)?;
        let cache: Arc<Cache> = core::open_cache(&cfg)?;
        let likes = core::open_likes(&cache);

        let shared = Arc::new(Mutex::new(Shared {
            status: "connecting",
            ..Shared::default()
        }));
        let (commands, command_rx) = mpsc::unbounded_channel();
        let (stop, stop_rx) = watch::channel(false);
        let supervisor = runtime.spawn(supervise(
            cfg,
            api.clone(),
            player,
            cache,
            Arc::clone(&likes),
            Arc::clone(&shared),
            command_rx,
            stop_rx,
        ));
        Ok(Self {
            runtime,
            shared,
            commands,
            stop,
            supervisor,
            api,
            likes,
        })
    }

    /// What to draw: the engine's snapshot without the lists nobody draws, plus
    /// `status` (`connecting`, `connected`, `reconnecting`) and `error`.
    ///
    /// The queue goes out only when it changed since the last call: «Мне
    /// нравится» queued whole runs past a thousand tracks, and Kotlin asks four
    /// times a second. A snapshot without `queue` means «the one you have».
    pub fn snapshot(&self) -> Value {
        let mut shared = self.shared.lock().expect("session state");
        let mut value = match shared.snapshot.as_ref() {
            Some(snapshot) => serde_json::to_value(snapshot).unwrap_or_default(),
            None => serde_json::json!({ "connected": false }),
        };
        let revision = shared.snapshot.as_ref().map(|s| s.queue_revision);
        let known = revision.is_some() && shared.sent_revision == revision;
        shared.sent_revision = revision;
        if let Some(map) = value.as_object_mut() {
            map.remove("cached");
            map.remove("on_lan");
            if known {
                map.remove("queue");
            }
            map.insert("status".into(), Value::from(shared.status));
            map.insert("error".into(), shared.error.clone().map_or(Value::Null, Value::from));
        }
        value
    }

    pub fn command(&self, command: UiCommand) {
        let _ = self.commands.send(engine_command(command));
    }

    /// «Мне нравится», off the disk: drawn with no network, refreshed by the
    /// engine on connecting.
    pub fn likes(&self) -> Value {
        serde_json::json!({
            "tracks": self.likes.tracks().as_ref(),
            "updated_ms": self.likes.updated_ms(),
        })
    }

    fn api(&self) -> Result<&Arc<YandexMusic>> {
        self.api.as_ref().context("войдите в аккаунт Яндекса")
    }

    pub fn lyrics(&self, track_id: &str) -> Result<Value> {
        let api = self.api()?;
        let lyrics = self.runtime.block_on(api.lyrics(track_id.trim()))?;
        Ok(serde_json::to_value(lyrics)?)
    }

    pub fn wave_presets(&self) -> Result<Vec<WavePreset>> {
        let api = self.api()?;
        self.runtime.block_on(api.wave_presets())
    }

    /// Leaves the room and waits for the engine to say goodbye.
    pub fn stop(self) {
        let _ = self.stop.send(true);
        let supervisor = self.supervisor;
        let _ = self
            .runtime
            .block_on(async { tokio::time::timeout(Duration::from_secs(3), supervisor).await });
        self.runtime.shutdown_timeout(Duration::from_secs(1));
    }
}

fn set_status(shared: &Mutex<Shared>, status: &'static str, error: Option<String>) {
    let mut shared = shared.lock().expect("session state");
    shared.status = status;
    shared.error = error;
}

/// Keeps the session connected until `stop` says otherwise.
#[allow(clippy::too_many_arguments)]
async fn supervise(
    cfg: Config,
    api: Option<Arc<YandexMusic>>,
    player: Arc<dyn Playback>,
    cache: Arc<Cache>,
    likes: Arc<Likes>,
    shared: Arc<Mutex<Shared>>,
    mut commands: mpsc::UnboundedReceiver<Command>,
    mut stop: watch::Receiver<bool>,
) {
    let mut attempt = 0usize;
    loop {
        if *stop.borrow() {
            break;
        }
        // Whatever was pressed while there was no room is stale by now.
        while commands.try_recv().is_ok() {}
        let started = core::start(&cfg, api.clone(), Arc::clone(&player), Arc::clone(&cache), Arc::clone(&likes)).await;
        let session = match started {
            Ok(session) => session,
            Err(err) => {
                let message = format!("{err:#}");
                warn!("не удалось подключиться: {message}");
                set_status(&shared, "reconnecting", Some(message));
                let wait = BACKOFF[attempt.min(BACKOFF.len() - 1)];
                attempt += 1;
                tokio::select! {
                    _ = tokio::time::sleep(wait) => {}
                    _ = stop.changed() => {}
                }
                continue;
            }
        };
        attempt = 0;
        set_status(&shared, "connected", None);
        info!(room = %cfg.room, "в комнате");
        let mut snapshots = session.handle().subscribe();
        shared.lock().expect("session state").snapshot = Some(snapshots.borrow().clone());

        // Why it ended: asked to, or the connection died.
        let asked = loop {
            tokio::select! {
                _ = stop.changed() => break true,
                command = commands.recv() => match command {
                    Some(command) => session.handle().send(command),
                    None => break true,
                },
                changed = snapshots.changed() => {
                    if changed.is_err() {
                        break false;
                    }
                    let snapshot = snapshots.borrow_and_update().clone();
                    shared.lock().expect("session state").snapshot = Some(snapshot);
                }
            }
        };
        let outcome = session.shutdown().await;
        if asked {
            break;
        }
        let message = match outcome {
            Ok(()) => "соединение с комнатой закрылось".to_string(),
            Err(err) => format!("{err:#}"),
        };
        warn!("сессия оборвалась: {message}");
        set_status(&shared, "reconnecting", Some(message));
        tokio::select! {
            _ = tokio::time::sleep(BACKOFF[0]) => {}
            _ = stop.changed() => {}
        }
    }
    set_status(&shared, "stopped", None);
}

/// Why an account could not be read, with a code Kotlin acts on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccountError {
    /// `unauthorized`: the token is gone, sign in again. `network`: try later.
    pub code: &'static str,
    pub message: String,
}

/// Who the token belongs to: `{login, display_name, plus}`.
pub fn account(token: &str) -> Result<Value, AccountError> {
    account_at(token, "")
}

/// [`account`] against an API somewhere else; empty is Yandex's own.
pub fn account_at(token: &str, base: &str) -> Result<Value, AccountError> {
    let network = |message: String| AccountError {
        code: "network",
        message,
    };
    let api = match base.trim() {
        "" => YandexMusic::new(token.trim()),
        base => YandexMusic::with_base(token.trim(), base),
    }
    .map_err(|err| network(format!("{err:#}")))?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|err| network(err.to_string()))?;
    match runtime.block_on(api.account_status()) {
        Ok(status) => Ok(serde_json::json!({
            "login": status.account.login,
            "display_name": status.account.display_name,
            "plus": status.plus.map(|plus| plus.has_plus),
        })),
        Err(err) if err.downcast_ref::<TokenRejected>().is_some() => Err(AccountError {
            code: "unauthorized",
            message: "Вход устарел — войдите снова".to_string(),
        }),
        Err(err) => Err(network(format!("{err:#}"))),
    }
}

/// A server's rooms, asked before joining any.
pub fn rooms(relay: &str, password: &str) -> Result<Vec<RoomListing>, RoomsError> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|err| RoomsError::Unreachable(err.to_string()))?;
    runtime.block_on(ymsync::link::list_rooms(relay.trim(), password))
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use anyhow::Result;
    use serde_json::Value;
    use ymsync::playback::{AudioSource, Playback};
    use ymsync_proto::TrackRef;

    use super::*;

    const TOKEN: &str = "phone-test";

    /// A player that plays nothing, for sessions whose sound is beside the point.
    #[derive(Default)]
    struct Silent {
        track: Mutex<Option<String>>,
        playing: AtomicBool,
    }

    impl Playback for Silent {
        fn needs_bytes(&self) -> bool {
            true
        }
        fn load(&self, track: TrackRef, _source: AudioSource) -> Result<()> {
            *self.track.lock().unwrap() = Some(track.track_id);
            Ok(())
        }
        fn play(&self) {
            self.playing.store(true, Ordering::SeqCst);
        }
        fn pause(&self) {
            self.playing.store(false, Ordering::SeqCst);
        }
        fn seek_ms(&self, _ms: u64) -> Result<()> {
            Ok(())
        }
        fn position_ms(&self) -> u64 {
            0
        }
        fn is_playing(&self) -> bool {
            self.playing.load(Ordering::SeqCst)
        }
        fn is_finished(&self) -> bool {
            false
        }
        fn current_track_id(&self) -> Option<String> {
            self.track.lock().unwrap().clone()
        }
        fn set_volume(&self, _volume: f32) {}
        fn volume(&self) -> f32 {
            1.0
        }
    }

    fn data_dir(label: &str) -> String {
        let dir = std::env::temp_dir().join(format!("ymsync-android-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir.to_string_lossy().to_string()
    }

    fn config(label: &str, room: Option<RoomConfig>) -> StartConfig {
        StartConfig {
            token: String::new(),
            client_id: format!("{label}-id"),
            data_dir: data_dir(label),
            quality: Default::default(),
            name: "Телефон".into(),
            room,
            api_base: String::new(),
        }
    }

    fn until(session: &Session, what: &str, within: Duration, ok: impl Fn(&Value) -> bool) {
        let deadline = Instant::now() + within;
        loop {
            let snapshot = session.snapshot();
            if ok(&snapshot) {
                return;
            }
            assert!(Instant::now() < deadline, "timed out waiting for {what}; last {snapshot}");
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    #[test]
    fn a_solo_session_plays_without_a_server() {
        let session = Session::start(config("solo", None), Arc::new(Silent::default())).expect("start");
        until(&session, "the phone's own room", Duration::from_secs(15), |s| {
            s["status"] == "connected" && s["listeners"].as_array().is_some_and(|l| l.len() == 1)
        });
        session.stop();
    }

    #[test]
    fn a_session_comes_back_when_the_relay_does() {
        let relays = tokio::runtime::Runtime::new().unwrap();
        let mut relay = relays.block_on(ymsync_relay::bind("127.0.0.1:0", TOKEN)).expect("relay");
        let addr = relay.local_addr();
        let room = RoomConfig {
            relay: format!("ws://{addr}"),
            room: "дом".into(),
            password: TOKEN.into(),
        };
        let session = Session::start(config("rejoin", Some(room)), Arc::new(Silent::default())).expect("start");
        until(&session, "connected", Duration::from_secs(15), |s| s["status"] == "connected");

        relays.block_on(relay.stop());
        until(&session, "reconnecting", Duration::from_secs(10), |s| s["status"] == "reconnecting");

        let _again = relays.block_on(ymsync_relay::bind(&addr.to_string(), TOKEN)).expect("relay again");
        until(&session, "connected again", Duration::from_secs(25), |s| s["status"] == "connected");
        session.stop();
    }

    /// Yandex answers 401 for a token that is gone; the phone has to know that
    /// apart from a network that is merely down, to send the listener to sign in.
    #[test]
    fn an_expired_token_is_reported_as_such() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            use std::io::{Read, Write};
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { return };
                let mut buffer = [0u8; 4096];
                let _ = stream.read(&mut buffer);
                let body = r#"{"error":{"name":"session-expired"}}"#;
                let _ = write!(
                    stream,
                    "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
            }
        });
        let error = account_at("expired", &base).expect_err("refused");
        assert_eq!(error.code, "unauthorized");

        let error = account_at("whatever", "http://127.0.0.1:1").expect_err("no network");
        assert_eq!(error.code, "network");
    }
}
