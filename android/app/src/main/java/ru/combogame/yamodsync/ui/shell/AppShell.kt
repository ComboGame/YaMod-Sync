package ru.combogame.yamodsync.ui.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.GraphicEq
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import ru.combogame.yamodsync.core.RoomCommand
import ru.combogame.yamodsync.core.RoomSnapshot
import ru.combogame.yamodsync.ui.theme.YaTokens

enum class Tab(val title: String, val icon: ImageVector) {
    Home("Главная", Icons.Rounded.GraphicEq),
    Collection("Коллекция", Icons.Rounded.Favorite),
    Room("Комната", Icons.Rounded.Groups),
}

/**
 * Каркас как у Яндекс Музыки: вкладки снизу, мини-плеер над ними, профиль и
 * настройки — по аватару справа сверху. Своё — OLED-стиль и вкладка «Комната».
 */
@Composable
fun AppShell(
    snapshot: RoomSnapshot?,
    roomName: String?,
    account: String,
    onCommand: (RoomCommand) -> Unit,
    onOpenPlayer: () -> Unit,
    onOpenSettings: () -> Unit,
    initialTab: Tab = Tab.Home,
    tabContent: @Composable (Tab, (Tab) -> Unit) -> Unit,
) {
    var tab by rememberSaveable { mutableStateOf(initialTab) }

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        TopBar(
            title = tab.title,
            account = account,
            pill = if (tab == Tab.Home) ({ RoomPill(snapshot, roomName) { tab = Tab.Room } }) else null,
            onAvatar = onOpenSettings,
        )
        Box(Modifier.weight(1f).fillMaxWidth()) { tabContent(tab) { tab = it } }
        MiniPlayer(snapshot, onCommand, onOpenPlayer)
        HorizontalDivider(thickness = 1.dp, color = YaTokens.Border)
        Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(top = 6.dp, bottom = 8.dp)) {
            Tab.entries.forEach { entry ->
                val selected = entry == tab
                Column(
                    Modifier.weight(1f).clickable { tab = entry }.padding(vertical = 2.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Icon(entry.icon, contentDescription = null, tint = if (selected) MaterialTheme.colorScheme.primary else YaTokens.TextMuted, modifier = Modifier.size(24.dp))
                    Text(entry.title, style = MaterialTheme.typography.labelSmall, color = if (selected) MaterialTheme.colorScheme.primary else YaTokens.TextMuted)
                }
            }
        }
    }
}
