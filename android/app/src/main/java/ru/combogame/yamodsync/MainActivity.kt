package ru.combogame.yamodsync

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ru.combogame.yamodsync.auth.LoginScreen
import ru.combogame.yamodsync.auth.LoginState
import ru.combogame.yamodsync.ui.collection.CollectionScreen
import ru.combogame.yamodsync.ui.home.HomeScreen
import ru.combogame.yamodsync.ui.player.FullPlayer
import ru.combogame.yamodsync.ui.room.RoomScreen
import ru.combogame.yamodsync.ui.settings.SettingsScreen
import ru.combogame.yamodsync.update.UpdateBanner
import ru.combogame.yamodsync.update.UpdateModel
import ru.combogame.yamodsync.update.UpdateSection
import androidx.compose.ui.graphics.Color
import ru.combogame.yamodsync.ui.shell.AppShell
import ru.combogame.yamodsync.ui.shell.Tab
import ru.combogame.yamodsync.ui.theme.YaModSyncTheme

class MainActivity : ComponentActivity() {
    private var controller: com.google.common.util.concurrent.ListenableFuture<androidx.media3.session.MediaController>? = null

    override fun onStart() {
        super.onStart()
        // Подключение к медиа-сессии и запускает службу: без неё музыка
        // остановилась бы вместе с экраном.
        val token = androidx.media3.session.SessionToken(this, android.content.ComponentName(this, ru.combogame.yamodsync.playback.PlaybackService::class.java))
        controller = androidx.media3.session.MediaController.Builder(this, token).buildAsync()
        (application as YaModSyncApp).model.recheckLogin()
    }

    override fun onStop() {
        controller?.let { androidx.media3.session.MediaController.releaseFuture(it) }
        controller = null
        super.onStop()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Тема всегда тёмная: значки системных панелей — светлые, при любом фоне.
        enableEdgeToEdge(
            statusBarStyle = androidx.activity.SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = androidx.activity.SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            registerForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) {}
                .launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }
        val model = (application as YaModSyncApp).model
        setContent {
            val settings by model.settings.collectAsStateWithLifecycle()
            YaModSyncTheme(background = Color(settings.theme.background), accent = Color(settings.accent.color)) {
                val login by model.login.collectAsStateWithLifecycle()
                when (val state = login) {
                    LoginState.Checking -> Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                    }
                    is LoginState.SignedOut -> LoginScreen(reason = state.reason, onToken = model::signIn)
                    is LoginState.SignedIn -> SignedIn(model, (application as YaModSyncApp).updates)
                }
            }
        }
    }
}

/** Что на экране поверх вкладок. Полный плеер и настройки — свои экраны, «назад» возвращает к вкладкам. */
enum class Screen { Shell, Player, Settings }

@androidx.compose.runtime.Composable
private fun SignedIn(model: AppModel, updates: UpdateModel) {
    val update by updates.state.collectAsStateWithLifecycle()
    var screen by androidx.compose.runtime.saveable.rememberSaveable { androidx.compose.runtime.mutableStateOf(Screen.Shell) }
    val snapshot by model.session.snapshot.collectAsStateWithLifecycle()
    val room by model.room.collectAsStateWithLifecycle()
    val login by model.login.collectAsStateWithLifecycle()
    val settings by model.settings.collectAsStateWithLifecycle()
    // Режимы колеса нужны только Главной; сессия ядра должна уже идти, иначе их не у кого спросить.
    var presets by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf<List<ru.combogame.yamodsync.core.WavePreset>?>(null) }
    val running = snapshot != null
    androidx.compose.runtime.LaunchedEffect(running) {
        if (running && presets == null) presets = model.session.wavePresets().getOrNull() ?: emptyList()
    }
    // «Мне нравится» перечитывается, когда ядро говорит, что лайки сменились (здесь или в другом клиенте).
    var likes by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf<List<ru.combogame.yamodsync.core.TrackRef>?>(null) }
    val likedRevision = snapshot?.likedRevision
    androidx.compose.runtime.LaunchedEffect(running, likedRevision) {
        if (running) model.session.likes().onSuccess { likes = it }.onFailure { if (likes == null) likes = emptyList() }
    }
    androidx.activity.compose.BackHandler(enabled = screen != Screen.Shell) { screen = Screen.Shell }
    when (screen) {
        Screen.Shell -> AppShell(
            snapshot = snapshot,
            roomName = room?.room,
            account = (login as? LoginState.SignedIn)?.name?.ifBlank { null } ?: "Я",
            onCommand = model.session::command,
            onOpenPlayer = { screen = Screen.Player },
            onOpenSettings = { screen = Screen.Settings },
        ) { tab, _ ->
            when (tab) {
                Tab.Home -> androidx.compose.foundation.layout.Column {
                    UpdateBanner(update) { screen = Screen.Settings }
                    HomeScreen(snapshot, presets, inRoom = room?.room != null, onCommand = model.session::command)
                }
                Tab.Collection -> CollectionScreen(snapshot, likes, model.session::command)
                Tab.Room -> RoomScreen(
                    snapshot = snapshot,
                    room = room,
                    settings = settings,
                    loadRooms = model::rooms,
                    onJoin = model::join,
                    onLeave = model::leave,
                    onCommand = model.session::command,
                    onOpenPlayer = { screen = Screen.Player },
                )
            }
        }
        Screen.Player -> FullPlayer(
            snapshot = snapshot,
            roomName = room?.room,
            liked = likes.orEmpty().mapTo(HashSet()) { it.trackId },
            presets = presets,
            onCommand = model.session::command,
            loadLyrics = { model.session.lyrics(it).getOrNull() },
            onClose = { screen = Screen.Shell },
        )
        Screen.Settings -> SettingsScreen(
            settings = settings,
            login = login,
            version = appVersion(),
            onChange = model::updateSettings,
            onSignOut = {
                screen = Screen.Shell
                model.signOut()
            },
            onClose = { screen = Screen.Shell },
        ) {
            UpdateSection(update, updates.current, onCheck = updates::check, onInstall = updates::install)
        }
    }
}

/** Версия из манифеста (`versionName`), как её видит система. */
@androidx.compose.runtime.Composable
private fun appVersion(): String {
    val context = androidx.compose.ui.platform.LocalContext.current
    return androidx.compose.runtime.remember {
        runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull().orEmpty()
    }
}
