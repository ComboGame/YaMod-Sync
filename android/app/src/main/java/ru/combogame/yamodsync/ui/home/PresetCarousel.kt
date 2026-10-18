package ru.combogame.yamodsync.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import ru.combogame.yamodsync.core.WavePreset
import ru.combogame.yamodsync.playback.coverUrl
import ru.combogame.yamodsync.ui.theme.YaTokens

/** `#rrggbb` из колеса Яндекса; что-то другое — без подкраски. */
fun presetColor(hex: String?): Color? = hex
    ?.removePrefix("#")
    ?.takeIf { it.length == 6 }
    ?.toLongOrNull(16)
    ?.let { Color(0xFF000000 or it) }

/** Режимы волны — как карусель колеса на главной Яндекс Музыки. Текущий подсвечен. */
@Composable
fun PresetCarousel(presets: List<WavePreset>, current: String?, onPick: (WavePreset) -> Unit) {
    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        items(presets, key = { it.id }) { preset ->
            val selected = preset.id == current
            val shape = RoundedCornerShape(YaTokens.RadiusCard)
            val tint = presetColor(preset.color) ?: YaTokens.Surface4
            Column(Modifier.width(132.dp).clickable { onPick(preset) }) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .aspectRatio(1f)
                        .clip(shape)
                        .background(Brush.linearGradient(listOf(tint, tint.copy(alpha = 0.35f))))
                        .border(if (selected) 2.dp else 1.dp, if (selected) MaterialTheme.colorScheme.primary else YaTokens.BorderStrong, shape),
                ) {
                    coverUrl(preset.coverUri, 300)?.let {
                        AsyncImage(model = it, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                    }
                }
                Text(
                    preset.title,
                    style = MaterialTheme.typography.titleSmall,
                    color = if (selected) MaterialTheme.colorScheme.primary else YaTokens.TextStrong,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 6.dp),
                )
                preset.description?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = YaTokens.TextMuted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}
