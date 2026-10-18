package ru.combogame.yamodsync.ui.room

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Waves
import androidx.compose.material.icons.rounded.WorkspacePremium
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ru.combogame.yamodsync.core.RoomCommand
import ru.combogame.yamodsync.core.RoomSnapshot
import ru.combogame.yamodsync.ui.components.Avatar
import ru.combogame.yamodsync.ui.components.Badge
import ru.combogame.yamodsync.ui.components.BadgeTone
import ru.combogame.yamodsync.ui.components.YaCard
import ru.combogame.yamodsync.ui.theme.YaTokens

/** «Слушают»: участники со значками; админу — передать волну и права. */
@Composable
fun Listeners(s: RoomSnapshot, onCommand: (RoomCommand) -> Unit) {
    YaCard(Modifier.fillMaxWidth()) {
        Text("Слушают · ${s.listeners.size}", style = MaterialTheme.typography.titleSmall, color = YaTokens.TextStrong, modifier = Modifier.padding(bottom = 6.dp))
        Column {
            s.listeners.forEach { row ->
                Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Avatar(row.name.ifBlank { "?" }, size = 30.dp)
                    Column(Modifier.weight(1f)) {
                        Text(row.name.ifBlank { "Без имени" }, style = MaterialTheme.typography.bodyLarge, color = YaTokens.TextStrong, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            if (row.you) Badge("вы", BadgeTone.Brand)
                            if (row.admin) Badge("админ")
                            if (row.feeds && !s.stationUnfed) Badge("волна")
                            if (row.plus == false) Badge("без Плюса", BadgeTone.Muted)
                            if (row.you && s.hosting != null) Badge("хост")
                        }
                    }
                    val actions = adminActions(s, row)
                    if (AdminAction.HandWave in actions) {
                        IconButton(onClick = { onCommand(RoomCommand.HandWave(row.peer)) }) {
                            Icon(Icons.Rounded.Waves, contentDescription = "Передать волну: ${row.name}", tint = YaTokens.Text)
                        }
                    }
                    if (AdminAction.MakeAdmin in actions) {
                        IconButton(onClick = { onCommand(RoomCommand.SetAdmin(row.peer)) }) {
                            Icon(Icons.Rounded.WorkspacePremium, contentDescription = "Сделать админом: ${row.name}", tint = YaTokens.Text)
                        }
                    }
                }
            }
        }
    }
}
