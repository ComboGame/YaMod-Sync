package ru.combogame.yamodsync.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * Тема приложения: всегда тёмная. `background` и `accent` настраиваются
 * (настройки → «Внешний вид»), остальное — токены Modrinth.
 */
@Composable
fun YaModSyncTheme(
    background: Color = YaTokens.Background,
    accent: Color = YaTokens.Brand,
    content: @Composable () -> Unit,
) {
    val colors = darkColorScheme(
        primary = accent,
        onPrimary = Color.Black,
        primaryContainer = accent.copy(alpha = 0.2f),
        onPrimaryContainer = accent,
        secondary = YaTokens.Surface3,
        onSecondary = YaTokens.TextStrong,
        background = background,
        onBackground = YaTokens.Text,
        surface = background,
        onSurface = YaTokens.TextStrong,
        surfaceVariant = YaTokens.Surface1,
        onSurfaceVariant = YaTokens.Text,
        surfaceContainer = YaTokens.Surface1,
        surfaceContainerHigh = YaTokens.Surface2,
        surfaceContainerHighest = YaTokens.Surface3,
        outline = YaTokens.BorderStrong,
        outlineVariant = YaTokens.Border,
        error = YaTokens.Danger,
    )
    MaterialTheme(
        colorScheme = colors,
        typography = YaTypography,
        shapes = Shapes(
            small = RoundedCornerShape(YaTokens.RadiusButton),
            medium = RoundedCornerShape(YaTokens.RadiusButton),
            large = RoundedCornerShape(YaTokens.RadiusCard),
        ),
        content = content,
    )
}
