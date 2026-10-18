package ru.combogame.yamodsync.ui.player

import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.QueueMusic
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.Lyrics
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Repeat
import androidx.compose.material.icons.rounded.RepeatOne
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material.icons.rounded.Shuffle
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.SkipPrevious
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import kotlinx.coroutines.delay
import ru.combogame.yamodsync.core.Lyrics
import ru.combogame.yamodsync.core.RoomCommand
import ru.combogame.yamodsync.core.RoomSnapshot
import ru.combogame.yamodsync.core.WavePreset
import ru.combogame.yamodsync.playback.coverUrl
import ru.combogame.yamodsync.playback.dislikeCommands
import ru.combogame.yamodsync.playback.likeCommands
import ru.combogame.yamodsync.ui.components.Cover
import ru.combogame.yamodsync.ui.home.guestText
import ru.combogame.yamodsync.ui.home.waveOwner
import ru.combogame.yamodsync.ui.home.waveRefusal
import ru.combogame.yamodsync.ui.theme.YaTokens

private enum class Sheet { Lyrics, Presets, Queue, More }

/** Следующий режим повтора по кругу, как кнопка в Яндекс Музыке: выкл → всё → один. */
fun nextRepeat(mode: String): String = when (mode) {
    "off" -> "all"
    "all" -> "one"
    else -> "off"
}

/**
 * Полный плеер — раскладка с макета `player.html`: сверху свернуть / откуда играет /
 * поделиться, обложка, название и сердечко, перемотка, ряд из пяти кнопок, синхрон,
 * внизу четыре значка без подписей.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FullPlayer(
    snapshot: RoomSnapshot?,
    roomName: String?,
    liked: Set<String>,
    presets: List<WavePreset>?,
    onCommand: (RoomCommand) -> Unit,
    loadLyrics: suspend (String) -> Lyrics?,
    onClose: () -> Unit,
) {
    val context = LocalContext.current
    val s = snapshot ?: RoomSnapshot()
    val track = s.track
    val accent = MaterialTheme.colorScheme.primary
    val glow = rememberCoverGlow(coverUrl(track?.coverUri, 200))
    var sheet by remember { mutableStateOf<Sheet?>(null) }

    // Ядро присылает позицию 4 раза в секунду; между снапшотами она досчитывается здесь.
    var seen by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(s.positionMs, s.track?.trackId, s.roomPlaying) { seen = System.currentTimeMillis() }
    val playing = s.roomPlaying == true && !s.waiting
    val duration = s.durationMs.takeIf { it > 0 } ?: track?.durationMs ?: 0
    fun livePosition(): Long {
        val ahead = if (playing) System.currentTimeMillis() - seen else 0
        return (s.positionMs + ahead).coerceIn(0, duration.coerceAtLeast(0))
    }
    var position by remember { mutableLongStateOf(s.positionMs) }
    LaunchedEffect(s, playing) {
        while (true) {
            position = livePosition()
            delay(200)
        }
    }
    var dragging by remember { mutableStateOf<Float?>(null) }

    fun toast(text: String) = Toast.makeText(context, text, Toast.LENGTH_LONG).show()
    fun open(url: String) = runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri())) }

    Box(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .background(Brush.verticalGradient(0f to glow.copy(alpha = 0.45f * glow.alpha), 0.75f to Color.Transparent)),
    ) {
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(horizontal = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onClose) {
                    Icon(Icons.Rounded.KeyboardArrowDown, contentDescription = "Свернуть", tint = YaTokens.TextStrong, modifier = Modifier.size(30.dp))
                }
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Сейчас играет", style = MaterialTheme.typography.labelSmall, color = YaTokens.TextMuted)
                    Text(sourceLabel(s, roomName, liked), style = MaterialTheme.typography.labelLarge, color = YaTokens.TextStrong, maxLines = 1, textAlign = TextAlign.Center)
                }
                IconButton(onClick = {
                    val t = track ?: return@IconButton
                    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, shareUrl(t))
                    context.startActivity(Intent.createChooser(send, "Поделиться треком"))
                }, enabled = track != null) {
                    Icon(Icons.Rounded.Share, contentDescription = "Поделиться", tint = YaTokens.TextStrong)
                }
            }

            Spacer(Modifier.weight(0.6f))
            Box(Modifier.fillMaxWidth().aspectRatio(1f).shadow(24.dp, RoundedCornerShape(YaTokens.RadiusCard), ambientColor = glow, spotColor = glow)) {
                Cover(track?.coverUri, size = null, radius = YaTokens.RadiusCard, pixels = 800)
            }
            Spacer(Modifier.weight(0.5f))

            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        track?.title ?: "Ничего не играет",
                        style = MaterialTheme.typography.titleLarge,
                        color = YaTokens.TextStrong,
                        maxLines = 1,
                        modifier = Modifier.basicMarquee(),
                    )
                    Text(
                        track?.artist ?: "Включите волну или «Мне нравится»",
                        style = MaterialTheme.typography.bodyLarge,
                        color = YaTokens.Text,
                        maxLines = 1,
                        modifier = Modifier.basicMarquee(),
                    )
                }
                IconButton(onClick = { likeCommands(s).forEach(onCommand) }, enabled = track != null) {
                    Icon(
                        if (s.trackLiked) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                        contentDescription = if (s.trackLiked) "Убрать из «Мне нравится»" else "Мне нравится",
                        tint = if (s.trackLiked) accent else YaTokens.TextStrong,
                        modifier = Modifier.size(28.dp),
                    )
                }
            }

            val shown = dragging ?: if (duration > 0) position.toFloat() / duration else 0f
            Slider(
                value = shown.coerceIn(0f, 1f),
                onValueChange = { dragging = it },
                onValueChangeFinished = {
                    dragging?.let { onCommand(RoomCommand.Seek((it * duration).toLong())) }
                    dragging = null
                },
                enabled = track != null && duration > 0,
                modifier = Modifier.padding(top = 8.dp).height(28.dp),
                // Тонкая полоса и маленький кружок, как в Яндекс Музыке, — не толстый ползунок Material 3.
                thumb = { Box(Modifier.size(if (dragging != null) 16.dp else 12.dp).clip(CircleShape).background(YaTokens.TextStrong)) },
                track = { state ->
                    val fraction = ((state.value - state.valueRange.start) / (state.valueRange.endInclusive - state.valueRange.start)).coerceIn(0f, 1f)
                    Box(Modifier.fillMaxWidth().height(4.dp).clip(CircleShape).background(YaTokens.Surface4)) {
                        Box(Modifier.fillMaxWidth(fraction).fillMaxHeight().background(YaTokens.TextStrong))
                    }
                },
            )
            Row(Modifier.fillMaxWidth()) {
                Text(formatTime(dragging?.let { (it * duration).toLong() } ?: position), style = MaterialTheme.typography.labelMedium, color = YaTokens.TextMuted)
                Spacer(Modifier.weight(1f))
                Text(formatTime(duration), style = MaterialTheme.typography.labelMedium, color = YaTokens.TextMuted)
            }

            Row(
                Modifier.fillMaxWidth().padding(top = 10.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Toggle(
                    if (s.repeat == "one") Icons.Rounded.RepeatOne else Icons.Rounded.Repeat,
                    on = s.repeat != "off",
                    description = "Повтор",
                ) { onCommand(RoomCommand.Repeat(nextRepeat(s.repeat))) }
                IconButton(onClick = { onCommand(RoomCommand.Prev) }, modifier = Modifier.size(56.dp)) {
                    Icon(Icons.Rounded.SkipPrevious, contentDescription = "Назад", tint = YaTokens.TextStrong, modifier = Modifier.size(40.dp))
                }
                Box(
                    Modifier.size(76.dp).clip(CircleShape).background(YaTokens.TextStrong).clickable { onCommand(RoomCommand.Toggle) },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        if (playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                        contentDescription = if (playing) "Пауза" else "Играть",
                        tint = Color.Black,
                        modifier = Modifier.size(44.dp),
                    )
                }
                IconButton(onClick = { onCommand(RoomCommand.Next) }, modifier = Modifier.size(56.dp)) {
                    Icon(Icons.Rounded.SkipNext, contentDescription = "Вперёд", tint = YaTokens.TextStrong, modifier = Modifier.size(40.dp))
                }
                Toggle(Icons.Rounded.Shuffle, on = s.shuffle, description = "Перемешать") {
                    val owner = waveOwner(s)
                    if (owner != null) toast(guestText(owner)) else onCommand(RoomCommand.Shuffle(!s.shuffle))
                }
            }

            val sync = syncLine(s, inRoom = roomName != null)
            Row(Modifier.fillMaxWidth().padding(top = 14.dp).height(20.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                if (sync != null) {
                    Box(
                        Modifier.size(8.dp).clip(CircleShape).background(
                            when (sync.tone) {
                                SyncTone.Together -> accent
                                SyncTone.Catching -> YaTokens.Warning
                                SyncTone.Idle -> YaTokens.Surface4
                            },
                        ),
                    )
                    Text(
                        sync.text,
                        style = MaterialTheme.typography.labelMedium,
                        color = if (sync.tone == SyncTone.Together) accent else YaTokens.TextMuted,
                        modifier = Modifier.padding(start = 8.dp),
                    )
                }
            }

            Spacer(Modifier.weight(0.5f))
            Row(Modifier.fillMaxWidth().padding(bottom = 12.dp), horizontalArrangement = Arrangement.SpaceAround) {
                Tool(Icons.Rounded.Lyrics, "Текст песни", enabled = track != null) { sheet = Sheet.Lyrics }
                Tool(Icons.Rounded.Tune, "Режим волны") { sheet = Sheet.Presets }
                Tool(Icons.AutoMirrored.Rounded.QueueMusic, "Очередь") { sheet = Sheet.Queue }
                Tool(Icons.Rounded.MoreVert, "Ещё", enabled = track != null) { sheet = Sheet.More }
            }
        }
    }

    val close = { sheet = null }
    fun wave(command: RoomCommand) {
        val refusal = waveRefusal(s)
        if (refusal != null) toast(refusal) else {
            onCommand(command)
            sheet = null
        }
    }
    when (sheet) {
        Sheet.Lyrics -> track?.let { LyricsSheet(it.trackId, positionMs = { position }, load = loadLyrics, onDismiss = close) }
        Sheet.Presets -> PresetsSheet(s, presets, onWave = ::wave, onDismiss = close)
        Sheet.Queue -> QueueSheet(s, onPick = { index ->
            val owner = waveOwner(s)
            if (owner != null) toast(guestText(owner)) else {
                onCommand(RoomCommand.Index(index))
                sheet = null
            }
        }, onDismiss = close)
        Sheet.More -> track?.let {
            MoreSheet(it, onDislike = {
                dislikeCommands(s).forEach(onCommand)
                sheet = null
            }, onOpen = { url -> open(url) }, onDismiss = close)
        }
        null -> Unit
    }
}

@Composable
private fun Toggle(icon: ImageVector, on: Boolean, description: String, onClick: () -> Unit) {
    IconButton(onClick = onClick) {
        Icon(icon, contentDescription = description, tint = if (on) MaterialTheme.colorScheme.primary else YaTokens.TextMuted, modifier = Modifier.size(26.dp))
    }
}

/** Значок нижнего ряда — без подписи, как просили; подпись есть только для TalkBack. */
@Composable
private fun Tool(icon: ImageVector, description: String, enabled: Boolean = true, onClick: () -> Unit) {
    IconButton(onClick = onClick, enabled = enabled) {
        Icon(icon, contentDescription = description, tint = if (enabled) YaTokens.Text else YaTokens.Surface4, modifier = Modifier.size(26.dp))
    }
}
