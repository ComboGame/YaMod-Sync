package ru.combogame.yamodsync.update

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.SystemUpdate
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import ru.combogame.yamodsync.ui.components.YaButton
import ru.combogame.yamodsync.ui.theme.YaTokens

private fun megabytes(bytes: Long) = "%.1f МБ".format(bytes / 1_048_576.0)

/** Содержимое раздела «Обновления» в настройках: статус, «Что нового», кнопка. */
@Composable
fun ColumnScope.UpdateSection(state: UpdateState, current: String, onCheck: () -> Unit, onInstall: () -> Unit) {
    val release = when (state) {
        is UpdateState.Available -> state.release
        is UpdateState.Downloading -> state.release
        is UpdateState.Ready -> state.release
        is UpdateState.Failed -> state.release
        else -> null
    }
    Text(
        when (state) {
            UpdateState.Idle -> "Установлена версия $current"
            UpdateState.Checking -> "Проверяю…"
            UpdateState.UpToDate -> "Установлена последняя версия, $current"
            is UpdateState.Available -> "Есть версия ${state.release.version} · ${megabytes(state.release.size)}"
            is UpdateState.Downloading -> "Скачиваю ${state.release.version}… ${(state.progress * 100).toInt()}%"
            is UpdateState.Ready -> "Версия ${state.release.version} скачана и проверена"
            is UpdateState.Failed -> state.message
        },
        style = MaterialTheme.typography.bodyLarge,
        color = if (state is UpdateState.Failed) YaTokens.Danger else YaTokens.TextStrong,
    )
    (state as? UpdateState.Ready)?.note?.let {
        Text(it, style = MaterialTheme.typography.bodyMedium, color = YaTokens.Warning, modifier = Modifier.padding(top = 4.dp))
    }
    if (state is UpdateState.Downloading) {
        LinearProgressIndicator(
            progress = { state.progress },
            color = MaterialTheme.colorScheme.primary,
            trackColor = YaTokens.Surface4,
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
        )
    }
    release?.notes?.takeIf { it.isNotBlank() }?.let { notes ->
        Text("Что нового", style = MaterialTheme.typography.labelLarge, color = YaTokens.Text, modifier = Modifier.padding(top = 12.dp))
        Text(notes, style = MaterialTheme.typography.bodyMedium, color = YaTokens.Text, modifier = Modifier.padding(top = 4.dp))
    }
    when {
        release != null && state !is UpdateState.Downloading -> YaButton(
            if (state is UpdateState.Ready) "Установить" else "Скачать и установить",
            onInstall,
            Modifier.fillMaxWidth().padding(top = 12.dp),
            icon = Icons.Rounded.Download,
        )
        state !is UpdateState.Checking && state !is UpdateState.Downloading -> YaButton(
            "Проверить обновления",
            onCheck,
            Modifier.fillMaxWidth().padding(top = 12.dp),
            primary = false,
            icon = Icons.Rounded.Refresh,
        )
    }
}

/** Плашка на Главной, пока есть что поставить. */
@Composable
fun UpdateBanner(state: UpdateState, onOpen: () -> Unit) {
    val version = when (state) {
        is UpdateState.Available -> state.release.version
        is UpdateState.Ready -> state.release.version
        else -> return
    }
    val shape = RoundedCornerShape(YaTokens.RadiusButton)
    val accent = MaterialTheme.colorScheme.primary
    Row(
        Modifier
            .padding(horizontal = 16.dp, vertical = 4.dp)
            .fillMaxWidth()
            .clip(shape)
            .background(accent.copy(alpha = 0.1f))
            .border(1.dp, accent.copy(alpha = 0.4f), shape)
            .clickable(onClick = onOpen)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(Icons.Rounded.SystemUpdate, contentDescription = null, tint = accent, modifier = Modifier.size(20.dp))
        Column(Modifier.weight(1f)) {
            Text("Вышла версия $version", style = MaterialTheme.typography.labelLarge, color = YaTokens.TextStrong)
            Text("Открыть в настройках", style = MaterialTheme.typography.bodySmall, color = YaTokens.Text)
        }
    }
}
