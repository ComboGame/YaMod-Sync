//! What the mod and the bridge say to each other: one JSON object per line.
//!
//! In ([`Input`]): start or stop a session, a command for the room, and the app
//! player's reports. Out ([`Output`]): the session's status, the engine's
//! snapshot, and instructions for the app's player.

use serde::{Deserialize, Serialize};
use ymsync_proto::TrackRef;

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
    /// This installation's id, kept by the mod; how the room recognises its
    /// admin after a reconnect.
    #[serde(default)]
    pub client_id: String,
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
    /// Where the Yandex API is; empty for Yandex's own. Only the tests set it,
    /// to answer for Yandex and see what the wave asks for.
    #[serde(default)]
    pub api_base: String,
}

fn default_host_port() -> u16 {
    8787
}

/// A command for the room, from the mod's panel or from the app's own controls.
/// Shared with every front end; see [`ymsync::ui`].
pub use ymsync::ui::{FeedbackKind, UiCommand};

/// What the app's player is doing.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct PlayerReport {
    pub track_id: Option<String>,
    pub position_ms: f64,
    pub playing: bool,
    /// The track has played to its end.
    #[serde(default)]
    pub ended: bool,
    /// The player is on the room's queue, not on something the listener just
    /// started in the app. Only then does another track mean it wandered off:
    /// a queue of the listener's own is about to become the room's.
    #[serde(default = "yes")]
    pub ours: bool,
}

fn yes() -> bool {
    true
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
    /// The engine's snapshot, minus the cache lists nobody here draws and the
    /// queue, which goes out on its own.
    Snapshot { snapshot: serde_json::Value },
    /// The room's queue, sent only when it changes. A wave's queue grows by a
    /// batch every few tracks; sending all of it with every snapshot, four times
    /// a second, cost the window more than everything else put together.
    Queue {
        revision: u64,
        tracks: Vec<TrackRef>,
    },
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
///
/// Play, pause and seek name the track they are meant for. The app's player can
/// move to another track on its own, and an instruction that arrives after it
/// did would otherwise act on whatever it plays now — a seek meant for the end
/// of one track throwing the next one to its end. The app drops an instruction
/// for a track it is not on; the bridge sees the mismatch and stages the track
/// again.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum PlayerOp {
    Load {
        track: TrackRef,
    },
    Play {
        #[serde(skip_serializing_if = "Option::is_none")]
        track_id: Option<String>,
    },
    Pause {
        #[serde(skip_serializing_if = "Option::is_none")]
        track_id: Option<String>,
    },
    Seek {
        ms: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        track_id: Option<String>,
    },
    /// Play at this fraction of normal speed, pitch kept: how small drift is
    /// closed without a seek. For the player rather than a track, so that a
    /// return to normal speed always applies.
    Rate {
        rate: f32,
    },
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
        assert!(matches!(input, Input::Command { command: UiCommand::Wave { seeds, fresh: false } } if seeds.is_empty()));
        let input: Input =
            serde_json::from_str(r#"{"t":"command","command":{"c":"wave","seeds":["genre:rnb"]}}"#).unwrap();
        assert!(matches!(input, Input::Command { command: UiCommand::Wave { seeds, .. } } if seeds == ["genre:rnb"]));
        let input: Input = serde_json::from_str(
            r#"{"t":"command","command":{"c":"wave_feedback","kind":"dislike","track_id":"42"}}"#,
        )
        .unwrap();
        assert!(matches!(
            input,
            Input::Command { command: UiCommand::WaveFeedback { kind: FeedbackKind::Dislike, .. } }
        ));
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
        assert!(state.ours, "a report that does not say is about the room's queue");
    }

    #[test]
    fn player_ops_flatten_into_the_message() {
        let text = serde_json::to_string(&Output::Player {
            op: PlayerOp::Seek {
                ms: 9,
                track_id: Some("42".to_string()),
            },
        })
        .unwrap();
        assert_eq!(text, r#"{"t":"player","op":"seek","ms":9,"track_id":"42"}"#);
        let text = serde_json::to_string(&Output::Player {
            op: PlayerOp::Play { track_id: None },
        })
        .unwrap();
        assert_eq!(text, r#"{"t":"player","op":"play"}"#);
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
