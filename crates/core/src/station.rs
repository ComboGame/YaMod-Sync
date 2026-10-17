//! What a room's station string says.
//!
//! The relay keeps a station as an opaque string and hands it to everybody in
//! the room. For a wave that string describes it: the seeds it was started with
//! — «Моя волна», or a preset such as `genre:rnb` or `artist:5839186` — the name
//! Yandex gives it, and who in the room it is fed for. The feeder resolves the
//! tracks from those seeds on its own account; the others only read the name.
//!
//! A bare seed, the form older peers wrote, is still understood.

use serde::{Deserialize, Serialize};

use crate::api::WAVE_STATION;

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct StationSpec {
    /// What the wave session is opened with.
    pub seeds: Vec<String>,
    /// The wave's name as Yandex gives it: «R'n'B», «Асия».
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Yandex's line under the name: «Моя волна по жанру».
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// The listener whose account the tracks are picked for.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub by: Option<String>,
}

impl StationSpec {
    /// A wave from these seeds, or plain «Моя волна» when there are none.
    pub fn from_seeds(seeds: Vec<String>, by: &str) -> Self {
        let seeds: Vec<String> = seeds.into_iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
        Self {
            seeds: if seeds.is_empty() {
                vec![WAVE_STATION.to_string()]
            } else {
                seeds
            },
            by: Some(by.to_string()).filter(|by| !by.is_empty()),
            ..Self::default()
        }
    }

    /// Reads a station string: this module's JSON, or a bare seed.
    pub fn parse(id: &str) -> Self {
        let id = id.trim();
        if id.starts_with('{')
            && let Ok(spec) = serde_json::from_str::<StationSpec>(id)
            && !spec.seeds.is_empty()
        {
            return spec;
        }
        Self {
            seeds: vec![id.to_string()],
            ..Self::default()
        }
    }

    /// The station string for the relay.
    pub fn encode(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| self.seeds.first().cloned().unwrap_or_default())
    }

    /// The seed the old station endpoint takes, which knows only one.
    pub fn primary_seed(&self) -> &str {
        self.seeds.first().map_or(WAVE_STATION, String::as_str)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_preset_survives_the_relay_round_trip() {
        let mut spec = StationSpec::from_seeds(vec!["genre:rnb".into()], "Рома");
        spec.name = Some("R'n'B".into());
        spec.description = Some("Моя волна по жанру".into());
        assert_eq!(StationSpec::parse(&spec.encode()), spec);
    }

    /// What older peers put in the station: just the seed.
    #[test]
    fn a_bare_seed_is_a_station_too() {
        let spec = StationSpec::parse("user:onyourwave");
        assert_eq!(spec.seeds, ["user:onyourwave"]);
        assert_eq!(spec.name, None);
        assert_eq!(spec.primary_seed(), "user:onyourwave");
    }

    #[test]
    fn no_seeds_means_my_wave() {
        let spec = StationSpec::from_seeds(vec![" ".into()], "");
        assert_eq!(spec.seeds, [WAVE_STATION]);
        assert_eq!(spec.by, None);
    }

    /// Something that merely looks like JSON is still a seed, not an error.
    #[test]
    fn a_broken_spec_reads_as_a_seed() {
        assert_eq!(StationSpec::parse("{nope").seeds, ["{nope"]);
        assert_eq!(StationSpec::parse(r#"{"seeds":[]}"#).seeds, [r#"{"seeds":[]}"#]);
    }
}
