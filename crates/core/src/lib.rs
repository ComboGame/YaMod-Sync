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
