package ru.combogame.yamodsync.ui.player

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ru.combogame.yamodsync.core.Lyrics
import ru.combogame.yamodsync.ui.theme.YaTokens

/** Что вышло с текстом: ещё грузится, нет у трека, есть. */
sealed interface LyricsState {
    data object Loading : LyricsState
    data object Missing : LyricsState
    data class Found(val lyrics: Lyrics) : LyricsState
}

/** Текст песни. Строки со временем подсвечиваются и сами прокручиваются за песней. */
@Composable
fun LyricsSheet(trackId: String, positionMs: () -> Long, load: suspend (String) -> Lyrics?, onDismiss: () -> Unit) {
    val state by produceState<LyricsState>(LyricsState.Loading, trackId) {
        value = load(trackId)?.let { LyricsState.Found(it) } ?: LyricsState.Missing
    }
    YaSheet("Текст песни", onDismiss, skipPartiallyExpanded = true) {
        Box(Modifier.fillMaxWidth().height(520.dp).padding(horizontal = 20.dp, vertical = 8.dp)) {
            when (val s = state) {
                LyricsState.Loading -> Text("Загружаю…", color = YaTokens.TextMuted)
                LyricsState.Missing -> Text("У этого трека нет текста", color = YaTokens.TextMuted)
                is LyricsState.Found -> LyricsBody(s.lyrics, positionMs)
            }
        }
    }
}

@Composable
private fun LyricsBody(lyrics: Lyrics, positionMs: () -> Long) {
    val list = rememberLazyListState()
    val now = remember { mutableStateOf(-1) }
    if (lyrics.synced && lyrics.lines.isNotEmpty()) {
        LaunchedEffect(lyrics) {
            while (true) {
                val line = currentLine(lyrics.lines, positionMs())
                if (line != now.value) {
                    now.value = line
                    if (line >= 0) list.animateScrollToItem((line - 2).coerceAtLeast(0))
                }
                kotlinx.coroutines.delay(200)
            }
        }
    }
    LazyColumn(state = list) {
        if (lyrics.synced && lyrics.lines.isNotEmpty()) {
            itemsIndexed(lyrics.lines) { i, line ->
                val current = i == now.value
                Text(
                    line.text.ifBlank { "♪" },
                    style = MaterialTheme.typography.titleLarge,
                    color = when {
                        current -> MaterialTheme.colorScheme.primary
                        i < now.value -> YaTokens.TextMuted
                        else -> YaTokens.TextStrong
                    },
                    modifier = Modifier.padding(vertical = 6.dp),
                )
            }
        } else {
            item { Text(lyrics.text, style = MaterialTheme.typography.bodyLarge, color = YaTokens.TextStrong) }
        }
        if (lyrics.writers.isNotEmpty()) {
            item {
                Text(
                    "Авторы: " + lyrics.writers.joinToString(", "),
                    style = MaterialTheme.typography.bodySmall,
                    color = YaTokens.TextMuted,
                    modifier = Modifier.padding(top = 20.dp, bottom = 8.dp),
                )
            }
        }
    }
}
