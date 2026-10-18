package ru.combogame.yamodsync.ui.player

import ru.combogame.yamodsync.core.LyricLine
import ru.combogame.yamodsync.core.RoomSnapshot
import ru.combogame.yamodsync.core.TrackRef
import ru.combogame.yamodsync.core.isPlainWave
import ru.combogame.yamodsync.core.parseStation
import kotlin.math.abs

/**
 * «Сейчас играет / …». Откуда очередь, снапшот не говорит; очередь, вся из «Мне нравится»,
 * и есть «Мне нравится» — так подпись верна, кто бы её ни включил.
 */
fun sourceLabel(s: RoomSnapshot, roomName: String?, liked: Set<String>): String {
    val station = parseStation(s.station)
    if (station != null) {
        if (roomName != null) return "Волна комнаты «$roomName»"
        return station.name?.takeUnless { isPlainWave(station) } ?: "Моя волна"
    }
    val queue = s.queue.orEmpty()
    if (queue.isNotEmpty() && queue.all { it.trackId in liked }) return "Мне нравится"
    return if (roomName != null) "Очередь комнаты" else "Очередь"
}

enum class SyncTone { Together, Catching, Idle }

data class SyncLine(val tone: SyncTone, val text: String)

/** Ближе этого — «в синхроне», как в моде (`now-playing.tsx::syncState`). */
private const val TOGETHER_MS = 120

/** Строка под кнопками; без комнаты её нет — синхронизироваться не с кем. */
fun syncLine(s: RoomSnapshot, inRoom: Boolean): SyncLine? {
    if (!inRoom) return null
    val track = s.track ?: return SyncLine(SyncTone.Idle, "В комнате тихо")
    val drift = s.driftMs
    return when {
        s.waiting -> SyncLine(SyncTone.Idle, "Ждём, пока трек загрузится у всех")
        s.roomPlaying == null -> SyncLine(SyncTone.Catching, "Узнаю, что играет в комнате")
        s.roomPlaying == false -> SyncLine(SyncTone.Idle, "Пауза у всех")
        s.loading -> SyncLine(SyncTone.Catching, "Загружаю трек")
        s.localTrack != null && s.localTrack != track.trackId -> SyncLine(SyncTone.Catching, "Ставлю трек комнаты")
        drift == null -> SyncLine(SyncTone.Catching, "Выравниваю позицию")
        abs(drift) <= TOGETHER_MS -> SyncLine(SyncTone.Together, "В синхроне с комнатой · ${abs(drift)} мс")
        else -> SyncLine(SyncTone.Catching, "Догоняю комнату · ${abs(drift)} мс")
    }
}

fun formatTime(ms: Long): String {
    val total = (ms.coerceAtLeast(0) / 1000).toInt()
    return "%02d:%02d".format(total / 60, total % 60)
}

fun shareUrl(track: TrackRef): String =
    track.albumId?.let { "https://music.yandex.ru/album/$it/track/${track.trackId}" } ?: "https://music.yandex.ru/track/${track.trackId}"

/** Номер строки, которая сейчас поётся: последняя начавшаяся, -1 — ещё ни одна. */
fun currentLine(lines: List<LyricLine>, positionMs: Long): Int = lines.indexOfLast { it.atMs <= positionMs }
