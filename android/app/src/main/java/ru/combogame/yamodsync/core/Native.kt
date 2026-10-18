package ru.combogame.yamodsync.core

import android.content.Context

/**
 * Ядро на Rust (`crates/android/src/ffi.rs`). Каждый вызов отвечает JSON
 * `{"ok": …}` или `{"error": "…", "code": "…"}`. Звук играет само ядро
 * (rodio → AAudio), поэтому ему не передаётся ни состояние плеера, ни команды.
 */
object Native {
    init {
        System.loadLibrary("ymsync_android")
    }

    /** Открывает звук и подключается — не с главного потока. `context` нужен звуку (AudioTrack через JNI). */
    external fun start(configJson: String, context: Any): String
    external fun snapshot(handle: Long): String
    external fun command(handle: Long, commandJson: String): String
    external fun likes(handle: Long): String
    external fun lyrics(handle: Long, trackId: String): String
    external fun wavePresets(handle: Long): String
    external fun rooms(relay: String, password: String): String
    external fun account(token: String): String
    external fun stop(handle: Long): String
}

/** То же, что [Native], но подменяемое в тестах. */
interface NativeApi {
    fun start(configJson: String): String
    fun snapshot(handle: Long): String
    fun command(handle: Long, commandJson: String): String
    fun likes(handle: Long): String
    fun lyrics(handle: Long, trackId: String): String
    fun wavePresets(handle: Long): String
    fun rooms(relay: String, password: String): String
    fun account(token: String): String
    fun stop(handle: Long): String
}

class JniNative(private val context: Context) : NativeApi {
    override fun start(configJson: String) = Native.start(configJson, context.applicationContext)
    override fun snapshot(handle: Long) = Native.snapshot(handle)
    override fun command(handle: Long, commandJson: String) = Native.command(handle, commandJson)
    override fun likes(handle: Long) = Native.likes(handle)
    override fun lyrics(handle: Long, trackId: String) = Native.lyrics(handle, trackId)
    override fun wavePresets(handle: Long) = Native.wavePresets(handle)
    override fun rooms(relay: String, password: String) = Native.rooms(relay, password)
    override fun account(token: String) = Native.account(token)
    override fun stop(handle: Long) = Native.stop(handle)
}
