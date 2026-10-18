package ru.combogame.yamodsync.ui.settings

import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.rounded.BatteryChargingFull
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Code
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import ru.combogame.yamodsync.auth.LoginState
import ru.combogame.yamodsync.settings.Accent
import ru.combogame.yamodsync.settings.AppSettings
import ru.combogame.yamodsync.settings.Quality
import ru.combogame.yamodsync.settings.Theme
import ru.combogame.yamodsync.ui.components.Avatar
import ru.combogame.yamodsync.ui.components.Badge
import ru.combogame.yamodsync.ui.components.BadgeTone
import ru.combogame.yamodsync.ui.components.YaButton
import ru.combogame.yamodsync.ui.components.YaCard
import ru.combogame.yamodsync.ui.components.YaField
import ru.combogame.yamodsync.ui.theme.YaTokens

const val REPO_URL = "https://github.com/ComboGame/YaMod-Sync"

/** Подключение сохраняется кнопкой: ник уходит в ядро перезапуском сессии, а не на каждую букву. */
data class ConnectionDraft(val relay: String, val password: String, val name: String) {
    fun differsFrom(s: AppSettings) = relay != s.relay || password != s.password || name != s.name
}

/**
 * Настройки по аватару: аккаунт, подключение, внешний вид, качество, обновления,
 * работа в фоне, о приложении. Внешний вид меняется сразу.
 */
@Composable
fun SettingsScreen(
    settings: AppSettings,
    login: LoginState,
    version: String,
    onChange: ((AppSettings) -> AppSettings) -> Unit,
    onSignOut: () -> Unit,
    onClose: () -> Unit,
    updates: @Composable ColumnScope.() -> Unit,
) {
    val context = LocalContext.current
    var relay by rememberSaveable(settings.relay) { mutableStateOf(settings.relay) }
    var password by rememberSaveable(settings.password) { mutableStateOf(settings.password) }
    var name by rememberSaveable(settings.name) { mutableStateOf(settings.name) }
    val draft = ConnectionDraft(relay.trim(), password, name.trim())

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onClose) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Назад", tint = YaTokens.TextStrong) }
            Text("Настройки", style = MaterialTheme.typography.headlineSmall, color = YaTokens.TextStrong)
        }
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Section("Аккаунт") {
                val signedIn = login as? LoginState.SignedIn
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Avatar(signedIn?.name?.ifBlank { null } ?: "Я", size = 44.dp)
                    Column(Modifier.weight(1f)) {
                        Text(signedIn?.name?.ifBlank { null } ?: "Аккаунт Яндекса", style = MaterialTheme.typography.titleMedium, color = YaTokens.TextStrong)
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 2.dp)) {
                            when (signedIn?.plus) {
                                true -> Badge("Плюс", BadgeTone.Brand)
                                false -> Badge("без Плюса", BadgeTone.Muted)
                                null -> Unit
                            }
                            if (signedIn?.offline == true) Badge("нет связи", BadgeTone.Muted)
                        }
                    }
                }
                YaButton("Выйти из аккаунта", onSignOut, Modifier.fillMaxWidth().padding(top = 12.dp), danger = true, icon = Icons.AutoMirrored.Rounded.Logout)
            }

            Section("Подключение к комнате") {
                YaField("Адрес сервера", relay, { relay = it }, placeholder = "ws://203.0.113.10:8787", keyboard = KeyboardType.Uri)
                YaField("Пароль сервера", password, { password = it }, secret = true, modifier = Modifier.padding(top = 10.dp))
                YaField("Ваш ник", name, { name = it }, placeholder = "Пусто — имя аккаунта", modifier = Modifier.padding(top = 10.dp))
                if (draft.differsFrom(settings)) {
                    YaButton(
                        "Сохранить",
                        { onChange { it.copy(relay = draft.relay, password = draft.password, name = draft.name) } },
                        Modifier.fillMaxWidth().padding(top = 12.dp),
                        icon = Icons.Rounded.Check,
                    )
                }
                Toggle(
                    "Входить при запуске",
                    if (settings.room.isNotBlank()) "Сразу в комнату «${settings.room}»" else "В последнюю комнату, когда она будет",
                    settings.autoJoin,
                ) { on -> onChange { it.copy(autoJoin = on) } }
            }

            Section("Внешний вид") {
                Text("Фон", style = MaterialTheme.typography.labelLarge, color = YaTokens.Text)
                Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Theme.entries.forEach { theme ->
                        Choice(
                            if (theme == Theme.Oled) "Чёрный" else "Графит",
                            selected = settings.theme == theme,
                            swatch = Color(theme.background),
                            modifier = Modifier.weight(1f),
                        ) { onChange { it.copy(theme = theme) } }
                    }
                }
                Text("Акцент", style = MaterialTheme.typography.labelLarge, color = YaTokens.Text, modifier = Modifier.padding(top = 14.dp))
                Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Accent.entries.forEach { accent ->
                        val selected = settings.accent == accent
                        Box(
                            Modifier
                                .size(40.dp)
                                .clip(CircleShape)
                                .background(Color(accent.color))
                                .border(if (selected) 3.dp else 0.dp, YaTokens.TextStrong, CircleShape)
                                .clickable { onChange { it.copy(accent = accent) } },
                            contentAlignment = Alignment.Center,
                        ) {
                            if (selected) Icon(Icons.Rounded.Check, contentDescription = accent.title, tint = Color.Black, modifier = Modifier.size(20.dp))
                        }
                    }
                }
            }

            Section("Качество звука") {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Quality.entries.forEach { q ->
                        Choice(
                            q.title,
                            selected = settings.quality == q,
                            hint = if (q == Quality.High) "Лучший mp3, что отдаёт Яндекс" else "Меньше трафика в мобильной сети",
                            modifier = Modifier.fillMaxWidth(),
                        ) { onChange { it.copy(quality = q) } }
                    }
                }
            }

            Section("Обновления", content = updates)

            Section("Работа в фоне") {
                Text(
                    "Чтобы музыка не обрывалась с выключенным экраном, разрешите приложению работать без ограничений. На vivo: «Батарея» → «Фоновое энергопотребление» → «Разрешить», и в «Автозапуске» — включить.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = YaTokens.Text,
                )
                YaButton(
                    "Открыть настройки приложения",
                    {
                        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, "package:${context.packageName}".toUri())
                        runCatching { context.startActivity(intent) }
                    },
                    Modifier.fillMaxWidth().padding(top = 12.dp),
                    primary = false,
                    icon = Icons.Rounded.BatteryChargingFull,
                )
            }

            Section("О приложении") {
                Text("Яндекс Музыка Sync $version", style = MaterialTheme.typography.titleSmall, color = YaTokens.TextStrong)
                Text(
                    "Совместное прослушивание: каждый слушает со своего аккаунта с Плюсом. Не открывает платное и не скачивает треки.",
                    style = MaterialTheme.typography.bodySmall,
                    color = YaTokens.TextMuted,
                    modifier = Modifier.padding(top = 4.dp),
                )
                YaButton(
                    "Исходный код на GitHub",
                    { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, REPO_URL.toUri())) } },
                    Modifier.fillMaxWidth().padding(top = 12.dp),
                    primary = false,
                    icon = Icons.Rounded.Code,
                )
            }
        }
    }
}

@Composable
private fun Section(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.titleSmall, color = YaTokens.TextMuted, modifier = Modifier.padding(start = 4.dp, top = 6.dp))
        YaCard(Modifier.fillMaxWidth(), content = content)
    }
}

@Composable
private fun Toggle(title: String, hint: String, on: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(top = 14.dp).clickable { onChange(!on) }, verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, color = YaTokens.TextStrong)
            Text(hint, style = MaterialTheme.typography.bodySmall, color = YaTokens.TextMuted)
        }
        Switch(
            checked = on,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = Color.Black,
                checkedTrackColor = MaterialTheme.colorScheme.primary,
                uncheckedThumbColor = YaTokens.TextMuted,
                uncheckedTrackColor = YaTokens.Surface3,
                uncheckedBorderColor = YaTokens.Surface4,
            ),
        )
    }
}

@Composable
private fun Choice(title: String, selected: Boolean, modifier: Modifier, swatch: Color? = null, hint: String? = null, onClick: () -> Unit) {
    val shape = RoundedCornerShape(YaTokens.RadiusButton)
    val accent = MaterialTheme.colorScheme.primary
    Row(
        modifier
            .clip(shape)
            .background(if (selected) accent.copy(alpha = 0.1f) else YaTokens.Surface2)
            .border(if (selected) 2.dp else 1.dp, if (selected) accent else YaTokens.Surface4, shape)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        swatch?.let { Box(Modifier.size(22.dp).clip(RoundedCornerShape(6.dp)).background(it).border(1.dp, YaTokens.Surface4, RoundedCornerShape(6.dp))) }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.labelLarge, color = if (selected) accent else YaTokens.TextStrong)
            hint?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = YaTokens.TextMuted) }
        }
    }
}
