package ru.combogame.yamodsync.ui.room

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Undo
import androidx.compose.material.icons.rounded.Waves
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ru.combogame.yamodsync.core.RoomCommand
import ru.combogame.yamodsync.core.RoomSnapshot
import ru.combogame.yamodsync.core.isPlainWave
import ru.combogame.yamodsync.core.parseStation
import ru.combogame.yamodsync.ui.components.YaButton
import ru.combogame.yamodsync.ui.components.YaCard
import ru.combogame.yamodsync.ui.home.canStartWave
import ru.combogame.yamodsync.ui.theme.YaTokens

/** Какая волна у комнаты, чья она и что с ней можно сделать отсюда — как `WaveCard` мода. */
@Composable
fun WaveCard(s: RoomSnapshot, onCommand: (RoomCommand) -> Unit) {
    val wave = parseStation(s.station)
    val canStart = canStartWave(s)
    if (wave == null) {
        YaCard(Modifier.fillMaxWidth()) {
            Header("Волна для всех", null, null)
            Text(
                if (canStart) "Треки подбираются для вашего аккаунта и играют у всех."
                else "Волну включает участник с Плюсом: треки подбираются для его аккаунта, а вы слушаете вместе со всеми.",
                style = MaterialTheme.typography.bodyMedium,
                color = YaTokens.Text,
                modifier = Modifier.padding(top = 8.dp),
            )
            if (canStart) YaButton("Включить «Мою волну»", { onCommand(RoomCommand.Wave()) }, Modifier.fillMaxWidth().padding(top = 12.dp), primary = false, icon = Icons.Rounded.Waves)
        }
        return
    }
    val whose = when {
        s.feeding -> "Подбирается для вас"
        wave.by != null -> "Подбирается для ${wave.by}"
        else -> "Подбирается для участника"
    }
    val preset = !isPlainWave(wave)
    YaCard(Modifier.fillMaxWidth(), brand = true) {
        Header(wave.name ?: "Моя волна", wave.description ?: "Моя волна", whose)
        when {
            s.stationUnfed -> {
                Note("Включивший волну вышел. Очередь доиграет, новых треков не будет.")
                if (canStart) YaButton("Продолжить со своего аккаунта", { onCommand(RoomCommand.Wave(wave.seeds)) }, Modifier.fillMaxWidth().padding(top = 8.dp))
                else Note("Продолжить её может участник с Плюсом.")
            }
            s.feeding -> {
                if (preset) YaButton("Вернуться к «Моей волне»", { onCommand(RoomCommand.Wave()) }, Modifier.fillMaxWidth().padding(top = 12.dp), icon = Icons.AutoMirrored.Rounded.Undo)
                YaButton("Выключить волну", { onCommand(RoomCommand.StopWave) }, Modifier.fillMaxWidth().padding(top = 8.dp), primary = false)
                HandOver(s, onCommand)
            }
            s.admin -> {
                Note("Волну ведёт ${wave.by ?: "участник"}. Вы админ комнаты: можете выключить её или передать другому.")
                YaButton("Выключить волну у ${wave.by ?: "участника"}", { onCommand(RoomCommand.StopWave) }, Modifier.fillMaxWidth().padding(top = 8.dp), primary = false)
                HandOver(s, onCommand)
            }
            else -> Note("Режим и очередь волны меняет ${wave.by ?: "тот, кто её включил"}. Пауза, перемотка и пропуск — общие.")
        }
    }
}

@Composable
private fun Header(title: String, subtitle: String?, whose: String?) {
    Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        val accent = MaterialTheme.colorScheme.primary
        Box(
            Modifier.size(40.dp).clip(RoundedCornerShape(10.dp)).background(if (whose != null) accent.copy(alpha = 0.18f) else YaTokens.Surface4),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Rounded.Waves, contentDescription = null, tint = if (whose != null) accent else YaTokens.TextMuted, modifier = Modifier.size(20.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall, color = YaTokens.TextStrong, maxLines = 1, overflow = TextOverflow.Ellipsis)
            subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = YaTokens.Text, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            whose?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = accent, modifier = Modifier.padding(top = 2.dp)) }
        }
    }
}

@Composable
private fun Note(text: String) = Text(text, style = MaterialTheme.typography.bodyMedium, color = YaTokens.Text, modifier = Modifier.padding(top = 10.dp))

/** «Передать волну…» — выбор из участников; выбор — действие, поле снова пустое. */
@Composable
private fun HandOver(s: RoomSnapshot, onCommand: (RoomCommand) -> Unit) {
    val candidates = handOverCandidates(s)
    if (candidates.isEmpty()) return
    var open by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxWidth().padding(top = 8.dp)) {
        YaButton("Передать волну…", { open = true }, Modifier.fillMaxWidth(), primary = false)
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, containerColor = YaTokens.Surface2) {
            candidates.forEach { l ->
                DropdownMenuItem(
                    text = { Text(if (l.you) "${l.name} (вы)" else l.name, color = YaTokens.TextStrong) },
                    onClick = {
                        open = false
                        onCommand(RoomCommand.HandWave(l.peer))
                    },
                )
            }
        }
    }
}
