package ru.combogame.yamodsync.ui.room

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.GraphicEq
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ru.combogame.yamodsync.core.RoomListing
import ru.combogame.yamodsync.ui.components.Badge
import ru.combogame.yamodsync.ui.theme.YaTokens

/** Комнаты сервера: кто слушает и что играет. Нажатие — войти. */
@Composable
fun RoomList(rooms: List<RoomListing>, onPick: (RoomListing) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        rooms.forEach { room ->
            val shape = RoundedCornerShape(YaTokens.RadiusButton)
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(shape)
                    .background(YaTokens.Surface2)
                    .border(1.dp, YaTokens.Surface3, shape)
                    .clickable { onPick(room) }
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(room.name, style = MaterialTheme.typography.titleSmall, color = YaTokens.TextStrong, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (room.wave) Badge("волна")
                    }
                    Text(
                        if (room.listeners.isEmpty()) "Пока никого" else room.listeners.joinToString(", "),
                        style = MaterialTheme.typography.bodySmall,
                        color = YaTokens.Text,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    room.track?.let {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            if (room.playing) Icon(Icons.Rounded.GraphicEq, contentDescription = "Играет", tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(14.dp))
                            Text(it, style = MaterialTheme.typography.bodySmall, color = YaTokens.TextMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
                Icon(Icons.AutoMirrored.Rounded.ArrowForward, contentDescription = "Войти", tint = YaTokens.TextMuted)
            }
        }
    }
}
