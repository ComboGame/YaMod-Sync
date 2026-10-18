package ru.combogame.yamodsync.ui.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ru.combogame.yamodsync.core.RoomCommand
import ru.combogame.yamodsync.core.RoomSnapshot
import ru.combogame.yamodsync.ui.components.Cover
import ru.combogame.yamodsync.ui.theme.YaTokens

/** Мини-плеер над вкладками: что играет, пауза, тонкая полоса прогресса. Нажатие — полный плеер. */
@Composable
fun MiniPlayer(snapshot: RoomSnapshot?, onCommand: (RoomCommand) -> Unit, onOpen: () -> Unit) {
    val track = snapshot?.track ?: return
    val playing = snapshot.roomPlaying == true || snapshot.waiting
    val duration = snapshot.durationMs.takeIf { it > 0 } ?: track.durationMs
    val progress = if (duration > 0) (snapshot.positionMs.toFloat() / duration).coerceIn(0f, 1f) else 0f
    val shape = RoundedCornerShape(YaTokens.RadiusButton)
    Column(
        Modifier
            .padding(horizontal = 8.dp, vertical = 4.dp)
            .fillMaxWidth()
            .clip(shape)
            .background(YaTokens.Surface1)
            .border(1.dp, YaTokens.BorderStrong, shape)
            .clickable(onClick = onOpen),
    ) {
        Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Cover(track.coverUri, 40.dp)
            Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                Text(track.title, style = MaterialTheme.typography.titleSmall, color = YaTokens.TextStrong, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(track.artist, style = MaterialTheme.typography.bodySmall, color = YaTokens.Text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Box(
                Modifier.size(36.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary).clickable { onCommand(RoomCommand.Toggle) },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                    contentDescription = if (playing) "Пауза" else "Играть",
                    tint = Color.Black,
                )
            }
        }
        Box(Modifier.fillMaxWidth().height(2.dp).background(YaTokens.Surface4)) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(progress).background(MaterialTheme.colorScheme.primary))
        }
    }
}
