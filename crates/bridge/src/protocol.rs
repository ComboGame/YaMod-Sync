//! What the mod and the bridge say to each other: one JSON object per line.
//!
//! In ([`Input`]): start or stop a session, a command for the room, and the app
//! player's reports. Out ([`Output`]): the session's status, the engine's
//! snapshot, and instructions for the app's player.

use serde::{Deserialize, Serialize};
use ymsync_proto::{RepeatMode, TrackRef};

#[derive(Debug, Deserialize)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum Input {
    /// Join a room, or hold one here. Replaces a session already running.
    Start { config: StartConfig },
    /// Leave the room.
    Stop,
    /// Leave the room and exit.
    Quit,
    Command { command: UiCommand },
    Player { state: PlayerReport },
    Loaded { result: LoadReport },
}

/// Where and as whom to listen.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct StartConfig {
    /// The relay: `ws://host:8787` or `wss://host/path`. Ignored when hosting.
    #[serde(default)]
    pub relay: String,
    pub room: String,
    pub password: String,
    #[serde(default)]
    pub name: String,
    /// This account's OAuth token, as the app holds it.
    #[serde(default)]
    pub yandex_token: String,
    /// Run the room's relay in this process.
    #[serde(default)]
    pub host: bool,
    #[serde(default = "default_host_port")]
    pub host_port: u16,
    /// Address to give the others when hosting; empty means "work it out".
    #[serde(default)]
    pub advertise: String,
    /// Where the core keeps its files.
    pub data_dir: String,
    /// Constant lag of the app's playhead report, if one turns out to exist.
    #[serde(default)]
    pub position_bias_ms: i64,
}

fn default_host_port() -> u16 {
    8787
}

/// A command for the room, from the mod's panel or from the app's own controls.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "c", rename_all = "snake_case")]
pub enum UiCommand {
    Toggle,
    Next,
    Prev,
    Seek { ms: u64 },
    Index { index: usize },
    SetQueue { tracks: Vec<TrackRef>, start: usize },
    Enqueue { tracks: Vec<TrackRef> },
    PlayNext { tracks: Vec<TrackRef> },
    /// «Моя волна» for the whole room, fed from this account.
    Wave,
    StopWave,
    Repeat { mode: RepeatMode },
    Shuffle { on: bool },
    Name { name: String },
    Like { track: TrackRef, liked: bool },
}

/// What the app's player is doing.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct PlayerReport {
    pub track_id: Option<String>,
    pub position_ms: f64,
    pub playing: bool,
    /// The track has played to its end.
    #[serde(default)]
    pub ended: bool,
}

/// The app's answer to [`PlayerOp::Load`].
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct LoadReport {
    pub track_id: String,
    pub ok: bool,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum Output {
    Status {
        state: SessionState,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    /// The engine's snapshot, minus the cache lists nobody here draws.
    Snapshot { snapshot: serde_json::Value },
    Player {
        #[serde(flatten)]
        op: PlayerOp,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Stopped,
    Connecting,
    Connected,
    /// The connection dropped and is being retried.
    Reconnecting,
}

/// An instruction for the app's player.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum PlayerOp {
    Load { track: TrackRef },
    Play,
    Pause,
    Seek { ms: u64 },
    /// Play at this fraction of normal speed, pitch kept: how small drift is
    /// closed without a seek.
    Rate { rate: f32 },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_start_message_parses_with_defaults() {
        let input: Input = serde_json::from_str(
            r#"{"t":"start","config":{"relay":"ws://1.2.3.4:8787","room":"home",
                "password":"p","data_dir":"C:/data"}}"#,
        )
        .unwrap();
        let Input::Start { config } = input else {
            panic!("start");
        };
        assert_eq!(config.room, "home");
        assert!(!config.host);
        assert_eq!(config.host_port, 8787);
        assert_eq!(config.yandex_token, "");
    }

    #[test]
    fn commands_are_tagged_by_c() {
        let input: Input =
            serde_json::from_str(r#"{"t":"command","command":{"c":"seek","ms":5000}}"#).unwrap();
        assert!(matches!(input, Input::Command { command: UiCommand::Seek { ms: 5000 } }));
        let input: Input = serde_json::from_str(r#"{"t":"command","command":{"c":"wave"}}"#).unwrap();
        assert!(matches!(input, Input::Command { command: UiCommand::Wave }));
    }

    #[test]
    fn player_reports_parse() {
        let input: Input = serde_json::from_str(
            r#"{"t":"player","state":{"track_id":"42","position_ms":1234.5,"playing":true}}"#,
        )
        .unwrap();
        let Input::Player { state } = input else {
            panic!("player");
        };
        assert_eq!(state.track_id.as_deref(), Some("42"));
        assert!(!state.ended);
    }

    #[test]
    fn player_ops_flatten_into_the_message() {
        let text = serde_json::to_string(&Output::Player {
            op: PlayerOp::Seek { ms: 9 },
        })
        .unwrap();
        assert_eq!(text, r#"{"t":"player","op":"seek","ms":9}"#);
        let text = serde_json::to_string(&Output::Player {
            op: PlayerOp::Rate { rate: 0.95 },
        })
        .unwrap();
        assert_eq!(text, r#"{"t":"player","op":"rate","rate":0.95}"#);
        let text = serde_json::to_string(&Output::Status {
            state: SessionState::Connecting,
            error: None,
        })
        .unwrap();
        assert_eq!(text, r#"{"t":"status","state":"connecting"}"#);
    }
}
