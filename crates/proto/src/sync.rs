//! Drift correction: what a peer should do to line up with the room.
//!
//! Two tools, picked by what the backend can do. A player that holds the whole
//! track in memory corrects by seeking: a seek costs it a decoder reset, nothing
//! more. A streaming player — the Yandex Music app's — pays for every seek with
//! a rebuffer, which is heard as a dropout; it absorbs small drift by playing a
//! few percent faster or slower instead ([`NudgeParams`]), with the pitch kept,
//! and seeks only when it is far off.

use crate::PlaybackState;

/// Tunables for [`decide`]. Defaults aim at "different rooms, in step to within
/// a few hundred milliseconds".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SyncParams {
    /// Correct only once the error exceeds this, so we do not seek constantly.
    pub seek_threshold_ms: i64,
    /// Seek this far ahead of the computed target to absorb the time a seek and
    /// decoder reset take. Only applied while playing.
    pub seek_lead_ms: i64,
    /// Above this round-trip time the offset estimate is too coarse to act on.
    pub max_rtt_ms: i64,
}

impl Default for SyncParams {
    fn default() -> Self {
        Self {
            seek_threshold_ms: 300,
            seek_lead_ms: 40,
            max_rtt_ms: 400,
        }
    }
}

/// Absorbing drift by speed, for a backend that can change it without a seek.
///
/// The speed is proportional to the drift: far behind plays a little faster,
/// slightly ahead a little slower, and it eases back to normal as the gap
/// closes. Beyond `seek_beyond_ms` the gap would take too long to play back
/// and a seek is the lesser evil.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NudgeParams {
    /// Inside this, play at normal speed. Keeps the speed from twitching on the
    /// estimate's own jitter.
    pub deadband_ms: i64,
    /// How much drift asks for one permille of speed difference.
    pub ms_per_permille: i64,
    /// The largest change, in permille: 50 is ±5%, where a tempo change is hard
    /// to hear with the pitch kept.
    pub max_permille: i64,
    /// Seek rather than nudge beyond this.
    pub seek_beyond_ms: i64,
}

impl Default for NudgeParams {
    fn default() -> Self {
        Self {
            deadband_ms: 15,
            ms_per_permille: 4,
            max_permille: 50,
            seek_beyond_ms: 1_500,
        }
    }
}

impl NudgeParams {
    /// The speed difference for this drift, in permille: negative slows down.
    pub fn permille(&self, drift_ms: i64) -> i32 {
        if drift_ms.abs() <= self.deadband_ms {
            return 0;
        }
        (-drift_ms / self.ms_per_permille.max(1)).clamp(-self.max_permille, self.max_permille) as i32
    }
}

/// What to do with the local player.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Correction {
    /// Close enough; leave the playhead alone.
    None,
    Seek { to_ms: u64 },
    Pause,
    /// Seek, then resume.
    Resume { to_ms: u64 },
    /// Resume where the player already is: it is close enough, and a seek would
    /// cost a streaming player a rebuffer. Only with [`NudgeParams`].
    Play,
    /// Play at `1 + permille / 1000` of normal speed. 0 is normal speed. Only
    /// with [`NudgeParams`].
    Nudge { permille: i32 },
}

/// Where the room's playhead is *now*, extrapolated from the relay's last
/// snapshot.
///
/// `now_server_ms` must be in relay time (local clock plus the estimated
/// offset). A paused room does not move, so its anchor is used as-is.
pub fn target_position_ms(state: &PlaybackState, now_server_ms: i64) -> i64 {
    if state.playing {
        let elapsed = (now_server_ms - state.at_server_ms).max(0);
        state.position_ms as i64 + elapsed
    } else {
        state.position_ms as i64
    }
}

/// Whether the clock estimate is sharp enough to correct against.
pub fn trust_clock(rtt_ms: Option<i64>, params: &SyncParams) -> bool {
    matches!(rtt_ms, Some(rtt) if rtt <= params.max_rtt_ms)
}

/// Compares the local playhead against the target and picks a correction, for a
/// backend that corrects by seeking only.
pub fn decide(
    target_ms: i64,
    local_ms: i64,
    room_playing: bool,
    local_playing: bool,
    params: &SyncParams,
) -> Correction {
    decide_with(target_ms, local_ms, room_playing, local_playing, params, None)
}

/// [`decide`], with speed as a tool when `nudge` is given.
pub fn decide_with(
    target_ms: i64,
    local_ms: i64,
    room_playing: bool,
    local_playing: bool,
    params: &SyncParams,
    nudge: Option<&NudgeParams>,
) -> Correction {
    let drift_ms = local_ms - target_ms;
    if let Some(nudge) = nudge
        && room_playing
        && drift_ms.abs() <= nudge.seek_beyond_ms
    {
        return if local_playing {
            Correction::Nudge {
                permille: nudge.permille(drift_ms),
            }
        } else {
            Correction::Play
        };
    }
    let off_target = drift_ms.abs() > params.seek_threshold_ms;

    match (room_playing, local_playing) {
        // Room stopped: stop too, and only then line the playhead up, since a
        // paused playhead does not run away from us.
        (false, true) => Correction::Pause,
        (false, false) if off_target => Correction::Seek {
            to_ms: target_ms.max(0) as u64,
        },
        (false, false) => Correction::None,

        // Starting from a standstill: aim slightly ahead, because the seek and
        // decoder reset consume real time before the first sample is heard.
        (true, false) => Correction::Resume {
            to_ms: (target_ms + params.seek_lead_ms).max(0) as u64,
        },
        (true, true) if off_target => Correction::Seek {
            to_ms: (target_ms + params.seek_lead_ms).max(0) as u64,
        },
        (true, true) => Correction::None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::TrackRef;

    fn state(position_ms: u64, playing: bool, at_server_ms: i64) -> PlaybackState {
        PlaybackState {
            seq: 1,
            track: Some(TrackRef {
                track_id: "1".into(),
                album_id: None,
                album: None,
                title: "t".into(),
                artist: "a".into(),
                duration_ms: 300_000,
                cover_uri: None,
            }),
            index: 0,
            queue_revision: 1,
            position_ms,
            playing,
            at_server_ms,
            station: None,
            station_unfed: false,
            repeat: Default::default(),
            shuffle: false,
            waiting: None,
        }
    }

    #[test]
    fn playing_target_advances_with_relay_time() {
        let s = state(10_000, true, 1_000);
        assert_eq!(target_position_ms(&s, 1_000), 10_000);
        assert_eq!(target_position_ms(&s, 3_500), 12_500);
    }

    #[test]
    fn paused_target_is_frozen() {
        let s = state(10_000, false, 1_000);
        assert_eq!(target_position_ms(&s, 60_000), 10_000);
    }

    #[test]
    fn snapshot_from_the_future_does_not_rewind_the_target() {
        // A late clock re-estimate can briefly put the snapshot ahead of us.
        let s = state(10_000, true, 5_000);
        assert_eq!(target_position_ms(&s, 4_000), 10_000);
    }

    #[test]
    fn small_drift_is_left_alone() {
        let p = SyncParams::default();
        assert_eq!(decide(10_000, 10_200, true, true, &p), Correction::None);
        assert_eq!(decide(10_000, 9_800, true, true, &p), Correction::None);
    }

    #[test]
    fn large_drift_seeks_with_lead() {
        let p = SyncParams::default();
        assert_eq!(
            decide(10_000, 5_000, true, true, &p),
            Correction::Seek { to_ms: 10_040 }
        );
        assert_eq!(
            decide(10_000, 20_000, true, true, &p),
            Correction::Seek { to_ms: 10_040 }
        );
    }

    #[test]
    fn a_paused_room_pauses_us_before_aligning() {
        let p = SyncParams::default();
        assert_eq!(decide(10_000, 90_000, false, true, &p), Correction::Pause);
    }

    #[test]
    fn while_both_paused_we_align_without_lead() {
        let p = SyncParams::default();
        assert_eq!(
            decide(10_000, 12_000, false, false, &p),
            Correction::Seek { to_ms: 10_000 }
        );
        assert_eq!(decide(10_000, 10_100, false, false, &p), Correction::None);
    }

    #[test]
    fn a_resumed_room_resumes_us() {
        let p = SyncParams::default();
        assert_eq!(
            decide(10_000, 0, true, false, &p),
            Correction::Resume { to_ms: 10_040 }
        );
    }

    /// The streaming player's tool: a gap the speed can close is closed by it,
    /// both ways, and a seek is kept for gaps that would take too long.
    #[test]
    fn with_nudging_small_drift_changes_speed_not_position() {
        let p = SyncParams::default();
        let n = NudgeParams::default();
        // 100 ms behind: 25‰ faster.
        assert_eq!(
            decide_with(10_000, 9_900, true, true, &p, Some(&n)),
            Correction::Nudge { permille: 25 }
        );
        // 250 ms behind: as fast as allowed.
        assert_eq!(
            decide_with(10_000, 9_750, true, true, &p, Some(&n)),
            Correction::Nudge { permille: 50 }
        );
        // 480 ms ahead: as slow as allowed.
        assert_eq!(
            decide_with(10_000, 10_480, true, true, &p, Some(&n)),
            Correction::Nudge { permille: -50 }
        );
        // Inside the deadband: normal speed.
        assert_eq!(
            decide_with(10_000, 10_010, true, true, &p, Some(&n)),
            Correction::Nudge { permille: 0 }
        );
        // Too far to play back: seek.
        assert_eq!(
            decide_with(10_000, 12_000, true, true, &p, Some(&n)),
            Correction::Seek { to_ms: 10_040 }
        );
    }

    /// Resuming close to the room must not seek: for a streaming player that is
    /// a rebuffer, heard as a dropout right as the music starts again.
    #[test]
    fn with_nudging_a_close_resume_just_plays() {
        let p = SyncParams::default();
        let n = NudgeParams::default();
        assert_eq!(decide_with(13_630, 13_449, true, false, &p, Some(&n)), Correction::Play);
        assert_eq!(
            decide_with(60_000, 13_449, true, false, &p, Some(&n)),
            Correction::Resume { to_ms: 60_040 }
        );
        // A paused room still pauses, and a paused player still aligns while paused.
        assert_eq!(decide_with(10_000, 10_000, false, true, &p, Some(&n)), Correction::Pause);
        assert_eq!(
            decide_with(10_000, 12_000, false, false, &p, Some(&n)),
            Correction::Seek { to_ms: 10_000 }
        );
    }

    #[test]
    fn nudging_is_capped_and_symmetric() {
        let n = NudgeParams::default();
        assert_eq!(n.permille(1_400), -50);
        assert_eq!(n.permille(-1_400), 50);
        assert_eq!(n.permille(80), -20);
        assert_eq!(n.permille(-15), 0);
    }

    #[test]
    fn negative_targets_clamp_to_the_start() {
        let p = SyncParams::default();
        assert_eq!(
            decide(-5_000, 30_000, false, false, &p),
            Correction::Seek { to_ms: 0 }
        );
    }

    #[test]
    fn noisy_clock_is_not_trusted() {
        let p = SyncParams::default();
        assert!(trust_clock(Some(20), &p));
        assert!(trust_clock(Some(400), &p));
        assert!(!trust_clock(Some(401), &p));
        assert!(!trust_clock(None, &p));
    }
}
