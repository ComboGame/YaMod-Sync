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
