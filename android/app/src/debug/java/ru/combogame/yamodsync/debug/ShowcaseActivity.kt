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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import kotlinx.coroutines.launch
import ru.combogame.yamodsync.core.Listener
import ru.combogame.yamodsync.core.RoomConfig
import ru.combogame.yamodsync.core.RoomListing
import ru.combogame.yamodsync.settings.AppSettings
import ru.combogame.yamodsync.ui.room.RoomScreen
import ru.combogame.yamodsync.update.UpdateSection
import ru.combogame.yamodsync.core.LyricLine
import ru.combogame.yamodsync.core.Lyrics
import ru.combogame.yamodsync.core.RoomCommand
import ru.combogame.yamodsync.core.RoomSnapshot
import ru.combogame.yamodsync.core.TrackRef
import ru.combogame.yamodsync.core.WavePreset
import ru.combogame.yamodsync.ui.collection.CollectionScreen
import ru.combogame.yamodsync.ui.home.HomeScreen
import ru.combogame.yamodsync.ui.player.FullPlayer
import ru.combogame.yamodsync.ui.shell.AppShell
import ru.combogame.yamodsync.ui.shell.Tab
import ru.combogame.yamodsync.ui.theme.YaModSyncTheme

/** Витрина экранов на выдуманных данных: ядро и вход не нужны. */
class ShowcaseActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Тема всегда тёмная: значки системных панелей — светлые, при любом фоне.
        enableEdgeToEdge(
            statusBarStyle = androidx.activity.SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = androidx.activity.SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        val screen = intent.getStringExtra("screen") ?: "home"
        setContent {
            var settings by remember { mutableStateOf(AppSettings(relay = "ws://10.0.2.2:8799", room = "дом", name = "Рома")) }
            YaModSyncTheme(background = androidx.compose.ui.graphics.Color(settings.theme.background), accent = androidx.compose.ui.graphics.Color(settings.accent.color)) {
                when (screen) {
                    "room-live" -> LiveRoom()
                    "settings" -> ru.combogame.yamodsync.ui.settings.SettingsScreen(
                        settings = settings,
                        login = ru.combogame.yamodsync.auth.LoginState.SignedIn("roma", "Рома", plus = true),
                        version = "0.1.0",
                        onChange = { settings = it(settings) },
                        onSignOut = {},
                        onClose = {},
                    ) {
                        val updates = (application as ru.combogame.yamodsync.YaModSyncApp).updates
                        val update by updates.state.collectAsState()
                        UpdateSection(update, updates.current, onCheck = updates::check, onInstall = updates::install)
                    }
                    else -> Showcase(screen)
                }
            }
        }
    }
}

val demoQueue = listOf(
    TrackRef("1", "10", "Альбом", "Ночной город", "Исполнитель", 214_000, "avatars.yandex.net/get-music-content/1/a.1/%%"),
    TrackRef("2", "11", "Альбом", "Утро", "Другой исполнитель", 187_000, "avatars.yandex.net/get-music-content/1/a.2/%%"),
)

val demoLikes = demoQueue + listOf("Dangerous" to "David Guetta", "Какаду" to "N1NT3ND0", "Звёзды" to "Группа", "Ветер" to "Певица")
    .mapIndexed { i, (title, artist) -> TrackRef("${i + 3}", "${i + 20}", "Альбом", title, artist, 200_000, null) }

val demoLyrics = Lyrics(
    synced = true,
    lines = listOf("Город не спит", "Огни вдоль реки", "Мы идём вдвоём", "", "Ночной город", "Тише, тише").mapIndexed { i, t -> LyricLine(i * 6_000L + 60_000, t) },
    writers = listOf("Автор"),
)

val demoRooms = listOf(
    RoomListing("дом", listOf("Аня", "Миша"), "Ночной город — Исполнитель", playing = true, wave = true),
    RoomListing("работа", emptyList()),
)

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
                "room" -> demoSnapshot.copy(admin = true, feeding = false, station = """{"seeds":["user:onyourwave"],"by":"Аня"}""", driftMs = 24, rttMs = 41, queue = demoLikes)
                else -> demoSnapshot
            },
        )
    }
    val onCommand: (RoomCommand) -> Unit = { if (it == RoomCommand.Toggle) snapshot = snapshot.copy(roomPlaying = snapshot.roomPlaying != true) }
    if (screen.startsWith("player")) {
        FullPlayer(
            snapshot.copy(driftMs = 38, localTrack = "1", repeat = "all", trackLiked = true, queue = demoLikes),
            roomName = if (screen == "player-solo") null else "дом",
            liked = emptySet(),
            presets = demoPresets,
            onCommand = onCommand,
            loadLyrics = { demoLyrics },
            onClose = {},
        )
        return
    }
    val tab = when (screen.substringBefore('-')) { "collection" -> Tab.Collection; "room" -> Tab.Room; else -> Tab.Home }
    AppShell(snapshot, roomName = "дом", account = "Вы", onCommand = onCommand, onOpenPlayer = {}, onOpenSettings = {}, initialTab = tab) { t, _ ->
        when (t) {
            Tab.Home -> HomeScreen(snapshot, demoPresets, onCommand)
            Tab.Collection -> CollectionScreen(snapshot, demoLikes, onCommand)
            Tab.Room -> RoomScreen(
                snapshot = snapshot,
                room = if (screen == "room-join") null else RoomConfig("ws://10.0.2.2:8799", "дом", ""),
                settings = AppSettings(relay = "ws://10.0.2.2:8799", room = "дом"),
                loadRooms = { _, _ -> Result.success(demoRooms) },
                onJoin = { _, _ -> },
                onLeave = {},
                onCommand = onCommand,
                onOpenPlayer = {},
            )
        }
    }
}

/**
 * Вкладка «Комната» на настоящем ядре, без входа в Яндекс: список комнат и вход
 * проверяются на релее с ПК (`ws://10.0.2.2:8799`). Треки без токена не играют.
 */
@Composable
fun LiveRoom() {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val native = remember { ru.combogame.yamodsync.core.JniNative(context.applicationContext) }
    val session = remember { ru.combogame.yamodsync.core.CoreSession(native, scope, kotlinx.coroutines.Dispatchers.IO) }
    val snapshot by session.snapshot.collectAsState()
    var room by remember { mutableStateOf<RoomConfig?>(null) }
    fun start(config: RoomConfig?, name: String) {
        room = config
        scope.launch {
            session.start(ru.combogame.yamodsync.core.StartConfig(dataDir = context.filesDir.absolutePath, name = name.ifBlank { "эмулятор" }, clientId = "showcase-emulator", room = config))
        }
    }
    androidx.compose.runtime.DisposableEffect(Unit) { onDispose { kotlinx.coroutines.runBlocking { session.stop() } } }
    AppShell(snapshot, roomName = room?.room, account = "Эмулятор", onCommand = session::command, onOpenPlayer = {}, onOpenSettings = {}, initialTab = Tab.Room) { _, _ ->
        RoomScreen(
            snapshot = snapshot,
            room = room,
            settings = AppSettings(relay = "ws://10.0.2.2:8799"),
            loadRooms = { relay, password ->
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { ru.combogame.yamodsync.core.parseReply(native.rooms(relay, password)) }.mapCatching {
                    ru.combogame.yamodsync.core.coreJson.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(RoomListing.serializer()), it)
                }
            },
            onJoin = { config, name -> start(config, name) },
            onLeave = { start(null, "") },
            onCommand = session::command,
            onOpenPlayer = {},
        )
    }
}
