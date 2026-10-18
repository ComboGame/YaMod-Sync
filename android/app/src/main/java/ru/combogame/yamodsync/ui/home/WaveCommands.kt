package ru.combogame.yamodsync.ui.home

import ru.combogame.yamodsync.core.RoomCommand
import ru.combogame.yamodsync.core.RoomSnapshot
import ru.combogame.yamodsync.core.WavePreset
import ru.combogame.yamodsync.core.parseStation

/** Те же фразы, что в моде (controller.ts): участник видит одно и то же на ПК и на телефоне. */
const val NEEDS_PLUS_TEXT = "Без Плюса волну не включить: её включает участник с подпиской, а вы слушаете вместе со всеми"

fun guestText(owner: String) = "Волну ведёт $owner: режим и очередь меняет только он"

/** «Моя волна» без пресета — пустые сиды: ядро само подставит `user:onyourwave`. */
fun waveCommand(preset: WavePreset?): RoomCommand = RoomCommand.Wave(preset?.seeds ?: emptyList())

/** Без Плюса волну не вести: её треки подбирались бы с вашего аккаунта. Не узнали — пусть решает Яндекс. */
fun canStartWave(s: RoomSnapshot?): Boolean = s?.hasPlus != false

/**
 * Волну комнаты ведёт другой участник, и он здесь: её очередь и режим — его.
 * Своя, админская (админ ведёт комнату целиком) и брошенная волна — общие.
 */
fun waveOwner(s: RoomSnapshot?): String? {
    if (s?.station == null || s.stationUnfed || s.feeding || s.admin) return null
    return parseStation(s.station)?.by ?: "другой участник"
}

/** Почему нельзя сменить волну, или null, если можно. Сначала владелец: гостю Плюс не поможет. */
fun waveRefusal(s: RoomSnapshot?): String? = waveOwner(s)?.let(::guestText) ?: NEEDS_PLUS_TEXT.takeUnless { canStartWave(s) }
