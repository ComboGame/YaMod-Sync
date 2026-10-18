package ru.combogame.yamodsync.ui.shell

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ru.combogame.yamodsync.ui.components.Avatar
import ru.combogame.yamodsync.ui.theme.YaTokens

/** Шапка вкладки: заголовок, значок комнаты (на Главной) и аватар — вход в настройки. */
@Composable
fun TopBar(title: String, account: String, pill: (@Composable () -> Unit)?, onAvatar: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(title, style = MaterialTheme.typography.headlineSmall, color = YaTokens.TextStrong, modifier = Modifier.weight(1f))
        pill?.invoke()
        Avatar(account, size = 32.dp, modifier = Modifier.clickable(onClick = onAvatar))
    }
}
