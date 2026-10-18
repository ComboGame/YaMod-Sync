package ru.combogame.yamodsync.ui.player

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.palette.graphics.Palette
import coil3.imageLoader
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.allowHardware
import coil3.toBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Цвет отсвета за плеером — доминирующий цвет обложки, как в Яндекс Музыке.
 * Пока не посчитан или обложки нет — без отсвета (прозрачный).
 */
@Composable
fun rememberCoverGlow(url: String?): Color {
    val context = LocalContext.current
    var target by remember { mutableStateOf(Color.Transparent) }
    LaunchedEffect(url) {
        if (url == null) {
            target = Color.Transparent
            return@LaunchedEffect
        }
        // Для Palette нужен программный bitmap: аппаратный не читается.
        val request = ImageRequest.Builder(context).data(url).allowHardware(false).size(96).build()
        val result = context.imageLoader.execute(request) as? SuccessResult ?: return@LaunchedEffect
        val argb = withContext(Dispatchers.Default) {
            Palette.from(result.image.toBitmap()).generate().let { it.getVibrantColor(it.getDominantColor(0)) }
        }
        target = if (argb == 0) Color.Transparent else Color(argb)
    }
    val glow by animateColorAsState(target, tween(400), label = "glow")
    return glow
}
