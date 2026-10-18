package ru.combogame.yamodsync.ui.player

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Undo
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ru.combogame.yamodsync.core.PLAIN_WAVE_SEED
import ru.combogame.yamodsync.core.RoomCommand
import ru.combogame.yamodsync.core.RoomSnapshot
import ru.combogame.yamodsync.core.WavePreset
import ru.combogame.yamodsync.core.isPlainWave
import ru.combogame.yamodsync.core.parseStation
import ru.combogame.yamodsync.ui.home.PresetCarousel
import ru.combogame.yamodsync.ui.home.waveCommand
import ru.combogame.yamodsync.ui.theme.YaTokens

/** Режим волны прямо из плеера — та же карусель, что на Главной. */
@Composable
fun PresetsSheet(snapshot: RoomSnapshot, presets: List<WavePreset>?, onWave: (RoomCommand) -> Unit, onDismiss: () -> Unit) {
    val station = parseStation(snapshot.station)
    val plain = station == null || isPlainWave(station)
    val current = if (plain) null else presets?.firstOrNull { it.seeds == station?.seeds }?.id
    YaSheet("Режим волны", onDismiss) {
        when {
            presets == null -> Text("Загружаю…", color = YaTokens.TextMuted, modifier = Modifier.padding(20.dp))
            presets.isEmpty() -> Text("Яндекс не прислал режимы", color = YaTokens.TextMuted, modifier = Modifier.padding(20.dp))
            else -> Box(Modifier.padding(vertical = 8.dp)) { PresetCarousel(presets, current) { onWave(waveCommand(it)) } }
        }
        SheetRow("Встряхнуть", Icons.Rounded.Refresh) {
            onWave(RoomCommand.Wave(station?.seeds?.filter { it != PLAIN_WAVE_SEED } ?: emptyList(), fresh = true))
        }
        if (!plain) SheetRow("Вернуться к «Моей волне»", Icons.AutoMirrored.Rounded.Undo) { onWave(waveCommand(null)) }
    }
}
