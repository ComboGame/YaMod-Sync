package ru.combogame.yamodsync.debug

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import ru.combogame.yamodsync.core.Listener
import ru.combogame.yamodsync.core.RoomCommand
import ru.combogame.yamodsync.core.RoomSnapshot
import ru.combogame.yamodsync.core.TrackRef
import ru.combogame.yamodsync.core.WavePreset
import ru.combogame.yamodsync.ui.collection.CollectionScreen
import ru.combogame.yamodsync.ui.home.HomeScreen
import ru.combogame.yamodsync.ui.shell.AppShell
import ru.combogame.yamodsync.ui.shell.Tab
import ru.combogame.yamodsync.ui.theme.YaModSyncTheme

/** Витрина экранов на выдуманных данных: ядро и вход не нужны. */
class ShowcaseActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val screen = intent.getStringExtra("screen") ?: "home"
        setContent { YaModSyncTheme { Showcase(screen) } }
    }
}

val demoQueue = listOf(
    TrackRef("1", "10", "Альбом", "Ночной город", "Исполнитель", 214_000, "avatars.yandex.net/get-music-content/1/a.1/%%"),
    TrackRef("2", "11", "Альбом", "Утро", "Другой исполнитель", 187_000, "avatars.yandex.net/get-music-content/1/a.2/%%"),
)

val demoLikes = demoQueue + listOf("Dangerous" to "David Guetta", "Какаду" to "N1NT3ND0", "Звёзды" to "Группа", "Ветер" to "Певица")
    .mapIndexed { i, (title, artist) -> TrackRef("${i + 3}", "${i + 20}", "Альбом", title, artist, 200_000, null) }

val demoPresets = listOf(
    WavePreset("energy", "Энергичное", "Бодрые треки", listOf("mood:energetic"), color = "#f67687"),
    WavePreset("rnb", "R&B", "Ритм и блюз", listOf("genre:rnb"), color = "#4f9cff"),
    WavePreset("rock", "Рок", null, listOf("genre:rock"), color = "#2dd4bf"),
    WavePreset("calm", "Спокойное", "Для фона", listOf("mood:calm"), color = "#c084fc"),
)

val demoSnapshot = RoomSnapshot(
    connected = true,
    queue = demoQueue,
    track = demoQueue[0],
    positionMs = 71_000,
    durationMs = 214_000,
    playing = true,
    roomPlaying = true,
    station = "user:onyourwave",
    feeding = true,
    listeners = listOf(Listener(1, "Вы", you = true, admin = true), Listener(2, "Аня", feeds = true), Listener(3, "Миша", plus = false)),
    status = "connected",
    hasPlus = true,
)

@Composable
fun Showcase(screen: String) {
    var snapshot by remember {
        mutableStateOf(
            when (screen) {
                // Пресет, который ведёт другой участник: подпись «ведёт Аня» и «Вернуться к „Моей волне“».
                "home-guest" -> demoSnapshot.copy(station = """{"seeds":["genre:rnb"],"name":"R&B","by":"Аня"}""", feeding = false)
                "home-unfed" -> demoSnapshot.copy(stationUnfed = true)
                else -> demoSnapshot
            },
        )
    }
    val onCommand: (RoomCommand) -> Unit = { if (it == RoomCommand.Toggle) snapshot = snapshot.copy(roomPlaying = snapshot.roomPlaying != true) }
    val tab = when (screen.substringBefore('-')) { "collection" -> Tab.Collection; "room" -> Tab.Room; else -> Tab.Home }
    AppShell(snapshot, roomName = "дом", account = "Вы", onCommand = onCommand, onOpenPlayer = {}, onOpenSettings = {}, initialTab = tab) { t, _ ->
        when (t) {
            Tab.Home -> HomeScreen(snapshot, demoPresets, onCommand)
            Tab.Collection -> CollectionScreen(snapshot, demoLikes, onCommand)
            else -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(t.title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
            }
        }
    }
}
