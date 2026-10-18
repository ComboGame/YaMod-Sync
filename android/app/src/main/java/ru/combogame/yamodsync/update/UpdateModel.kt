package ru.combogame.yamodsync.update

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

sealed interface UpdateState {
    data object Idle : UpdateState
    data object Checking : UpdateState
    data object UpToDate : UpdateState
    data class Available(val release: Release) : UpdateState
    data class Downloading(val release: Release, val progress: Float) : UpdateState
    /** Скачано и проверено; `note` — почему установщик ещё не открылся (нужно разрешение и т. п.). */
    data class Ready(val release: Release, val file: File, val note: String? = null) : UpdateState
    data class Failed(val message: String, val release: Release? = null) : UpdateState
}

/** Первая проверка — через столько после запуска, как у мода: не мешать старту. */
private const val FIRST_CHECK_MS = 15_000L
private const val CHECK_EVERY_MS = 6 * 60 * 60 * 1000L

/** Проверка обновлений по расписанию и по кнопке, скачивание и установка. */
class UpdateModel(private val context: Context, private val scope: CoroutineScope) {
    private val _state = MutableStateFlow<UpdateState>(UpdateState.Idle)
    val state: StateFlow<UpdateState> = _state.asStateFlow()
    val current: String = Updater.currentVersion(context)
    private var work: Job? = null

    init {
        scope.launch {
            delay(FIRST_CHECK_MS)
            while (true) {
                // Найденное, скачанное или качающееся не сбрасывается проверкой по таймеру.
                if (_state.value.let { it is UpdateState.Idle || it is UpdateState.UpToDate || it is UpdateState.Failed }) check()
                delay(CHECK_EVERY_MS)
            }
        }
    }

    fun check() {
        if (work?.isActive == true) return
        work = scope.launch {
            _state.value = UpdateState.Checking
            _state.value = runCatching { Updater.latest(context) }.fold(
                onSuccess = { it?.let(UpdateState::Available) ?: UpdateState.UpToDate },
                onFailure = { UpdateState.Failed("Не удалось проверить: ${it.message ?: "нет связи"}") },
            )
        }
    }

    /** Скачать (если ещё нет) и отдать установщику. */
    fun install() {
        if (work?.isActive == true) return
        val state = _state.value
        val release = when (state) {
            is UpdateState.Available -> state.release
            is UpdateState.Ready -> {
                work = scope.launch { handOver(state) }
                return
            }
            is UpdateState.Failed -> state.release ?: return
            else -> return
        }
        work = scope.launch {
            _state.value = UpdateState.Downloading(release, 0f)
            runCatching {
                Updater.download(context, release) { _state.value = UpdateState.Downloading(release, it) }
            }.fold(
                onSuccess = { handOver(UpdateState.Ready(release, it)) },
                onFailure = { _state.value = UpdateState.Failed("Не скачалось: ${it.message ?: "ошибка"}", release) },
            )
        }
    }

    /** Запись APK в сессию установщика — дисковая работа, не для главного потока. */
    private suspend fun handOver(ready: UpdateState.Ready) {
        _state.value = ready
        val refusal = withContext(Dispatchers.IO) {
            runCatching { Updater.install(context, ready.file) }.getOrElse { "Не удалось начать установку: ${it.message}" }
        }
        // Файл остаётся: после разрешения «Установить» нажимают ещё раз.
        _state.value = ready.copy(note = refusal)
    }

    fun installFailed(message: String) {
        val state = _state.value
        _state.value = if (state is UpdateState.Ready) state.copy(note = message) else UpdateState.Failed(message)
    }
}
