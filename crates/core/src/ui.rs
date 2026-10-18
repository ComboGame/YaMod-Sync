//! What a front end sends the engine, as JSON.
//!
//! One language for every front end: the bridge reads it from the mod line by
//! line, the phone hands it over JNI. Keeping it here rather than in either of
//! them is what stops the two from drifting apart.

use serde::Deserialize;
use ymsync_proto::{RepeatMode, TrackRef};

use crate::engine::{Command, WaveFeedbackKind};

/// A command for the room, from a front end's panel or from a player's own
/// controls.
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
    /// «Моя волна» or a preset for the whole room, fed from this account. The
    /// seeds are the app's own: none for plain «Моя волна», `genre:rnb`,
    /// `artist:5839186` and so on for a preset.
    Wave {
        #[serde(default)]
        seeds: Vec<String>,
        /// A new session even for the wave already playing: «Встряхнуть».
        #[serde(default)]
        fresh: bool,
    },
    /// The heart or «не нравится» on a track, for the wave this peer feeds.
    WaveFeedback { kind: FeedbackKind, track_id: String },
    StopWave,
    /// Passes the wave to the listener with this relay id.
    HandWave { to: u64 },
    /// Makes the listener with this relay id the room's admin.
    SetAdmin { peer: u64 },
    Repeat { mode: RepeatMode },
    Shuffle { on: bool },
    Name { name: String },
    Like { track: TrackRef, liked: bool },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FeedbackKind {
    Like,
    Unlike,
    Dislike,
    Undislike,
}

/// A front end's command, as the engine knows it.
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
        UiCommand::Wave { seeds, fresh } => Command::PlayWave { seeds, fresh },
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
        UiCommand::HandWave { to } => Command::HandWave { to },
        UiCommand::SetAdmin { peer } => Command::SetAdmin { peer },
        UiCommand::Repeat { mode } => Command::SetRepeat(mode),
        UiCommand::Shuffle { on } => Command::SetShuffle(on),
        UiCommand::Name { name } => Command::SetName(name),
        UiCommand::Like { track, liked } => Command::Like { track, liked },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bridge_and_the_phone_read_one_command_language() {
        let hand: UiCommand = serde_json::from_str(r#"{"c":"hand_wave","to":3}"#).unwrap();
        assert_eq!(hand, UiCommand::HandWave { to: 3 });
        let shake: UiCommand = serde_json::from_str(r#"{"c":"wave","fresh":true}"#).unwrap();
        assert_eq!(
            shake,
            UiCommand::Wave {
                seeds: Vec::new(),
                fresh: true
            }
        );
        assert_eq!(engine_command(UiCommand::StopWave), Command::StopStation);
    }
}
