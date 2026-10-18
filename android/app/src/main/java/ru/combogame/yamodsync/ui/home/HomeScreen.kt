package ru.combogame.yamodsync.ui.home

import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import ru.combogame.yamodsync.core.PLAIN_WAVE_SEED
import ru.combogame.yamodsync.core.RoomCommand
import ru.combogame.yamodsync.core.RoomSnapshot
import ru.combogame.yamodsync.playback.mutedHere
import ru.combogame.yamodsync.core.WavePreset
import ru.combogame.yamodsync.core.isPlainWave
import ru.combogame.yamodsync.core.parseStation
import ru.combogame.yamodsync.ui.theme.YaTokens

/**
 * Главная: «Моя волна» крупно, под ней режимы. Волна — общая для комнаты: гостю чужой
 * волны и без Плюса смена режима отказывает теми же словами, что и мод.
 */
@Composable
fun HomeScreen(snapshot: RoomSnapshot?, presets: List<WavePreset>?, inRoom: Boolean, onCommand: (RoomCommand) -> Unit) {
    val context = LocalContext.current
    val station = parseStation(snapshot?.station)
    val plain = station == null || isPlainWave(station)
    val owner = waveOwner(snapshot)
    val unfed = snapshot?.stationUnfed == true
    val view = waveHeroView(station, owner, snapshot?.roomPlaying == true && !snapshot.mutedHere, unfed, plain, inRoom)
    val current = if (station == null || plain) null else presets?.firstOrNull { it.seeds == station.seeds }?.id

    fun guarded(command: RoomCommand) {
        val refusal = waveRefusal(snapshot)
        if (refusal != null) Toast.makeText(context, refusal, Toast.LENGTH_LONG).show() else onCommand(command)
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Column(Modifier.padding(horizontal = 16.dp)) {
            WaveHero(
                view,
                // Пауза и продолжение общие — их можно и гостю.
                onPlay = { if (station != null) onCommand(RoomCommand.Toggle) else guarded(waveCommand(null)) },
                onShake = { guarded(RoomCommand.Wave(station?.seeds?.filter { it != PLAIN_WAVE_SEED } ?: emptyList(), fresh = true)) },
                onBackToMyWave = { guarded(waveCommand(null)) },
                // Брошенная волна общая, но вести её можно только с Плюсом.
                onContinue = { guarded(RoomCommand.Wave(station?.seeds ?: emptyList())) },
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Режимы", style = MaterialTheme.typography.titleMedium, color = YaTokens.TextStrong, modifier = Modifier.padding(horizontal = 16.dp))
            val hint = when {
                presets == null -> "Загружаю…"
                presets.isEmpty() -> "Яндекс не прислал режимы"
                else -> null
            }
            if (hint != null) {
                Text(hint, style = MaterialTheme.typography.bodyMedium, color = YaTokens.TextMuted, modifier = Modifier.padding(horizontal = 16.dp))
            } else {
                PresetCarousel(presets!!, current) { guarded(waveCommand(it)) }
            }
        }
    }
}
