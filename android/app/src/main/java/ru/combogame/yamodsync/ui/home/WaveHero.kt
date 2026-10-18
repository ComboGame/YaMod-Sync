package ru.combogame.yamodsync.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Undo
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ru.combogame.yamodsync.core.StationInfo
import ru.combogame.yamodsync.ui.theme.YaTokens

/** Что показывает крупный блок волны: подпись сверху, название, играет ли. */
data class WaveHeroView(
    val caption: String,
    val title: String,
    val playing: Boolean,
    /** Пресет, а не обычная «Моя волна»: тогда есть «Вернуться к „Моей волне“». */
    val preset: Boolean,
    /** Включивший ушёл — волну можно продолжить со своего аккаунта. */
    val unfed: Boolean,
)

fun waveHeroView(station: StationInfo?, owner: String?, playing: Boolean, unfed: Boolean, plain: Boolean, inRoom: Boolean): WaveHeroView {
    val title = station?.name?.takeUnless { plain } ?: "Моя волна"
    val caption = when {
        // Без комнаты телефон слушает один: «волна комнаты» здесь ни о чём.
        station == null || !inRoom -> "Подбирается для вас"
        unfed -> "Волна комнаты · включивший ушёл"
        owner != null -> "Волна комнаты · ведёт $owner"
        else -> "Волна комнаты · подбирается для вас"
    }
    return WaveHeroView(caption, title, playing = station != null && playing, preset = station != null && !plain, unfed = unfed)
}

@Composable
fun WaveHero(
    view: WaveHeroView,
    onPlay: () -> Unit,
    onShake: () -> Unit,
    onBackToMyWave: () -> Unit,
    onContinue: () -> Unit,
) {
    val accent = MaterialTheme.colorScheme.primary
    val shape = RoundedCornerShape(YaTokens.RadiusCard)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(Brush.verticalGradient(listOf(accent.copy(alpha = 0.22f), YaTokens.Surface1)))
            .border(1.dp, accent.copy(alpha = 0.3f), shape)
            .padding(vertical = 28.dp, horizontal = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(view.caption, style = MaterialTheme.typography.labelMedium, color = YaTokens.Text, textAlign = TextAlign.Center)
        Text(view.title, style = MaterialTheme.typography.headlineMedium, color = YaTokens.TextStrong, textAlign = TextAlign.Center)
        Box(
            Modifier.padding(top = 6.dp).size(64.dp).clip(CircleShape).background(accent).clickable(onClick = onPlay),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                if (view.playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                contentDescription = if (view.playing) "Пауза" else "Слушать",
                tint = Color.Black,
                modifier = Modifier.size(34.dp),
            )
        }
        FlowRow(
            Modifier.padding(top = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (view.unfed) {
                HeroChip("Продолжить со своего аккаунта", Icons.Rounded.PlayArrow, onContinue)
            } else {
                HeroChip("Встряхнуть", Icons.Rounded.Refresh, onShake)
                if (view.preset) HeroChip("Вернуться к «Моей волне»", Icons.AutoMirrored.Rounded.Undo, onBackToMyWave)
            }
        }
    }
}

@Composable
private fun HeroChip(text: String, icon: ImageVector, onClick: () -> Unit) {
    val shape = RoundedCornerShape(YaTokens.RadiusButton)
    Row(
        Modifier.clip(shape).background(YaTokens.Surface3).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(icon, contentDescription = null, tint = YaTokens.TextStrong, modifier = Modifier.size(16.dp))
        Text(text, style = MaterialTheme.typography.labelLarge, color = YaTokens.TextStrong)
    }
}
