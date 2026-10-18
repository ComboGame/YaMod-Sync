package ru.combogame.yamodsync.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import ru.combogame.yamodsync.ui.theme.YaTokens

/** Поле ввода в стиле Modrinth: тёмная поверхность, рамка, акцент при фокусе. */
@Composable
fun YaField(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    hint: String? = null,
    secret: Boolean = false,
    keyboard: KeyboardType = KeyboardType.Text,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = YaTokens.TextStrong)
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            singleLine = true,
            placeholder = placeholder?.let { { Text(it, color = YaTokens.TextMuted) } },
            visualTransformation = if (secret) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = if (secret) KeyboardType.Password else keyboard, autoCorrectEnabled = false),
            shape = RoundedCornerShape(YaTokens.RadiusButton),
            colors = OutlinedTextFieldDefaults.colors(
                focusedContainerColor = YaTokens.Surface2,
                unfocusedContainerColor = YaTokens.Surface2,
                focusedBorderColor = MaterialTheme.colorScheme.primary,
                unfocusedBorderColor = YaTokens.Surface4,
                focusedTextColor = YaTokens.TextStrong,
                unfocusedTextColor = YaTokens.TextStrong,
                cursorColor = MaterialTheme.colorScheme.primary,
            ),
            modifier = Modifier.fillMaxWidth(),
        )
        hint?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = YaTokens.TextMuted) }
    }
}

/** Кнопка: основная — акцентом, вторичная — поверхностью с рамкой. */
@Composable
fun YaButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    primary: Boolean = true,
    enabled: Boolean = true,
    icon: ImageVector? = null,
    danger: Boolean = false,
) {
    val shape = RoundedCornerShape(YaTokens.RadiusButton)
    val fg = when {
        danger -> YaTokens.Danger
        primary -> Color.Black
        else -> YaTokens.TextStrong
    }
    Row(
        modifier
            .alpha(if (enabled) 1f else 0.45f)
            .clip(shape)
            .background(if (primary && !danger) MaterialTheme.colorScheme.primary else YaTokens.Surface3)
            .then(if (primary && !danger) Modifier else Modifier.border(1.dp, YaTokens.Surface4, shape))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 11.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        icon?.let { Icon(it, contentDescription = null, tint = fg, modifier = Modifier.size(18.dp)) }
        Text(text, style = MaterialTheme.typography.labelLarge, color = fg)
    }
}
