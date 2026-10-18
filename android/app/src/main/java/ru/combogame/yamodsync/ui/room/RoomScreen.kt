package ru.combogame.yamodsync.ui.room

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ru.combogame.yamodsync.core.RoomCommand
import ru.combogame.yamodsync.core.RoomConfig
import ru.combogame.yamodsync.core.RoomListing
import ru.combogame.yamodsync.core.RoomSnapshot
import ru.combogame.yamodsync.settings.AppSettings
import ru.combogame.yamodsync.ui.components.Cover
import ru.combogame.yamodsync.ui.components.YaButton
import ru.combogame.yamodsync.ui.components.YaCard
import ru.combogame.yamodsync.ui.player.SyncTone
import ru.combogame.yamodsync.ui.player.syncLine
import ru.combogame.yamodsync.ui.theme.YaTokens

/** Сколько треков показать в «Дальше»; вся очередь — в плеере. */
private const val UP_NEXT = 3

/** Вкладка «Комната»: не в комнате — форма входа, в комнате — что играет, волна, участники. */
@Composable
fun RoomScreen(
    snapshot: RoomSnapshot?,
    room: RoomConfig?,
    settings: AppSettings,
    loadRooms: suspend (String, String) -> Result<List<RoomListing>>,
    onJoin: (RoomConfig, String) -> Unit,
    onLeave: () -> Unit,
    onCommand: (RoomCommand) -> Unit,
    onOpenPlayer: () -> Unit,
) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        if (room == null) {
            JoinForm(settings.relay, settings.password, settings.name, settings.room, loadRooms, onJoin)
        } else {
            InRoom(snapshot ?: RoomSnapshot(), room, onLeave, onCommand, onOpenPlayer)
        }
    }
}

@Composable
private fun InRoom(s: RoomSnapshot, room: RoomConfig, onLeave: () -> Unit, onCommand: (RoomCommand) -> Unit, onOpenPlayer: () -> Unit) {
    Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        YaCard(Modifier.fillMaxWidth()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(room.room, style = MaterialTheme.typography.titleLarge, color = YaTokens.TextStrong, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        when (s.status) {
                            "connected" -> s.rttMs?.let { "На связи · пинг $it мс" } ?: "На связи"
                            "reconnecting" -> "Связь пропала — переподключаюсь"
                            "stopped" -> "Отключено"
                            else -> "Подключаюсь…"
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = if (s.status == "connected") YaTokens.Text else YaTokens.Warning,
                    )
                }
                YaButton("Выйти", onLeave, primary = false, icon = Icons.AutoMirrored.Rounded.Logout)
            }
            s.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = YaTokens.Danger, modifier = Modifier.padding(top = 8.dp)) }
            s.notice?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = YaTokens.Text, modifier = Modifier.padding(top = 8.dp)) }
        }

        YaCard(Modifier.fillMaxWidth().clickable(onClick = onOpenPlayer)) {
            val track = s.track
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Cover(track?.coverUri, 72.dp, radius = 12.dp)
                Column(Modifier.weight(1f)) {
                    Text(track?.title ?: "Ничего не играет", style = MaterialTheme.typography.titleMedium, color = YaTokens.TextStrong, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        track?.artist ?: "Включите волну или «Мне нравится» — заиграет у всех",
                        style = MaterialTheme.typography.bodySmall,
                        color = YaTokens.Text,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    syncLine(s, inRoom = true)?.let { line ->
                        Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            val color = when (line.tone) {
                                SyncTone.Together -> MaterialTheme.colorScheme.primary
                                SyncTone.Catching -> YaTokens.Warning
                                SyncTone.Idle -> YaTokens.Surface4
                            }
                            Box(Modifier.size(8.dp).clip(CircleShape).background(color))
                            Text(line.text, style = MaterialTheme.typography.labelMedium, color = if (line.tone == SyncTone.Together) color else YaTokens.TextMuted)
                        }
                    }
                }
            }
        }

        WaveCard(s, onCommand)
        Listeners(s, onCommand)

        val next = s.queue.orEmpty().drop(s.index + 1).take(UP_NEXT)
        if (next.isNotEmpty()) {
            YaCard(Modifier.fillMaxWidth()) {
                Text("Дальше", style = MaterialTheme.typography.titleSmall, color = YaTokens.TextStrong, modifier = Modifier.padding(bottom = 6.dp))
                next.forEach { t ->
                    Row(Modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Cover(t.coverUri, 36.dp, radius = 6.dp)
                        Column(Modifier.weight(1f)) {
                            Text(t.title, style = MaterialTheme.typography.bodyMedium, color = YaTokens.TextStrong, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(t.artist, style = MaterialTheme.typography.bodySmall, color = YaTokens.TextMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
        }
    }
}
