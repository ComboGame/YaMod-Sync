//! The whole bridge against a real relay, with the mod played by the test.
//!
//! No Yandex account is involved: the track is put in the core's cache first,
//! which is the engine's first place to look. What is checked is the part only
//! the bridge does — that a room's track turns into a `load` for the app's
//! player, that the room waits for the app's answer, and that it then tells the
//! player to play.

use std::time::Duration;

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream};
use ymsync::cache::Cache;
use ymsync_proto::TrackRef;

const TOKEN: &str = "bridge-test";
const WAIT: Duration = Duration::from_secs(20);

fn track(id: &str) -> TrackRef {
    TrackRef {
        track_id: id.to_string(),
        album_id: Some("7".to_string()),
        album: Some("Album".to_string()),
        title: format!("Title {id}"),
        artist: "Artist".to_string(),
        duration_ms: 180_000,
        cover_uri: None,
    }
}

struct Mod {
    to_bridge: DuplexStream,
    from_bridge: tokio::io::Lines<BufReader<DuplexStream>>,
}

impl Mod {
    async fn send(&mut self, message: Value) {
        let mut line = serde_json::to_vec(&message).unwrap();
        line.push(b'\n');
        self.to_bridge.write_all(&line).await.unwrap();
    }

    /// The next message the bridge sends that `pick` accepts; the rest are skipped.
    async fn expect(&mut self, what: &str, pick: impl Fn(&Value) -> bool) -> Value {
        let deadline = tokio::time::Instant::now() + WAIT;
        loop {
            let line = tokio::time::timeout_at(deadline, self.from_bridge.next_line())
                .await
                .unwrap_or_else(|_| panic!("timed out waiting for {what}"))
                .unwrap()
                .unwrap_or_else(|| panic!("the bridge closed while waiting for {what}"));
            let message: Value = serde_json::from_str(&line).unwrap();
            if pick(&message) {
                return message;
            }
        }
    }
}

impl Mod {
    /// Everything the bridge says within `ms`.
    async fn drain(&mut self, ms: u64) -> Vec<Value> {
        let deadline = tokio::time::Instant::now() + Duration::from_millis(ms);
        let mut out = Vec::new();
        while let Ok(Ok(Some(line))) = tokio::time::timeout_at(deadline, self.from_bridge.next_line()).await {
            out.push(serde_json::from_str(&line).unwrap());
        }
        out
    }

    async fn report(&mut self, track: &str, position_ms: f64, playing: bool) {
        self.send(json!({"t": "player", "state": {"track_id": track, "position_ms": position_ms, "playing": playing}}))
            .await;
    }
}

fn start_config(url: &str, name: &str, data_dir: &std::path::Path) -> Value {
    json!({
        "t": "start",
        "config": {"relay": url, "room": "test", "password": TOKEN, "name": name, "data_dir": data_dir.to_string_lossy()}
    })
}

fn cached_data_dir(label: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("ymsync-bridge-test-{label}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let cache = Cache::open(dir.join("tracks"), 0).unwrap();
    cache.insert(&track("42"), b"not really audio", true).unwrap();
    dir
}

fn op(message: &Value) -> Option<&str> {
    (message["t"] == "player").then(|| message["op"].as_str()).flatten()
}

fn start_bridge() -> Mod {
    let (to_bridge, bridge_in) = tokio::io::duplex(64 * 1024);
    let (bridge_out, from_bridge) = tokio::io::duplex(1024 * 1024);
    tokio::spawn(async move {
        ymsync_bridge::run(BufReader::new(bridge_in), bridge_out).await.unwrap();
    });
    Mod {
        to_bridge,
        from_bridge: BufReader::new(from_bridge).lines(),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_room_track_is_loaded_into_the_app_and_started_once_it_is_ready() {
    let mut relay = ymsync_relay::bind("127.0.0.1:0", TOKEN).await.expect("relay");
    let url = format!("ws://{}", relay.local_addr());

    let data_dir = std::env::temp_dir().join(format!("ymsync-bridge-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&data_dir);
    let cache = Cache::open(data_dir.join("tracks"), 0).unwrap();
    cache.insert(&track("42"), b"not really audio", true).unwrap();
    drop(cache);

    let mut app = start_bridge();
    app.send(json!({
        "t": "start",
        "config": {
            "relay": url,
            "room": "test",
            "password": TOKEN,
            "name": "мод",
            "data_dir": data_dir.to_string_lossy(),
        }
    }))
    .await;
    app.expect("connected", |m| m["t"] == "status" && m["state"] == "connected").await;

    // A reloaded window asks for the same room again and has to be told it is in.
    app.send(json!({
        "t": "start",
        "config": {
            "relay": url,
            "room": "test",
            "password": TOKEN,
            "name": "мод",
            "data_dir": data_dir.to_string_lossy(),
        }
    }))
    .await;
    app.expect("connected again", |m| m["t"] == "status" && m["state"] == "connected").await;

    app.send(json!({
        "t": "command",
        "command": {"c": "set_queue", "start": 0, "tracks": [serde_json::to_value(track("42")).unwrap()]}
    }))
    .await;

    // The queue travels on its own, once per change, not in every snapshot.
    let queue = app.expect("the queue", |m| m["t"] == "queue" && m["tracks"].as_array().is_some_and(|t| !t.is_empty())).await;
    assert_eq!(queue["tracks"][0]["track_id"], "42");

    let load = app.expect("a load", |m| m["t"] == "player" && m["op"] == "load").await;
    assert_eq!(load["track"]["track_id"], "42");

    // Nothing plays before the app says it has the track.
    let waiting = app
        .expect("a snapshot of the room holding the track", |m| {
            m["t"] == "snapshot" && m["snapshot"]["track"]["track_id"] == "42"
        })
        .await;
    assert_eq!(waiting["snapshot"]["playing"], false, "{waiting}");

    app.send(json!({"t": "loaded", "result": {"track_id": "42", "ok": true}})).await;
    app.send(json!({"t": "player", "state": {"track_id": "42", "position_ms": 0.0, "playing": false}}))
        .await;

    // Alone in the room, ready means go: the engine aligns and starts the player.
    app.expect("play", |m| m["t"] == "player" && m["op"] == "play").await;
    app.send(json!({"t": "player", "state": {"track_id": "42", "position_ms": 120.0, "playing": true}}))
        .await;
    let playing = app
        .expect("the room playing", |m| m["t"] == "snapshot" && m["snapshot"]["playing"] == true)
        .await;
    assert_eq!(playing["snapshot"]["connected"], true);
    assert_eq!(playing["snapshot"]["room_playing"], true);
    assert_eq!(playing["snapshot"]["local_track"], "42");
    assert!(playing["snapshot"].get("queue").is_none(), "{playing}");

    // A reloaded window asks for the room again and is handed the track again.
    app.send(json!({
        "t": "start",
        "config": {
            "relay": url,
            "room": "test",
            "password": TOKEN,
            "name": "мод",
            "data_dir": data_dir.to_string_lossy(),
        }
    }))
    .await;
    let again = app.expect("the track again", |m| m["t"] == "player" && m["op"] == "load").await;
    assert_eq!(again["track"]["track_id"], "42");

    // Pausing the room pauses the app's player.
    app.send(json!({"t": "command", "command": {"c": "toggle"}})).await;
    app.expect("pause", |m| m["t"] == "player" && m["op"] == "pause").await;

    app.send(json!({"t": "stop"})).await;
    app.expect("stopped", |m| m["t"] == "status" && m["state"] == "stopped").await;

    relay.stop().await;
    let _ = std::fs::remove_dir_all(&data_dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_unreachable_room_is_retried_and_said_so() {
    let mut app = start_bridge();
    let data_dir = std::env::temp_dir().join(format!("ymsync-bridge-test-unreachable-{}", std::process::id()));
    app.send(json!({
        "t": "start",
        "config": {
            // Nothing listens on port 9 of loopback.
            "relay": "ws://127.0.0.1:9",
            "room": "test",
            "password": TOKEN,
            "data_dir": data_dir.to_string_lossy(),
        }
    }))
    .await;
    let failed = app
        .expect("a reconnect with the reason", |m| {
            m["t"] == "status" && m["state"] == "reconnecting" && m["error"].is_string()
        })
        .await;
    assert!(failed["error"].as_str().unwrap().contains("127.0.0.1:9"), "{failed}");

    app.send(json!({"t": "stop"})).await;
    app.send(json!({"t": "quit"})).await;
    let _ = std::fs::remove_dir_all(&data_dir);
}

/// The stutter on every track change: the app's player moves on to the next
/// track by itself as one ends, while the room still waits for everyone's
/// «ready». The player must be left running through that wait — not paused and
/// restarted — and its head start taken back by speed once the room starts.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_track_the_app_already_plays_runs_on_through_the_wait_and_is_slowed_not_seeked() {
    let mut relay = ymsync_relay::bind("127.0.0.1:0", TOKEN).await.expect("relay");
    let url = format!("ws://{}", relay.local_addr());
    let (dir_a, dir_b) = (cached_data_dir("run-on-a"), cached_data_dir("run-on-b"));

    let mut a = start_bridge();
    let mut b = start_bridge();
    a.send(start_config(&url, "a", &dir_a)).await;
    a.expect("a in", |m| m["t"] == "status" && m["state"] == "connected").await;
    b.send(start_config(&url, "b", &dir_b)).await;
    b.expect("b in", |m| m["t"] == "status" && m["state"] == "connected").await;

    a.send(json!({"t": "command", "command": {"c": "set_queue", "start": 0, "tracks": [serde_json::to_value(track("42")).unwrap()]}}))
        .await;
    a.expect("a load", |m| op(m) == Some("load")).await;
    b.expect("b load", |m| op(m) == Some("load")).await;

    // A has it and is already playing it; B takes its time, so the room waits.
    a.send(json!({"t": "loaded", "result": {"track_id": "42", "ok": true}})).await;
    let mut position = 0.0;
    for _ in 0..7 {
        a.report("42", position, true).await;
        for message in a.drain(100).await {
            assert!(
                !matches!(op(&message), Some("pause" | "seek")),
                "the room is waiting and the app's player was told {message}"
            );
        }
        position += 100.0;
    }

    b.send(json!({"t": "loaded", "result": {"track_id": "42", "ok": true}})).await;
    b.report("42", 0.0, false).await;

    // The room starts behind A: A slows down instead of jumping back.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    let rate = loop {
        assert!(tokio::time::Instant::now() < deadline, "A was never slowed down");
        a.report("42", position, true).await;
        let mut found = None;
        for message in a.drain(100).await {
            match op(&message) {
                Some("pause" | "seek") => panic!("A was told {message} instead of being slowed"),
                Some("rate") => found = message["rate"].as_f64(),
                _ => {}
            }
        }
        position += 100.0;
        if let Some(rate) = found {
            break rate;
        }
    };
    assert!(rate < 1.0 && rate >= 0.95, "{rate}");

    for app in [&mut a, &mut b] {
        app.send(json!({"t": "quit"})).await;
    }
    relay.stop().await;
    for dir in [dir_a, dir_b] {
        let _ = std::fs::remove_dir_all(dir);
    }
}

/// When whoever fed the wave leaves, the room plays out what is queued and the
/// wave stops there: nobody else's account takes it over unasked. The others
/// are told, so they can start it again themselves.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_wave_whose_feeder_left_is_not_taken_over() {
    use futures_util::SinkExt;
    use tokio_tungstenite::tungstenite::Message;

    let mut relay = ymsync_relay::bind("127.0.0.1:0", TOKEN).await.expect("relay");
    let url = format!("ws://{}", relay.local_addr());
    let dir = cached_data_dir("unfed");

    let mut app = start_bridge();
    app.send(start_config(&url, "мод", &dir)).await;
    app.expect("in", |m| m["t"] == "status" && m["state"] == "connected").await;

    // The feeder: queues a track, claims the wave, and goes.
    {
        let (mut feeder, _) = tokio_tungstenite::connect_async(&url).await.expect("feeder");
        let send = |value: Value| Message::text(value.to_string());
        feeder
            .send(send(json!({"t": "hello", "protocol": 6, "room": "test", "token": TOKEN, "client": "test", "name": "друг"})))
            .await
            .unwrap();
        feeder
            .send(send(json!({"t": "do", "command": {"c": "set_queue", "start": 0, "tracks": [serde_json::to_value(track("42")).unwrap()]}})))
            .await
            .unwrap();
        let station = r#"{"seeds":["genre:rnb"],"name":"R'n'B","by":"друг"}"#;
        feeder
            .send(send(json!({"t": "do", "command": {"c": "set_station", "id": station}})))
            .await
            .unwrap();
        app.expect("the wave in the room", |m| {
            m["t"] == "snapshot" && m["snapshot"]["station"].as_str().is_some_and(|s| s.contains("R'n'B"))
        })
        .await;
        feeder.close(None).await.unwrap();
    }

    let unfed = app
        .expect("the wave without its feeder", |m| m["t"] == "snapshot" && m["snapshot"]["station_unfed"] == true)
        .await;
    assert_eq!(unfed["snapshot"]["feeding"], false, "{unfed}");
    let notice = app
        .expect("the room told", |m| {
            m["t"] == "snapshot" && m["snapshot"]["notice"].as_str().is_some_and(|n| n.contains("доиграет"))
        })
        .await;
    assert_eq!(notice["snapshot"]["feeding"], false);
    // Nothing tries to feed it from here.
    for message in app.drain(1500).await {
        if message["t"] == "snapshot" {
            assert_eq!(message["snapshot"]["feeding"], false, "{message}");
            assert_ne!(message["snapshot"]["notice"], "подхватываю волну", "{message}");
        }
    }

    app.send(json!({"t": "quit"})).await;
    relay.stop().await;
    let _ = std::fs::remove_dir_all(dir);
}

// ---- a simulated Yandex Music app ------------------------------------------
//
// The tests above play the mod by hand, message by message. The ones below need
// the app to behave the way it does for minutes on end: play at the speed it is
// told, move on to the next track of the room's queue by itself when one ends,
// answer loads after a delay — sometimes too late — and refuse an instruction
// for a track it is not on, the way the mod does. `App` is that app.

mod sim {
    use std::sync::{Arc, Mutex};
    use std::time::Instant;

    use serde_json::{Value, json};
    use tokio::sync::mpsc;
    use tokio::task::JoinHandle;
    use ymsync_proto::TrackRef;

    use super::Mod;

    #[derive(Clone, Default)]
    pub struct Options {
        /// How long the app takes to answer a load.
        pub load_delay_ms: u64,
        /// How much shorter than its listed duration every track really is, so
        /// the app moves on before the room does.
        pub short_by_ms: f64,
        /// Answer superseded loads too, after the newer one: late events of a
        /// track the room has already left.
        pub late_answers: bool,
    }

    /// What the app has been through, for the assertions.
    #[derive(Default)]
    pub struct Seen {
        /// Every instruction, with the track the app was on when it came.
        pub ops: Vec<(Instant, Value, Option<String>)>,
        pub snapshot: Value,
        pub snapshots: usize,
        pub queues: usize,
        pub statuses: Vec<String>,
        /// Instructions the app dropped because they named another track.
        pub refused: usize,
    }

    #[derive(Default)]
    struct Player {
        queue: Vec<TrackRef>,
        track: Option<String>,
        position: f64,
        playing: bool,
        ended: bool,
        rate: f64,
    }

    impl Player {
        fn duration(&self, short_by: f64) -> Option<f64> {
            let id = self.track.as_deref()?;
            let track = self.queue.iter().find(|t| t.track_id == id)?;
            Some(track.duration_ms as f64 - short_by)
        }

        fn next(&self) -> Option<String> {
            let id = self.track.as_deref()?;
            let at = self.queue.iter().position(|t| t.track_id == id)?;
            self.queue.get(at + 1).map(|t| t.track_id.clone())
        }
    }

    enum Control {
        Send(Value),
        /// The app moves to this track of the queue by itself.
        JumpTo(String),
    }

    pub struct App {
        pub seen: Arc<Mutex<Seen>>,
        control: mpsc::UnboundedSender<Control>,
        task: JoinHandle<()>,
    }

    impl App {
        pub fn start(mut bridge: Mod, options: Options) -> Self {
            let seen = Arc::new(Mutex::new(Seen::default()));
            let (control, mut control_rx) = mpsc::unbounded_channel::<Control>();
            let task = {
                let seen = Arc::clone(&seen);
                tokio::spawn(async move {
                    let mut player = Player {
                        rate: 1.0,
                        ..Player::default()
                    };
                    // (due, track, which load it answers)
                    let mut pending: Vec<(Instant, String, u64)> = Vec::new();
                    let mut loads = 0u64;
                    let mut tick = tokio::time::interval(std::time::Duration::from_millis(100));
                    let mut last = Instant::now();
                    loop {
                        tokio::select! {
                            line = bridge.from_bridge.next_line() => {
                                let Ok(Some(line)) = line else { return };
                                let message: Value = serde_json::from_str(&line).unwrap();
                                let mut seen = seen.lock().unwrap();
                                match message["t"].as_str() {
                                    Some("snapshot") => {
                                        seen.snapshot = message["snapshot"].clone();
                                        seen.snapshots += 1;
                                    }
                                    Some("queue") => {
                                        seen.queues += 1;
                                        player.queue = serde_json::from_value(message["tracks"].clone()).unwrap();
                                    }
                                    Some("status") => {
                                        seen.statuses.push(message["state"].as_str().unwrap_or("").to_string());
                                    }
                                    Some("player") => {
                                        seen.ops.push((Instant::now(), message.clone(), player.track.clone()));
                                        let named = message["track_id"].as_str();
                                        let applies = named.is_none() || named == player.track.as_deref();
                                        match message["op"].as_str() {
                                            Some("load") => {
                                                loads += 1;
                                                let id = message["track"]["track_id"].as_str().unwrap().to_string();
                                                let due = Instant::now()
                                                    + std::time::Duration::from_millis(options.load_delay_ms);
                                                pending.push((due, id, loads));
                                            }
                                            Some("play") if applies => {
                                                player.playing = true;
                                                player.ended = false;
                                            }
                                            Some("pause") if applies => player.playing = false,
                                            Some("seek") if applies => {
                                                player.position = message["ms"].as_f64().unwrap();
                                            }
                                            Some("rate") => player.rate = message["rate"].as_f64().unwrap(),
                                            Some(_) => seen.refused += 1,
                                            None => {}
                                        }
                                    }
                                    _ => {}
                                }
                            }
                            control = control_rx.recv() => match control {
                                None => return,
                                Some(Control::Send(value)) => bridge.send(value).await,
                                Some(Control::JumpTo(id)) => {
                                    player.track = Some(id);
                                    player.position = 0.0;
                                    player.playing = true;
                                }
                            },
                            _ = tick.tick() => {
                                let now = Instant::now();
                                let elapsed = now.duration_since(last).as_secs_f64() * 1000.0;
                                last = now;
                                if player.playing {
                                    player.position += elapsed * player.rate;
                                    if let Some(duration) = player.duration(options.short_by_ms)
                                        && player.position >= duration
                                    {
                                        match player.next() {
                                            Some(next) => {
                                                player.position -= duration;
                                                player.track = Some(next);
                                            }
                                            None => {
                                                player.playing = false;
                                                player.ended = true;
                                            }
                                        }
                                    }
                                }
                                // Loads that are due, in the order they came.
                                let mut due: Vec<(Instant, String, u64)> = Vec::new();
                                pending.retain(|entry| {
                                    if entry.0 <= now {
                                        due.push(entry.clone());
                                        false
                                    } else {
                                        true
                                    }
                                });
                                for (_, id, which) in due {
                                    if which == loads {
                                        if player.track.as_deref() != Some(id.as_str()) {
                                            player.track = Some(id.clone());
                                            player.position = 0.0;
                                        }
                                    } else if !options.late_answers {
                                        continue;
                                    }
                                    bridge
                                        .send(json!({"t": "loaded", "result": {"track_id": id, "ok": true}}))
                                        .await;
                                }
                                bridge
                                    .send(json!({"t": "player", "state": {
                                        "track_id": player.track, "position_ms": player.position,
                                        "playing": player.playing, "ended": player.ended, "ours": true,
                                    }}))
                                    .await;
                            }
                        }
                    }
                })
            };
            Self { seen, control, task }
        }

        pub fn send(&self, value: Value) {
            let _ = self.control.send(Control::Send(value));
        }

        pub fn command(&self, command: Value) {
            self.send(json!({"t": "command", "command": command}));
        }

        pub fn jump_to(&self, id: &str) {
            let _ = self.control.send(Control::JumpTo(id.to_string()));
        }

        /// Waits until `check` holds for what the app has seen.
        pub async fn until(&self, what: &str, within_ms: u64, check: impl Fn(&Seen) -> bool) {
            let deadline = Instant::now() + std::time::Duration::from_millis(within_ms);
            loop {
                if check(&self.seen.lock().unwrap()) {
                    return;
                }
                if Instant::now() >= deadline {
                    let seen = self.seen.lock().unwrap();
                    panic!("timed out waiting for {what}; last snapshot {}", seen.snapshot);
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
        }

        pub fn snapshot(&self) -> Value {
            self.seen.lock().unwrap().snapshot.clone()
        }

        /// Instructions received since `since`, of the given kinds.
        pub fn ops_since(&self, since: Instant, kinds: &[&str]) -> Vec<Value> {
            let seen = self.seen.lock().unwrap();
            seen.ops
                .iter()
                .filter(|(at, op, _)| *at >= since && op["op"].as_str().is_some_and(|k| kinds.contains(&k)))
                .map(|(_, op, _)| op.clone())
                .collect()
        }

        pub fn stop(self) {
            self.send(json!({"t": "quit"}));
            let task = self.task;
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                task.abort();
            });
        }
    }
}

fn track_of(id: &str, duration_ms: u64) -> TrackRef {
    TrackRef {
        duration_ms,
        ..track(id)
    }
}

fn temp_dir(label: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("ymsync-bridge-sim-{label}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

/// A bridge with the simulated app on it, connected to the room.
async fn join(url: &str, name: &str, options: sim::Options) -> (sim::App, std::path::PathBuf) {
    let dir = temp_dir(name);
    let app = sim::App::start(start_bridge(), options);
    app.send(start_config(url, name, &dir));
    app.until("connected", 20_000, |seen| seen.statuses.iter().any(|s| s == "connected"))
        .await;
    (app, dir)
}

fn queue_of(tracks: &[TrackRef]) -> Value {
    json!({"c": "set_queue", "start": 0, "tracks": tracks})
}

fn room_track(app: &sim::App) -> Option<String> {
    app.snapshot()["track"]["track_id"].as_str().map(str::to_string)
}

/// Hours of listening, compressed: a queue of short tracks that runs into one
/// track after another by itself. Every change is the app moving on on its own,
/// and none of them may cost a pause, a seek or a wait for «ready» — those were
/// the dropout and the two-second drift after every natural track change.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_queue_plays_through_its_tracks_without_a_pause_seek_or_wait() {
    let mut relay = ymsync_relay::bind("127.0.0.1:0", TOKEN).await.expect("relay");
    let url = format!("ws://{}", relay.local_addr());
    // B's copies are a little short: it moves on before the room, as a real
    // player whose file is shorter than Yandex's listed duration does.
    let (a, dir_a) = join(&url, "long-a", sim::Options { load_delay_ms: 200, ..Default::default() }).await;
    let (b, dir_b) = join(
        &url,
        "long-b",
        sim::Options {
            load_delay_ms: 350,
            short_by_ms: 100.0,
            ..Default::default()
        },
    )
    .await;

    let tracks: Vec<TrackRef> = (1..=8).map(|i| track_of(&format!("t{i}"), 4_000)).collect();
    a.command(queue_of(&tracks));
    for app in [&a, &b] {
        app.until("the room playing its first track", 10_000, |seen| {
            seen.snapshot["room_playing"] == true && seen.snapshot["track"]["track_id"] == "t1"
        })
        .await;
    }
    let started = std::time::Instant::now();
    let snapshots_before = a.seen.lock().unwrap().snapshots;
    let queues_before = [a.seen.lock().unwrap().queues, b.seen.lock().unwrap().queues];

    // Five natural track changes.
    a.until("the sixth track", 30_000, |seen| seen.snapshot["track"]["track_id"] == "t6")
        .await;
    let elapsed = started.elapsed().as_secs_f64();

    for (name, app, queues_before) in [("A", &a, queues_before[0]), ("B", &b, queues_before[1])] {
        let hard = app.ops_since(started, &["pause", "seek"]);
        assert!(hard.is_empty(), "{name} was told {hard:?} on natural track changes");
        let loads = app.ops_since(started, &["load"]);
        assert!(loads.len() <= 6, "{name} got {} loads for five changes: {loads:?}", loads.len());
        let seen = app.seen.lock().unwrap();
        assert_eq!(seen.queues, queues_before, "{name}: the unchanged queue went out again");
        assert_eq!(seen.snapshot["waiting"], false, "{name}: {}", seen.snapshot);
    }
    // Snapshots stay a few a second, however long it plays.
    let rate = (a.seen.lock().unwrap().snapshots - snapshots_before) as f64 / elapsed;
    assert!(rate < 8.0, "{rate:.1} snapshots a second");
    // And both are on the room's track, close to it.
    for app in [&a, &b] {
        app.until("in step", 6_000, |seen| {
            seen.snapshot["drift_ms"].as_i64().is_some_and(|d| d.abs() < 250)
        })
        .await;
    }

    a.stop();
    b.stop();
    relay.stop().await;
    for dir in [dir_a, dir_b] {
        let _ = std::fs::remove_dir_all(dir);
    }
}

/// Skipping several tracks in quick succession, with the app slow to load and
/// answering for tracks the room has already left. Whatever arrives late, both
/// players end up on the room's last choice, playing, and nothing meant for an
/// earlier track is applied to it.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn quick_skips_with_late_answers_end_on_the_rooms_track() {
    let mut relay = ymsync_relay::bind("127.0.0.1:0", TOKEN).await.expect("relay");
    let url = format!("ws://{}", relay.local_addr());
    let slow = sim::Options {
        load_delay_ms: 450,
        late_answers: true,
        ..Default::default()
    };
    let (a, dir_a) = join(&url, "skip-a", slow.clone()).await;
    let (b, dir_b) = join(&url, "skip-b", sim::Options { load_delay_ms: 150, ..slow }).await;

    let tracks: Vec<TrackRef> = (1..=8).map(|i| track_of(&format!("s{i}"), 120_000)).collect();
    a.command(queue_of(&tracks));
    a.until("playing", 10_000, |seen| seen.snapshot["room_playing"] == true).await;

    for _ in 0..4 {
        a.command(json!({"c": "next"}));
        b.command(json!({"c": "next"}));
        tokio::time::sleep(std::time::Duration::from_millis(90)).await;
    }
    // The room's verdict, whatever order the commands arrived in.
    a.until("the room settled and playing", 10_000, |seen| {
        seen.snapshot["room_playing"] == true && seen.snapshot["waiting"] == false
    })
    .await;
    let wanted = room_track(&a).unwrap();
    b.until("B seeing the same room", 2_000, |seen| {
        seen.snapshot["track"]["track_id"].as_str() == Some(wanted.as_str())
    })
    .await;

    for (name, app) in [("A", &a), ("B", &b)] {
        app.until("the player on the room's track", 5_000, |seen| {
            seen.snapshot["local_track"].as_str() == Some(wanted.as_str()) && seen.snapshot["playing"] == true
        })
        .await;
        let after = std::time::Instant::now();
        tokio::time::sleep(std::time::Duration::from_millis(1_500)).await;
        for op in app.ops_since(after, &["play", "pause", "seek"]) {
            assert_eq!(op["track_id"].as_str(), Some(wanted.as_str()), "{name} was told {op} for another track");
        }
        assert_eq!(app.snapshot()["local_track"].as_str(), Some(wanted.as_str()), "{name} drifted off");
    }

    a.stop();
    b.stop();
    relay.stop().await;
    for dir in [dir_a, dir_b] {
        let _ = std::fs::remove_dir_all(dir);
    }
}

/// Two listeners pressing things at the same moment: one pauses while the other
/// seeks and skips. The relay orders them, and both rooms end up in the same
/// state, with both players on its track.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn two_listeners_commanding_at_once_end_in_one_room() {
    let mut relay = ymsync_relay::bind("127.0.0.1:0", TOKEN).await.expect("relay");
    let url = format!("ws://{}", relay.local_addr());
    let fast = sim::Options {
        load_delay_ms: 100,
        ..Default::default()
    };
    let (a, dir_a) = join(&url, "both-a", fast.clone()).await;
    let (b, dir_b) = join(&url, "both-b", fast).await;

    let tracks: Vec<TrackRef> = (1..=4).map(|i| track_of(&format!("c{i}"), 120_000)).collect();
    a.command(queue_of(&tracks));
    b.until("playing", 10_000, |seen| seen.snapshot["room_playing"] == true).await;

    a.command(json!({"c": "seek", "ms": 60_000}));
    b.command(json!({"c": "toggle"}));
    b.command(json!({"c": "next"}));
    a.command(json!({"c": "toggle"}));

    tokio::time::sleep(std::time::Duration::from_millis(2_500)).await;
    let (sa, sb) = (a.snapshot(), b.snapshot());
    assert_eq!(sa["track"]["track_id"], sb["track"]["track_id"], "{sa}\n{sb}");
    assert_eq!(sa["room_playing"], sb["room_playing"]);
    assert_eq!(sa["waiting"], sb["waiting"]);
    for app in [&a, &b] {
        let wanted = app.snapshot()["track"]["track_id"].as_str().map(str::to_string);
        app.until("the player on the room's track", 5_000, |seen| {
            seen.snapshot["local_track"].as_str() == wanted.as_deref()
        })
        .await;
    }

    a.stop();
    b.stop();
    relay.stop().await;
    for dir in [dir_a, dir_b] {
        let _ = std::fs::remove_dir_all(dir);
    }
}

/// The app's player wandering to another track of the room's queue on its own —
/// the room plays one track, the app another, and the panel used to show the
/// room's as if all were well. It is put back.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_player_that_wanders_to_another_track_is_put_back() {
    let mut relay = ymsync_relay::bind("127.0.0.1:0", TOKEN).await.expect("relay");
    let url = format!("ws://{}", relay.local_addr());
    let (a, dir) = join(
        &url,
        "wander",
        sim::Options {
            load_delay_ms: 100,
            ..Default::default()
        },
    )
    .await;

    let tracks: Vec<TrackRef> = (1..=4).map(|i| track_of(&format!("w{i}"), 120_000)).collect();
    a.command(queue_of(&tracks));
    a.until("playing w1", 10_000, |seen| {
        seen.snapshot["room_playing"] == true && seen.snapshot["local_track"] == "w1" && seen.snapshot["playing"] == true
    })
    .await;

    let wandered = std::time::Instant::now();
    a.jump_to("w3");
    a.until("the player seen on w3", 2_000, |seen| seen.snapshot["local_track"] == "w3").await;
    a.until("the room's track again", 5_000, |seen| {
        seen.snapshot["local_track"] == "w1" && seen.snapshot["playing"] == true
    })
    .await;
    let loads = a.ops_since(wandered, &["load"]);
    assert_eq!(loads.len(), 1, "{loads:?}");
    assert_eq!(loads[0]["track"]["track_id"], "w1");
    // While it was off, nothing was steered on the wrong track.
    let misdirected = a
        .seen
        .lock()
        .unwrap()
        .ops
        .iter()
        .filter(|(at, op, on)| *at >= wandered && op["op"] == "seek" && on.as_deref() == Some("w3"))
        .count();
    assert_eq!(misdirected, 0);

    a.stop();
    relay.stop().await;
    let _ = std::fs::remove_dir_all(dir);
}

/// A player whose copy of a track ends a little before the room's moves on to
/// the next one a moment early. It is ahead, not lost: pulling it back for the
/// last second of the old track would be the stutter.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_player_a_moment_ahead_on_the_next_track_is_left_alone() {
    let mut relay = ymsync_relay::bind("127.0.0.1:0", TOKEN).await.expect("relay");
    let url = format!("ws://{}", relay.local_addr());
    let (a, dir) = join(
        &url,
        "ahead",
        sim::Options {
            load_delay_ms: 100,
            short_by_ms: 1_200.0,
            ..Default::default()
        },
    )
    .await;

    let tracks = vec![track_of("e1", 5_000), track_of("e2", 60_000)];
    a.command(queue_of(&tracks));
    a.until("playing e1", 10_000, |seen| {
        seen.snapshot["local_track"] == "e1" && seen.snapshot["playing"] == true
    })
    .await;
    a.until("the app ahead on e2", 8_000, |seen| {
        seen.snapshot["local_track"] == "e2" && seen.snapshot["track"]["track_id"] == "e1"
    })
    .await;
    let ahead = std::time::Instant::now();
    a.until("the room following", 5_000, |seen| seen.snapshot["track"]["track_id"] == "e2")
        .await;
    let pulled_back = a
        .ops_since(ahead, &["load"])
        .into_iter()
        .filter(|op| op["track"]["track_id"] == "e1")
        .count();
    assert_eq!(pulled_back, 0, "the app was pulled back to the track it had finished");
    assert!(a.ops_since(ahead, &["seek", "pause"]).is_empty());

    a.stop();
    relay.stop().await;
    let _ = std::fs::remove_dir_all(dir);
}

/// The relay going away and coming back. The bridge says it is reconnecting,
/// gets back in, and the app's player is not paused because the room was out of
/// reach: an unknown room is not a paused one.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_lost_relay_is_reconnected_without_pausing_the_player() {
    let mut relay = ymsync_relay::bind("127.0.0.1:0", TOKEN).await.expect("relay");
    let addr = relay.local_addr();
    let url = format!("ws://{addr}");
    let (a, dir) = join(
        &url,
        "lost",
        sim::Options {
            load_delay_ms: 100,
            ..Default::default()
        },
    )
    .await;

    a.command(queue_of(&[track_of("r1", 120_000)]));
    a.until("playing", 10_000, |seen| seen.snapshot["playing"] == true).await;

    let lost = std::time::Instant::now();
    relay.stop().await;
    a.until("reconnecting", 5_000, |seen| seen.statuses.iter().any(|s| s == "reconnecting"))
        .await;
    let mut relay = ymsync_relay::bind(&addr.to_string(), TOKEN).await.expect("relay again");
    a.until("connected again", 20_000, |seen| seen.statuses.last().is_some_and(|s| s == "connected"))
        .await;
    assert!(a.ops_since(lost, &["pause"]).is_empty(), "the player was paused for a lost connection");

    // The new relay knows nothing; the room is set up again and plays.
    a.command(queue_of(&[track_of("r2", 120_000)]));
    a.until("playing the new queue", 10_000, |seen| {
        seen.snapshot["local_track"] == "r2" && seen.snapshot["playing"] == true
    })
    .await;

    a.stop();
    relay.stop().await;
    let _ = std::fs::remove_dir_all(dir);
}

// ---- «Моя волна» against a stand-in for Yandex -----------------------------

/// Answers for Yandex the few calls a wave makes, and keeps every request: what
/// the wave asked for, and when, is what these tests are about.
mod fake_yandex {
    use std::sync::{Arc, Mutex};

    use serde_json::{Value, json};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[derive(Clone, Debug)]
    pub struct Request {
        pub method: String,
        pub path: String,
        pub body: Value,
    }

    pub struct Server {
        pub base: String,
        pub requests: Arc<Mutex<Vec<Request>>>,
        task: tokio::task::JoinHandle<()>,
    }

    impl Drop for Server {
        fn drop(&mut self) {
            self.task.abort();
        }
    }

    /// Tracks of `ms` each, numbered on from batch to batch.
    pub async fn start(track_ms: u64) -> Server {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let served = Arc::new(Mutex::new(0usize));
        let task = {
            let requests = Arc::clone(&requests);
            tokio::spawn(async move {
                loop {
                    let Ok((mut socket, _)) = listener.accept().await else { return };
                    let requests = Arc::clone(&requests);
                    let served = Arc::clone(&served);
                    tokio::spawn(async move {
                        let mut buffer = Vec::new();
                        loop {
                            // One request: the head, then as much body as it says.
                            let head_end = loop {
                                if let Some(at) = buffer.windows(4).position(|w| w == b"\r\n\r\n") {
                                    break at + 4;
                                }
                                let mut chunk = [0u8; 4096];
                                match socket.read(&mut chunk).await {
                                    Ok(0) | Err(_) => return,
                                    Ok(n) => buffer.extend_from_slice(&chunk[..n]),
                                }
                            };
                            let head = String::from_utf8_lossy(&buffer[..head_end]).to_string();
                            let length = head
                                .lines()
                                .find_map(|line| {
                                    let (name, value) = line.split_once(':')?;
                                    name.eq_ignore_ascii_case("content-length").then(|| value.trim().parse::<usize>().ok())?
                                })
                                .unwrap_or(0);
                            while buffer.len() < head_end + length {
                                let mut chunk = [0u8; 4096];
                                match socket.read(&mut chunk).await {
                                    Ok(0) | Err(_) => return,
                                    Ok(n) => buffer.extend_from_slice(&chunk[..n]),
                                }
                            }
                            let body: Value = serde_json::from_slice(&buffer[head_end..head_end + length]).unwrap_or(Value::Null);
                            buffer.drain(..head_end + length);
                            let mut parts = head.split_whitespace();
                            let method = parts.next().unwrap_or("").to_string();
                            let path = parts.next().unwrap_or("").split('?').next().unwrap_or("").to_string();
                            requests.lock().unwrap().push(Request {
                                method: method.clone(),
                                path: path.clone(),
                                body: body.clone(),
                            });

                            let batch = |served: &mut usize| {
                                let first = *served + 1;
                                *served += 3;
                                let sequence: Vec<Value> = (first..first + 3)
                                    .map(|n| {
                                        json!({"track": {
                                            "id": format!("v{n}"), "title": format!("Волна {n}"), "durationMs": track_ms,
                                            "artists": [{"name": "Артист"}], "albums": [{"id": "9"}],
                                        }})
                                    })
                                    .collect();
                                sequence
                            };
                            let (status, answer) = if path == "/rotor/session/new" {
                                let sequence = batch(&mut served.lock().unwrap());
                                ("200 OK", json!({"result": {
                                    "radioSessionId": "session-1", "batchId": "batch-1", "sequence": sequence,
                                    "wave": {"name": "Моя волна", "description": "Подбирается для вас"},
                                }}))
                            } else if path.ends_with("/tracks") && path.starts_with("/rotor/session/") {
                                let sequence = batch(&mut served.lock().unwrap());
                                ("200 OK", json!({"result": {"batchId": "batch-n", "sequence": sequence}}))
                            } else if path.ends_with("/feedback") {
                                ("200 OK", json!({"result": "ok"}))
                            } else {
                                ("404 Not Found", json!({"error": "not here"}))
                            };
                            let text = answer.to_string();
                            let reply = format!(
                                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{text}",
                                text.len()
                            );
                            if socket.write_all(reply.as_bytes()).await.is_err() {
                                return;
                            }
                        }
                    });
                }
            })
        };
        Server { base, requests, task }
    }

    impl Server {
        pub fn count(&self, path_ends: &str) -> usize {
            self.requests.lock().unwrap().iter().filter(|r| r.path.ends_with(path_ends)).count()
        }

        /// The feedback events, as `type trackId`.
        pub fn feedback(&self) -> Vec<String> {
            self.requests
                .lock()
                .unwrap()
                .iter()
                .filter(|r| r.path.ends_with("/feedback"))
                .map(|r| {
                    let event = &r.body["event"];
                    match event["trackId"].as_str() {
                        Some(track) => format!("{} {track}", event["type"].as_str().unwrap_or("?")),
                        None => event["type"].as_str().unwrap_or("?").to_string(),
                    }
                })
                .collect()
        }
    }
}

/// «Моя волна» in the room, the way the app has it: one session for the whole
/// listen, the next batch asked for before the queue runs dry, and every start,
/// finish and skip reported to the session — a skip from anybody in the room.
/// Pressing the wave again while it plays changes nothing: the session and the
/// queue stay.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_wave_runs_from_one_session_and_hears_what_the_room_did() {
    let mut relay = ymsync_relay::bind("127.0.0.1:0", TOKEN).await.expect("relay");
    let url = format!("ws://{}", relay.local_addr());
    let yandex = fake_yandex::start(6_000).await;

    let dir = temp_dir("wave-feeder");
    let feeder = sim::App::start(start_bridge(), sim::Options { load_delay_ms: 150, ..Default::default() });
    let mut config = start_config(&url, "волна", &dir);
    config["config"]["yandex_token"] = json!("test-token");
    config["config"]["api_base"] = json!(yandex.base);
    feeder.send(config);
    feeder.until("connected", 20_000, |seen| seen.statuses.iter().any(|s| s == "connected")).await;
    let (friend, friend_dir) = join(&url, "друг", sim::Options { load_delay_ms: 250, ..Default::default() }).await;

    feeder.command(json!({"c": "wave"}));
    feeder.until("the wave playing and fed from here", 10_000, |seen| {
        seen.snapshot["feeding"] == true && seen.snapshot["room_playing"] == true && seen.snapshot["track"]["track_id"] == "v1"
    })
    .await;
    let station = feeder.snapshot()["station"].as_str().unwrap_or_default().to_string();
    assert!(station.contains("Моя волна"), "{station}");

    // The friend skips the first track a moment in.
    tokio::time::sleep(std::time::Duration::from_millis(800)).await;
    friend.command(json!({"c": "next"}));
    feeder.until("the second track", 5_000, |seen| seen.snapshot["track"]["track_id"] == "v2").await;
    // The second plays through by itself, into the third.
    feeder.until("the third track", 12_000, |seen| seen.snapshot["track"]["track_id"] == "v3").await;

    // The app's «Моя волна» pressed again, while it plays.
    let revision = feeder.snapshot()["queue_revision"].clone();
    feeder.command(json!({"c": "wave"}));
    tokio::time::sleep(std::time::Duration::from_millis(1_000)).await;
    assert_eq!(feeder.snapshot()["track"]["track_id"], "v3", "the wave started over");
    assert_eq!(feeder.snapshot()["queue_revision"], revision);

    feeder.until("the feedback for the third track", 5_000, |_| yandex.feedback().iter().any(|f| f == "trackStarted v3:9"))
        .await;
    assert_eq!(yandex.count("/rotor/session/new"), 1, "one session for the whole listen");
    assert!(yandex.count("/tracks") >= 1, "the next batch was asked for before the queue ran out");
    let feedback = yandex.feedback();
    for expected in ["radioStarted", "trackStarted v1:9", "skip v1:9", "trackStarted v2:9", "trackFinished v2:9", "trackStarted v3:9"] {
        assert!(feedback.iter().any(|f| f == expected), "no {expected} in {feedback:?}");
    }
    let skips = feedback.iter().filter(|f| f.starts_with("skip")).count();
    assert_eq!(skips, 1, "{feedback:?}");
    // Each track was reported started once, however many snapshots went by.
    let started_v2 = feedback.iter().filter(|f| *f == "trackStarted v2:9").count();
    assert_eq!(started_v2, 1, "{feedback:?}");
    // The friend's player followed along without being told to seek or pause on
    // the natural change.
    assert_eq!(friend.snapshot()["track"]["track_id"], "v3");

    feeder.stop();
    friend.stop();
    relay.stop().await;
    for dir in [dir, friend_dir] {
        let _ = std::fs::remove_dir_all(dir);
    }
}
