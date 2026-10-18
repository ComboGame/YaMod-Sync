//! The YandexMusicSync core: the Yandex Music client, the relay link and the
//! sync engine that ties them together.
//!
//! The player lives elsewhere — `ymsync-bridge` plugs in the Yandex Music app's
//! own — and drives [`engine`]; nothing in this crate reads stdin or prints.

#![forbid(unsafe_code)]

pub mod albums;
pub mod api;
pub mod cache;
pub mod config;
pub mod discover;
pub mod engine;
pub mod import;
pub mod likes;
pub mod link;
pub mod net;
pub mod playback;
pub mod playlists;
pub mod session;
pub mod share;
pub mod station;
pub mod stream;
pub mod ui;

/// The core's own audio output, for a front end with no player of its own —
/// the phone. Absent from the bridge, where the Yandex Music app plays.
#[cfg(feature = "audio-rodio")]
pub mod player;

/// Installs the process-wide crypto provider that `rustls` needs.
///
/// `reqwest` is built with `rustls-no-provider`, which leaves the choice to the
/// application. The API client picks its provider explicitly, but the WebSocket
/// client builds its own configuration from the process default, so this must run
/// once before connecting. Calling it repeatedly is harmless.
#[cfg(feature = "tls-rustls")]
pub fn install_tls_provider() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}
