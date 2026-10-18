package ru.combogame.yamodsync.ui.collection

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Shuffle
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ru.combogame.yamodsync.core.RoomCommand
import ru.combogame.yamodsync.core.RoomSnapshot
import ru.combogame.yamodsync.core.TrackRef
import ru.combogame.yamodsync.ui.components.Cover
import ru.combogame.yamodsync.ui.home.guestText
import ru.combogame.yamodsync.ui.home.waveOwner
import ru.combogame.yamodsync.ui.theme.YaTokens
import kotlin.random.Random

/**
 * Релей играет заданную очередь в том порядке, в каком её прислали, а его перемешивание
 * трогает только то, что впереди. Поэтому «Вперемешку» перемешивает список здесь и потом
 * включает перемешивание — для треков, которые добавят позже. По порядку — наоборот:
 * сначала выключить, чтобы новая очередь не легла поверх перемешанной комнаты.
 */
fun playLikes(tracks: List<TrackRef>, start: Int, shuffle: Boolean, random: Random = Random.Default): List<RoomCommand> =
    if (shuffle) {
        listOf(RoomCommand.SetQueue(tracks.shuffled(random), 0), RoomCommand.Shuffle(true))
    } else {
        listOf(RoomCommand.Shuffle(false), RoomCommand.SetQueue(tracks, start))
    }

fun tracksCount(n: Int): String {
    val word = when {
        n % 100 in 11..14 -> "треков"
        n % 10 == 1 -> "трек"
        n % 10 in 2..4 -> "трека"
        else -> "треков"
    }
    return "$n $word"
}

/**
 * «Мне нравится»: слушать по порядку, вперемешку или с любого трека. Очередь уходит
 * комнате, так что гостю чужой волны — тот же отказ, что на Главной.
 */
@Composable
fun CollectionScreen(snapshot: RoomSnapshot?, likes: List<TrackRef>?, onCommand: (RoomCommand) -> Unit) {
    val context = LocalContext.current
    // Снятый лайк пропадает сразу, не дожидаясь, пока список перечитается.
    var unliked by remember(likes) { mutableStateOf(emptySet<String>()) }
    val tracks = likes?.filterNot { it.trackId in unliked }

    fun play(start: Int, shuffle: Boolean) {
        val all = tracks ?: return
        if (all.isEmpty()) return
        val owner = waveOwner(snapshot)
        if (owner != null) {
            Toast.makeText(context, guestText(owner), Toast.LENGTH_LONG).show()
            return
        }
        playLikes(all, start, shuffle).forEach(onCommand)
    }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 8.dp)) {
        item {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    val accent = MaterialTheme.colorScheme.primary
                    Box(
                        Modifier.size(72.dp).clip(RoundedCornerShape(YaTokens.RadiusCard)).background(Brush.linearGradient(listOf(accent, accent.copy(alpha = 0.35f)))),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Rounded.Favorite, contentDescription = null, tint = Color.Black, modifier = Modifier.size(34.dp))
                    }
                    Column {
                        Text("Мне нравится", style = MaterialTheme.typography.titleLarge, color = YaTokens.TextStrong)
                        Text(
                            tracks?.let { tracksCount(it.size) } ?: "Загружаю…",
                            style = MaterialTheme.typography.bodyMedium,
                            color = YaTokens.TextMuted,
                        )
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ActionButton("Слушать", Icons.Rounded.PlayArrow, primary = true, Modifier.weight(1f)) { play(0, shuffle = false) }
                    ActionButton("Вперемешку", Icons.Rounded.Shuffle, primary = false, Modifier.weight(1f)) { play(0, shuffle = true) }
                }
            }
        }
        if (tracks != null && tracks.isEmpty()) {
            item {
                Text(
                    "Здесь появятся треки, которые вы отметили сердечком",
                    style = MaterialTheme.typography.bodyMedium,
                    color = YaTokens.TextMuted,
                    modifier = Modifier.padding(16.dp),
                )
            }
        }
        itemsIndexed(tracks.orEmpty(), key = { _, t -> t.trackId }) { index, track ->
            val current = snapshot?.track?.trackId == track.trackId
            Row(
                Modifier.fillMaxWidth().clickable { play(index, shuffle = false) }.padding(start = 16.dp, end = 4.dp, top = 6.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Cover(track.coverUri, 44.dp)
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    Text(
                        track.title,
                        style = MaterialTheme.typography.titleSmall,
                        color = if (current) MaterialTheme.colorScheme.primary else YaTokens.TextStrong,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(track.artist, style = MaterialTheme.typography.bodySmall, color = YaTokens.Text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                IconButton(onClick = {
                    unliked = unliked + track.trackId
                    onCommand(RoomCommand.Like(track, liked = false))
                }) {
                    Icon(Icons.Rounded.Favorite, contentDescription = "Убрать из «Мне нравится»", tint = MaterialTheme.colorScheme.primary)
                }
            }
        }
    }
}

@Composable
private fun ActionButton(text: String, icon: ImageVector, primary: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val shape = RoundedCornerShape(YaTokens.RadiusButton)
    val fg = if (primary) Color.Black else YaTokens.TextStrong
    Row(
        modifier
            .clip(shape)
            .background(if (primary) MaterialTheme.colorScheme.primary else YaTokens.Surface3)
            .then(if (primary) Modifier else Modifier.border(1.dp, YaTokens.Surface4, shape))
            .clickable(onClick = onClick)
            .padding(vertical = 11.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(20.dp))
        Text(text, style = MaterialTheme.typography.labelLarge, color = fg)
    }
}
