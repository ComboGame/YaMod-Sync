//! The `extern "system"` surface the JVM binds to.
//!
//! Kotlin side (`ru.combogame.yamodsync.core.Native`):
//!
//! ```kotlin
//! object Native {
//!     init { System.loadLibrary("ymsync_android") }
//!     external fun start(configJson: String, context: Any): String
//!     external fun snapshot(handle: Long): String
//!     external fun command(handle: Long, commandJson: String): String
//!     external fun likes(handle: Long): String
//!     external fun lyrics(handle: Long, trackId: String): String
//!     external fun wavePresets(handle: Long): String
//!     external fun rooms(relay: String, password: String): String
//!     external fun account(token: String): String
//!     external fun stop(handle: Long): String
//! }
//! ```
//!
//! Every call answers `{"ok": …}` or `{"error": "…", "code": "…"}`. Failures in
//! the payload rather than as Java exceptions keep the boundary to one shape,
//! and a panic is caught here too: unwinding into the JVM is undefined.

use std::fmt::Display;
use std::panic::{AssertUnwindSafe, catch_unwind};

use jni::JNIEnv;
use jni::objects::{JClass, JObject, JString};
use jni::sys::{jlong, jstring};
use serde_json::Value;

use crate::session::{self, Session, StartConfig};

/// Reconstructs a borrowed session from a handle.
///
/// # Safety
///
/// `handle` must come from `start` and not yet have been passed to `stop`.
unsafe fn borrow(handle: jlong) -> Option<&'static Session> {
    if handle == 0 {
        return None;
    }
    Some(unsafe { &*(handle as *const Session) })
}

fn ok(value: Value) -> String {
    serde_json::json!({ "ok": value }).to_string()
}

fn failed(code: &str, error: impl Display) -> String {
    serde_json::json!({ "error": format!("{error:#}"), "code": code }).to_string()
}

/// Runs a call and turns its outcome, a panic included, into the reply.
fn answer(env: &mut JNIEnv, call: impl FnOnce(&mut JNIEnv) -> String) -> jstring {
    let text = catch_unwind(AssertUnwindSafe(|| call(env)))
        .unwrap_or_else(|_| failed("panic", "внутренняя ошибка ядра"));
    match env.new_string(text) {
        Ok(value) => value.into_raw(),
        // Null means even that failed; the JVM then has a pending exception.
        Err(_) => std::ptr::null_mut(),
    }
}

fn read(env: &mut JNIEnv, value: &JString) -> Result<String, String> {
    env.get_string(value).map(Into::into).map_err(|err| err.to_string())
}

fn with_session(handle: jlong, call: impl FnOnce(&Session) -> String) -> String {
    match unsafe { borrow(handle) } {
        None => failed("no_session", "сессия не запущена"),
        Some(session) => call(session),
    }
}

#[cfg(target_os = "android")]
fn player(env: &mut JNIEnv, context: &JObject) -> anyhow::Result<std::sync::Arc<dyn ymsync::playback::Playback>> {
    crate::install_android_context(env, context)?;
    let player = ymsync::player::Player::new(1.0).map_err(|err| anyhow::anyhow!("не удалось открыть звук: {err:#}"))?;
    Ok(std::sync::Arc::new(player))
}

#[cfg(not(target_os = "android"))]
fn player(_env: &mut JNIEnv, _context: &JObject) -> anyhow::Result<std::sync::Arc<dyn ymsync::playback::Playback>> {
    anyhow::bail!("звук есть только в сборке для Android")
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_ru_combogame_yamodsync_core_Native_start(
    mut env: JNIEnv,
    _class: JClass,
    config_json: JString,
    context: JObject,
) -> jstring {
    answer(&mut env, |env| {
        crate::init_logging();
        let config = match read(env, &config_json).map_err(anyhow::Error::msg).and_then(|json| {
            serde_json::from_str::<StartConfig>(&json).map_err(|err| anyhow::anyhow!("разбор настроек: {err}"))
        }) {
            Ok(config) => config,
            Err(err) => return failed("bad_request", err),
        };
        // Before the session: building the player opens the audio device, which
        // is reached through the JVM.
        let player = match player(env, &context) {
            Ok(player) => player,
            Err(err) => return failed("audio", err),
        };
        match Session::start(config, player) {
            Ok(session) => ok(Value::from(Box::into_raw(Box::new(session)) as jlong)),
            Err(err) => failed("start", err),
        }
    })
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_ru_combogame_yamodsync_core_Native_snapshot(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jstring {
    answer(&mut env, |_| with_session(handle, |session| ok(session.snapshot())))
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_ru_combogame_yamodsync_core_Native_command(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    command_json: JString,
) -> jstring {
    answer(&mut env, |env| {
        let command = match read(env, &command_json)
            .and_then(|json| serde_json::from_str::<ymsync::ui::UiCommand>(&json).map_err(|err| err.to_string()))
        {
            Ok(command) => command,
            Err(err) => return failed("bad_request", err),
        };
        with_session(handle, |session| {
            session.command(command);
            ok(Value::Bool(true))
        })
    })
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_ru_combogame_yamodsync_core_Native_likes(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jstring {
    answer(&mut env, |_| with_session(handle, |session| ok(session.likes())))
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_ru_combogame_yamodsync_core_Native_lyrics(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    track_id: JString,
) -> jstring {
    answer(&mut env, |env| {
        let track_id = match read(env, &track_id) {
            Ok(id) => id,
            Err(err) => return failed("bad_request", err),
        };
        with_session(handle, |session| match session.lyrics(&track_id) {
            Ok(lyrics) => ok(lyrics),
            Err(err) => failed("network", err),
        })
    })
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_ru_combogame_yamodsync_core_Native_wavePresets(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jstring {
    answer(&mut env, |_| {
        with_session(handle, |session| match session.wave_presets() {
            Ok(presets) => ok(serde_json::to_value(presets).unwrap_or_default()),
            Err(err) => failed("network", err),
        })
    })
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_ru_combogame_yamodsync_core_Native_rooms(
    mut env: JNIEnv,
    _class: JClass,
    relay: JString,
    password: JString,
) -> jstring {
    answer(&mut env, |env| {
        let (relay, password) = match (read(env, &relay), read(env, &password)) {
            (Ok(relay), Ok(password)) => (relay, password),
            (Err(err), _) | (_, Err(err)) => return failed("bad_request", err),
        };
        match session::rooms(&relay, &password) {
            Ok(rooms) => ok(serde_json::to_value(rooms).unwrap_or_default()),
            Err(err) => {
                let code = match err {
                    ymsync::link::RoomsError::Unauthorized => "unauthorized",
                    ymsync::link::RoomsError::OldRelay => "old_relay",
                    ymsync::link::RoomsError::Unreachable(_) => "unreachable",
                };
                failed(code, err)
            }
        }
    })
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_ru_combogame_yamodsync_core_Native_account(
    mut env: JNIEnv,
    _class: JClass,
    token: JString,
) -> jstring {
    answer(&mut env, |env| {
        let token = match read(env, &token) {
            Ok(token) => token,
            Err(err) => return failed("bad_request", err),
        };
        match session::account(&token) {
            Ok(account) => ok(account),
            Err(err) => failed(err.code, err.message),
        }
    })
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_ru_combogame_yamodsync_core_Native_stop(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jstring {
    answer(&mut env, |_| {
        if handle == 0 {
            return ok(Value::Bool(false));
        }
        // Takes the session back from Kotlin; the handle is dead from here on.
        let session = unsafe { Box::from_raw(handle as *mut Session) };
        session.stop();
        ok(Value::Bool(true))
    })
}
