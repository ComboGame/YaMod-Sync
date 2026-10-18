@file:OptIn(ExperimentalSerializationApi::class)

package ru.combogame.yamodsync.core

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNamingStrategy
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.add

// Модели ядра в том виде, в каком их отдаёт JNI: имена полей ядра (snake_case)
// пересчитываются в camelCase, лишние поля пропускаются — ядро растёт быстрее
// приложения.
val coreJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
    namingStrategy = JsonNamingStrategy.SnakeCase
}

@Serializable
data class TrackRef(
    val trackId: String,
    val albumId: String? = null,
    val album: String? = null,
    val title: String = "",
    val artist: String = "",
    val durationMs: Long = 0,
    val coverUri: String? = null,
)

@Serializable
data class Listener(
    val peer: Long = 0,
    val name: String = "",
    val you: Boolean = false,
    val admin: Boolean = false,
    /** Есть ли у его аккаунта Плюс; null — его клиент не сказал. */
    val plus: Boolean? = null,
    val feeds: Boolean = false,
)

@Serializable
data class Latency(
    val rttMs: Long? = null,
    val rttLastMs: Long? = null,
    val commandMs: Long? = null,
    val deliveryMs: Long? = null,
    val loadMs: Long? = null,
    val barrierMs: Long? = null,
)

/** Снапшот ядра (`engine::Snapshot`) плюс состояние связи. */
@Serializable
data class RoomSnapshot(
    val connected: Boolean = false,
    val peers: Int = 0,
    /** null — ядро не прислало очередь, потому что она не менялась. */
    val queue: List<TrackRef>? = null,
    val queueRevision: Long = 0,
    val index: Int = 0,
    val track: TrackRef? = null,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val playing: Boolean = false,
    val loading: Boolean = false,
    val volume: Float = 1f,
    val station: String? = null,
    val feeding: Boolean = false,
    val stationUnfed: Boolean = false,
    val driftMs: Long? = null,
    val rttMs: Long? = null,
    val hosting: String? = null,
    val listeners: List<Listener> = emptyList(),
    val repeat: String = "off",
    val shuffle: Boolean = false,
    val waiting: Boolean = false,
    val notice: String? = null,
    val roomPlaying: Boolean? = null,
    val localTrack: String? = null,
    val localLive: Boolean = true,
    val latency: Latency = Latency(),
    val trackLiked: Boolean = false,
    val likedRevision: Long = 0,
    val admin: Boolean = false,
    val hasPlus: Boolean? = null,
    /** `connecting`, `connected`, `reconnecting`, `stopped`. */
    val status: String = "connecting",
    val error: String? = null,
)

fun parseSnapshot(json: String): RoomSnapshot = coreJson.decodeFromString(RoomSnapshot.serializer(), json)

@Serializable
data class WavePreset(
    val id: String,
    val title: String,
    val description: String? = null,
    val seeds: List<String> = emptyList(),
    val coverUri: String? = null,
    val color: String? = null,
)

@Serializable
data class RoomListing(
    val name: String,
    val listeners: List<String> = emptyList(),
    val track: String? = null,
    val playing: Boolean = false,
    val wave: Boolean = false,
)

/** Что сказано о волне в строке станции комнаты (crates/core/src/station.rs). */
@Serializable
data class StationInfo(
    val seeds: List<String>,
    val name: String? = null,
    val description: String? = null,
    val by: String? = null,
)

/** Сид «Моей волны» без пресета (`api::WAVE_STATION` в ядре). */
const val PLAIN_WAVE_SEED = "user:onyourwave"

fun parseStation(station: String?): StationInfo? {
    if (station.isNullOrBlank()) return null
    if (station.trim().startsWith("{")) {
        runCatching { coreJson.decodeFromString(StationInfo.serializer(), station) }
            .getOrNull()
            ?.takeIf { it.seeds.isNotEmpty() }
            ?.let { return it }
    }
    return StationInfo(seeds = listOf(station))
}

/** Обычная «Моя волна», а не пресет по жанру, артисту или настроению. */
fun isPlainWave(wave: StationInfo): Boolean = wave.seeds.isEmpty() || wave.seeds == listOf(PLAIN_WAVE_SEED)

/** Команда комнате — тот же JSON, что `ymsync::ui::UiCommand` в ядре. */
sealed interface RoomCommand {
    fun toJson(): JsonElement

    private class Named(private val name: String, private val extra: (kotlinx.serialization.json.JsonObjectBuilder.() -> Unit) = {}) {
        fun json(): JsonObject = buildJsonObject {
            put("c", name)
            extra()
        }
    }

    data object Toggle : RoomCommand { override fun toJson() = Named("toggle").json() }
    data object Next : RoomCommand { override fun toJson() = Named("next").json() }
    data object Prev : RoomCommand { override fun toJson() = Named("prev").json() }
    data object StopWave : RoomCommand { override fun toJson() = Named("stop_wave").json() }

    data class Seek(val ms: Long) : RoomCommand {
        override fun toJson() = Named("seek") { put("ms", ms) }.json()
    }

    data class Index(val index: Int) : RoomCommand {
        override fun toJson() = Named("index") { put("index", index) }.json()
    }

    data class SetQueue(val tracks: List<TrackRef>, val start: Int) : RoomCommand {
        override fun toJson() = Named("set_queue") {
            put("tracks", coreJson.encodeToJsonElement(tracks))
            put("start", start)
        }.json()
    }

    data class Wave(val seeds: List<String> = emptyList(), val fresh: Boolean = false) : RoomCommand {
        override fun toJson() = Named("wave") {
            putJsonArray("seeds") { seeds.forEach { add(it) } }
            put("fresh", fresh)
        }.json()
    }

    data class WaveFeedback(val kind: String, val trackId: String) : RoomCommand {
        override fun toJson() = Named("wave_feedback") {
            put("kind", kind)
            put("track_id", trackId)
        }.json()
    }

    data class HandWave(val to: Long) : RoomCommand {
        override fun toJson() = Named("hand_wave") { put("to", to) }.json()
    }

    data class SetAdmin(val peer: Long) : RoomCommand {
        override fun toJson() = Named("set_admin") { put("peer", peer) }.json()
    }

    data class Repeat(val mode: String) : RoomCommand {
        override fun toJson() = Named("repeat") { put("mode", mode) }.json()
    }

    data class Shuffle(val on: Boolean) : RoomCommand {
        override fun toJson() = Named("shuffle") { put("on", on) }.json()
    }

    data class Name(val name: String) : RoomCommand {
        override fun toJson() = Named("name") { put("name", name) }.json()
    }

    data class Like(val track: TrackRef, val liked: Boolean) : RoomCommand {
        override fun toJson() = Named("like") {
            put("track", coreJson.encodeToJsonElement(track))
            put("liked", liked)
        }.json()
    }
}
