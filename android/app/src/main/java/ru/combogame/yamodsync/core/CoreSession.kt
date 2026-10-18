package ru.combogame.yamodsync.core

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

@Serializable
data class RoomConfig(val relay: String, val room: String, val password: String)

/** То, что ядро принимает в `start` (`session::StartConfig`). */
@Serializable
data class StartConfig(
    val token: String = "",
    val clientId: String = "",
    val dataDir: String,
    /** `high` или `economy`. */
    val quality: String = "high",
    val name: String = "",
    /** null — своя комната на телефоне. */
    val room: RoomConfig? = null,
)

/** Ошибка ядра с кодом, по которому приложение решает, что делать. */
class CoreError(val code: String, message: String) : Exception(message)

/** Разбирает ответ ядра: `ok` — значение, `error` — [CoreError]. */
fun parseReply(text: String): Result<JsonElement> {
    val reply = runCatching { coreJson.parseToJsonElement(text).jsonObject }.getOrElse {
        return Result.failure(CoreError("bad_reply", "ядро ответило непонятно"))
    }
    reply["ok"]?.let { return Result.success(it) }
    val message = (reply["error"] as? JsonPrimitive)?.content ?: "ошибка ядра"
    val code = (reply["code"] as? JsonPrimitive)?.content ?: "error"
    return Result.failure(CoreError(code, message))
}

/**
 * Живая сессия ядра: запуск, опрос снапшота несколько раз в секунду, команды.
 * Звонки в ядро — на [io]: `start` открывает звук и сеть, остальное короткое,
 * но не для главного потока.
 */
class CoreSession(
    private val native: NativeApi,
    private val scope: CoroutineScope,
    private val io: CoroutineDispatcher,
    private val pollMs: Long = 250,
) {
    private val _snapshot = MutableStateFlow<RoomSnapshot?>(null)
    val snapshot: StateFlow<RoomSnapshot?> = _snapshot.asStateFlow()

    @Volatile
    private var handle = 0L
    private var polling: Job? = null

    val running: Boolean get() = handle != 0L

    suspend fun start(config: StartConfig): Result<Unit> = withContext(io) {
        stopNow()
        val json = coreJson.encodeToString(StartConfig.serializer(), config)
        parseReply(native.start(json)).mapCatching { value ->
            handle = value.jsonPrimitive.longOrNull ?: throw CoreError("bad_reply", "ядро не вернуло сессию")
            polling = scope.launch(io) { poll() }
        }
    }

    private suspend fun poll() {
        while (scope.isActive && handle != 0L) {
            val current = handle
            parseReply(native.snapshot(current)).onSuccess { value ->
                val fresh = runCatching { coreJson.decodeFromJsonElement(RoomSnapshot.serializer(), value) }.getOrNull()
                if (fresh != null && current == handle) {
                    // Ядро шлёт очередь, только когда она изменилась: иначе — прежняя.
                    val queue = fresh.queue ?: _snapshot.value?.queue
                    _snapshot.value = fresh.copy(queue = queue)
                }
            }
            delay(pollMs)
        }
    }

    fun command(command: RoomCommand) {
        val current = handle
        if (current == 0L) return
        val json = command.toJson().toString()
        scope.launch(io) { native.command(current, json) }
    }

    suspend fun stop() = withContext(io) { stopNow() }

    private fun stopNow() {
        polling?.cancel()
        polling = null
        val current = handle
        handle = 0L
        if (current != 0L) native.stop(current)
    }

    suspend fun likes(): Result<List<TrackRef>> = call { native.likes(it) }.mapCatching { value ->
        val tracks = (value as JsonObject)["tracks"] ?: return@mapCatching emptyList()
        coreJson.decodeFromJsonElement(ListSerializer(TrackRef.serializer()), tracks)
    }

    suspend fun lyrics(trackId: String): Result<JsonElement> = call { native.lyrics(it, trackId) }

    suspend fun wavePresets(): Result<List<WavePreset>> = call { native.wavePresets(it) }.mapCatching {
        coreJson.decodeFromJsonElement(ListSerializer(WavePreset.serializer()), it)
    }

    private suspend fun call(block: (Long) -> String): Result<JsonElement> = withContext(io) {
        val current = handle
        if (current == 0L) Result.failure(CoreError("no_session", "сессия не запущена")) else parseReply(block(current))
    }
}
