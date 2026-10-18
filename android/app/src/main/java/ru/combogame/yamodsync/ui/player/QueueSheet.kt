package ru.combogame.yamodsync.ui.player

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ru.combogame.yamodsync.core.RoomSnapshot
import ru.combogame.yamodsync.ui.components.Cover
import ru.combogame.yamodsync.ui.theme.YaTokens

/** Сколько треков вперёд показать: волна подкладывает их сама, длинный хвост не нужен. */
private const val AHEAD = 50

/** Что сейчас и что дальше. Нажатие — перейти к треку (у всех в комнате). */
@Composable
fun QueueSheet(snapshot: RoomSnapshot, onPick: (Int) -> Unit, onDismiss: () -> Unit) {
    val queue = snapshot.queue.orEmpty()
    val from = snapshot.index.coerceIn(0, (queue.size - 1).coerceAtLeast(0))
    val shown = queue.withIndex().drop(from).take(AHEAD + 1)
    YaSheet("Очередь", onDismiss) {
        if (shown.isEmpty()) {
            Text("Очередь пуста", color = YaTokens.TextMuted, modifier = Modifier.padding(20.dp))
            return@YaSheet
        }
        LazyColumn(Modifier.heightIn(max = 560.dp)) {
            itemsIndexed(shown, key = { _, it -> "${it.index}:${it.value.trackId}" }) { n, (index, track) ->
                val current = index == snapshot.index
                if (n == 1) {
                    Text("Дальше", style = MaterialTheme.typography.labelLarge, color = YaTokens.TextMuted, modifier = Modifier.padding(start = 20.dp, top = 10.dp, bottom = 2.dp))
                }
                Row(
                    Modifier.fillMaxWidth().clickable(enabled = !current) { onPick(index) }.padding(horizontal = 20.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Cover(track.coverUri, 44.dp)
                    Column(Modifier.weight(1f).padding(start = 12.dp)) {
                        Text(
                            track.title,
                            style = MaterialTheme.typography.titleSmall,
                            color = if (current) MaterialTheme.colorScheme.primary else YaTokens.TextStrong,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(track.artist, style = MaterialTheme.typography.bodySmall, color = YaTokens.Text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Text(formatTime(track.durationMs), style = MaterialTheme.typography.labelMedium, color = YaTokens.TextMuted)
                }
            }
        }
    }
}
