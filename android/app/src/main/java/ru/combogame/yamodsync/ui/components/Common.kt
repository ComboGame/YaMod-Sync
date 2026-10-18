package ru.combogame.yamodsync.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import ru.combogame.yamodsync.playback.coverUrl
import ru.combogame.yamodsync.ui.theme.YaTokens

/** Карточка — слой над фоном, как карточки Modrinth: поверхность, рамка, радиус 16. */
@Composable
fun YaCard(modifier: Modifier = Modifier, brand: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    val shape = RoundedCornerShape(YaTokens.RadiusCard)
    Column(
        modifier
            .clip(shape)
            .background(if (brand) MaterialTheme.colorScheme.primary.copy(alpha = 0.08f) else YaTokens.Surface1)
            .border(1.dp, if (brand) MaterialTheme.colorScheme.primary.copy(alpha = 0.35f) else YaTokens.BorderStrong, shape)
            .padding(16.dp),
        content = content,
    )
}

/** Значок у участника: «вы», «админ», «волна», «без Плюса». */
@Composable
fun Badge(text: String, tone: BadgeTone = BadgeTone.Plain) {
    val (bg, fg) = when (tone) {
        BadgeTone.Brand -> MaterialTheme.colorScheme.primary.copy(alpha = 0.18f) to MaterialTheme.colorScheme.primary
        BadgeTone.Plain -> YaTokens.Surface4 to YaTokens.TextStrong
        BadgeTone.Muted -> Color.Transparent to YaTokens.TextMuted
    }
    Text(
        text,
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(bg)
            .then(if (tone == BadgeTone.Muted) Modifier.border(1.dp, YaTokens.Surface4, RoundedCornerShape(6.dp)) else Modifier)
            .padding(horizontal = 6.dp, vertical = 2.dp),
        color = fg,
        fontSize = 11.sp,
        fontWeight = FontWeight.SemiBold,
    )
}

enum class BadgeTone { Plain, Brand, Muted }

private val AVATAR_COLORS = listOf(0xFF1BD96A, 0xFF4F9CFF, 0xFFE08325, 0xFFC084FC, 0xFFF67687, 0xFF2DD4BF, 0xFFFACC15)

/** Цвет кружка — от имени (FNV-1a, как в моде): у каждого свой и не меняется. */
fun avatarColor(name: String): Color {
    var hash = 0x811c9dc5.toInt()
    for (ch in name) hash = (hash xor ch.code) * 0x01000193
    return Color(AVATAR_COLORS[(hash.toLong() and 0xffffffffL).rem(AVATAR_COLORS.size).toInt()])
}

@Composable
fun Avatar(name: String, size: Dp = 32.dp, modifier: Modifier = Modifier) {
    Box(
        modifier.size(size).clip(CircleShape).background(avatarColor(name)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            (name.trim().firstOrNull() ?: '?').uppercase(),
            color = Color.Black,
            fontWeight = FontWeight.Bold,
            fontSize = (size.value * 0.42f).sp,
        )
    }
}

/** Обложка трека из шаблона Яндекса; пока грузится или её нет — серая плашка. */
@Composable
fun Cover(template: String?, size: Dp, modifier: Modifier = Modifier, radius: Dp = 8.dp, pixels: Int = 200) {
    val shape = RoundedCornerShape(radius)
    Box(modifier.size(size).clip(shape).background(YaTokens.Surface3)) {
        val url = coverUrl(template, pixels)
        if (url != null) {
            AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.size(size))
        }
    }
}
