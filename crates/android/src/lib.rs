//! The phone's side of YandexMusicSync: the core, run inside the Android app.
//!
//! The phone plays with the core's own player — `rodio` into `cpal`, out through
//! AAudio — rather than ExoPlayer: an earlier version tried ExoPlayer, whose
//! reported playhead trailed its audio by a few hundred milliseconds, and the
//! sync loop seeked for ever against it. Kotlin keeps the screens, the media
//! session and the foreground service; it reads snapshots and sends commands
//! over JNI (see [`ffi`]).

pub mod ffi;
pub mod session;

/// Hands the JavaVM and the app context to `ndk_context`, once per process.
///
/// `cpal`'s AAudio backend asks `android.media.AudioTrack.getMinBufferSize` over
/// JNI while working out which stream configurations exist, and reads the device
/// list from the Java `AudioManager`. Both go through `ndk_context` and *panic*
/// when nobody has filled it in, so this has to happen before the first player is
/// built.
#[cfg(target_os = "android")]
pub fn install_android_context(env: &mut jni::JNIEnv, context: &jni::objects::JObject) -> anyhow::Result<()> {
    use std::mem::ManuallyDrop;
    use std::sync::OnceLock;

    use anyhow::Context;

    static DONE: OnceLock<()> = OnceLock::new();
    if DONE.get().is_some() {
        return Ok(());
    }
    let vm = env
        .get_java_vm()
        .context("не удалось получить JavaVM для звукового вывода")?;
    let context = env
        .new_global_ref(context)
        .context("не удалось сохранить контекст приложения")?;
    // Leaked deliberately: `ndk_context` keeps these as raw pointers for the life
    // of the process, and a dropped global reference would leave it dangling.
    let context = ManuallyDrop::new(context);
    unsafe {
        ndk_context::initialize_android_context(vm.get_java_vm_pointer().cast(), context.as_raw().cast());
    }
    let _ = DONE.set(());
    Ok(())
}

/// Sends the core's log to logcat under the tag `ymsync`, once per process.
/// `tracing` forwards to `log` when no subscriber is set, which is what
/// `android_logger` listens to.
pub fn init_logging() {
    #[cfg(target_os = "android")]
    {
        use std::sync::Once;
        static ONCE: Once = Once::new();
        ONCE.call_once(|| {
            android_logger::init_once(
                android_logger::Config::default()
                    .with_tag("ymsync")
                    .with_max_level(log::LevelFilter::Info),
            );
        });
    }
}
