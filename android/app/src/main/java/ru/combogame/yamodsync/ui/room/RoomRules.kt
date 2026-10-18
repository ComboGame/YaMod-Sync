package ru.combogame.yamodsync.ui.room

import ru.combogame.yamodsync.core.Listener
import ru.combogame.yamodsync.core.RoomListing
import ru.combogame.yamodsync.core.RoomSnapshot
import ru.combogame.yamodsync.core.StationInfo

/**
 * Кому можно передать волну — как `wave-card.tsx` мода: всем, кроме того, кто её уже
 * ведёт, и тех, у кого нет Плюса. Себе — только админу (забрать чужую волну).
 */
fun handOverCandidates(s: RoomSnapshot): List<Listener> =
    s.listeners.filter { !it.feeds && it.plus != false && (s.admin || !it.you) }

enum class AdminAction { HandWave, MakeAdmin }

/** Что админ может сделать с участником (`listeners.tsx::AdminActions`). Со своей строкой — ничего. */
fun adminActions(s: RoomSnapshot, row: Listener): Set<AdminAction> {
    if (!s.admin || row.you) return emptySet()
    val canHand = s.station != null && !row.feeds && row.plus != false
    return if (canHand) setOf(AdminAction.HandWave, AdminAction.MakeAdmin) else setOf(AdminAction.MakeAdmin)
}

/** Комната из списка — «Войти», новое название — «Создать». */
fun joinButtonText(room: String, listed: List<RoomListing>): String =
    if (listed.any { it.name == room.trim() }) "Войти" else "Создать"

/** Ядро пишет ошибку со строчной буквы (её вставляют в середину фразы); на экране она — предложение. */
fun roomsErrorText(code: String, message: String): String = message.replaceFirstChar { it.uppercase() }

/**
 * Кто ведёт волну — строка под её названием. Имя не склоняется («для Роман» — ошибка),
 * поэтому «ведёт». Ушедший ведущий уже ничего не подбирает: тогда так и сказано.
 */
fun waveLeader(s: RoomSnapshot, wave: StationInfo): String = when {
    s.stationUnfed -> "Без ведущего"
    s.feeding -> "Подбирается для вас"
    wave.by != null -> "Ведёт ${wave.by}"
    else -> "Ведёт другой участник"
}
