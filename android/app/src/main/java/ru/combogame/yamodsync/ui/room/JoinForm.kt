package ru.combogame.yamodsync.ui.room

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ru.combogame.yamodsync.core.CoreError
import ru.combogame.yamodsync.core.RoomConfig
import ru.combogame.yamodsync.core.RoomListing
import ru.combogame.yamodsync.ui.components.YaButton
import ru.combogame.yamodsync.ui.components.YaCard
import ru.combogame.yamodsync.ui.components.YaField
import ru.combogame.yamodsync.ui.theme.YaTokens

/** Список комнат спрашивается через столько после последней правки адреса или пароля — как в моде. */
private const val LOOKUP_DELAY_MS = 600L

private sealed interface Rooms {
    data object Idle : Rooms
    data object Loading : Rooms
    data class Ok(val rooms: List<RoomListing>) : Rooms
    data class Failed(val code: String, val text: String) : Rooms
}

private fun looksLikeRelay(address: String) = address.trim().let { it.startsWith("ws://") || it.startsWith("wss://") } && address.trim().length > 6

/**
 * Вход в комнату: адрес сервера, пароль, ник, затем комнаты сервера или новая.
 * Со старым релеем список не придёт — тогда название вводится само.
 */
@Composable
fun JoinForm(
    relay: String,
    password: String,
    name: String,
    lastRoom: String,
    loadRooms: suspend (String, String) -> Result<List<RoomListing>>,
    onJoin: (RoomConfig, String) -> Unit,
) {
    var relayText by rememberSaveable { mutableStateOf(relay) }
    var passwordText by rememberSaveable { mutableStateOf(password) }
    var nameText by rememberSaveable { mutableStateOf(name) }
    var newRoom by rememberSaveable { mutableStateOf("") }
    var rooms by remember { mutableStateOf<Rooms>(Rooms.Idle) }
    val scope = rememberCoroutineScope()

    suspend fun lookup() {
        rooms = Rooms.Loading
        rooms = loadRooms(relayText.trim(), passwordText).fold(
            onSuccess = { Rooms.Ok(it) },
            onFailure = {
                val code = (it as? CoreError)?.code ?: "unreachable"
                Rooms.Failed(code, roomsErrorText(code, it.message ?: "Не удалось спросить сервер"))
            },
        )
    }

    // Правка адреса или пароля — запрос через паузу, «Обновить» — сразу.
    LaunchedEffect(relayText, passwordText) {
        if (!looksLikeRelay(relayText)) {
            rooms = Rooms.Idle
            return@LaunchedEffect
        }
        delay(LOOKUP_DELAY_MS)
        lookup()
    }

    fun join(room: String) {
        if (room.isBlank() || !looksLikeRelay(relayText)) return
        onJoin(RoomConfig(relayText.trim(), room.trim(), passwordText), nameText)
    }

    val listed = (rooms as? Rooms.Ok)?.rooms.orEmpty()
    val oldRelay = (rooms as? Rooms.Failed)?.code == "old_relay"

    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        YaCard {
            Text("Слушать вместе", style = MaterialTheme.typography.titleMedium, color = YaTokens.TextStrong)
            Text(
                "Зайдите в комнату на сервере — у всех заиграет одно и то же с одной позиции, каждый со своего аккаунта.",
                style = MaterialTheme.typography.bodyMedium,
                color = YaTokens.Text,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
        YaField("Адрес сервера", relayText, { relayText = it }, placeholder = "ws://203.0.113.10:8787", hint = "Тот, что дал владелец сервера: ws://IP:8787 или wss://домен", keyboard = KeyboardType.Uri)
        YaField("Пароль сервера", passwordText, { passwordText = it }, secret = true)
        YaField("Ваш ник", nameText, { nameText = it }, placeholder = "Как вас видят в комнате", hint = "Пусто — имя аккаунта Яндекса")

        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Комнаты на сервере", style = MaterialTheme.typography.titleSmall, color = YaTokens.TextStrong, modifier = Modifier.weight(1f))
                if (rooms !is Rooms.Idle) {
                    IconButton(onClick = { scope.launch { lookup() } }, enabled = rooms !is Rooms.Loading) {
                        Icon(Icons.Rounded.Refresh, contentDescription = "Обновить список комнат", tint = YaTokens.Text)
                    }
                }
            }
            when (val r = rooms) {
                Rooms.Idle -> Hint("Введите адрес сервера — здесь появятся его комнаты")
                Rooms.Loading -> Hint("Спрашиваю сервер…")
                is Rooms.Failed -> Text(r.text, style = MaterialTheme.typography.bodyMedium, color = if (oldRelay) YaTokens.Text else YaTokens.Danger)
                is Rooms.Ok -> if (r.rooms.isEmpty()) Hint("Комнат пока нет — создайте свою") else RoomList(r.rooms) { join(it.name) }
            }
        }

        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            YaField(
                if (oldRelay) "Название комнаты" else "Или новая комната",
                newRoom,
                { newRoom = it },
                placeholder = if (oldRelay && lastRoom.isNotBlank()) lastRoom else "например, дом",
            )
            YaButton(
                joinButtonText(newRoom, listed),
                onClick = { join(newRoom.ifBlank { if (oldRelay) lastRoom else "" }) },
                enabled = looksLikeRelay(relayText) && (newRoom.isNotBlank() || (oldRelay && lastRoom.isNotBlank())),
                icon = Icons.Rounded.Add,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun Hint(text: String) = Text(text, style = MaterialTheme.typography.bodyMedium, color = YaTokens.TextMuted)
