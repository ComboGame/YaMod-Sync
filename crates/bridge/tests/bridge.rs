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
    assert_eq!(playing["snapshot"]["queue"][0]["track_id"], "42");

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
