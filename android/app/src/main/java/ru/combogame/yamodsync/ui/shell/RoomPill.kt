package ru.combogame.yamodsync.ui.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ru.combogame.yamodsync.core.RoomSnapshot
import ru.combogame.yamodsync.ui.theme.YaTokens

/** «дом · 3», «Переподключаюсь», «Не в комнате». Своя комната телефона — не комната. */
fun roomPillText(snapshot: RoomSnapshot?, roomName: String?): String = when {
    roomName == null -> "Не в комнате"
    snapshot?.status == "reconnecting" || snapshot?.status == "connecting" -> "Переподключаюсь"
    else -> "$roomName · ${snapshot?.listeners?.size ?: 0}"
}

@Composable
fun RoomPill(snapshot: RoomSnapshot?, roomName: String?, onClick: () -> Unit) {
    val live = roomName != null && snapshot?.status == "connected"
    val dot = when {
        roomName == null -> YaTokens.Surface4
        !live -> YaTokens.Warning
        else -> MaterialTheme.colorScheme.primary
    }
    Row(
        Modifier
            .clip(CircleShape)
            .border(1.dp, if (live) MaterialTheme.colorScheme.primary.copy(alpha = 0.4f) else YaTokens.BorderStrong, CircleShape)
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(Modifier.size(7.dp).clip(CircleShape).background(dot))
        Text(
            roomPillText(snapshot, roomName),
            style = MaterialTheme.typography.labelMedium,
            color = if (live) YaTokens.TextStrong else YaTokens.Text,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
