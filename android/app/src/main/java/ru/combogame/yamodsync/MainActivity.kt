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
import ru.combogame.yamodsync.ui.shell.AppShell
import ru.combogame.yamodsync.ui.theme.YaModSyncTheme

class MainActivity : ComponentActivity() {
    private var controller: com.google.common.util.concurrent.ListenableFuture<androidx.media3.session.MediaController>? = null

    override fun onStart() {
        super.onStart()
        // Подключение к медиа-сессии и запускает службу: без неё музыка
        // остановилась бы вместе с экраном.
        val token = androidx.media3.session.SessionToken(this, android.content.ComponentName(this, ru.combogame.yamodsync.playback.PlaybackService::class.java))
        controller = androidx.media3.session.MediaController.Builder(this, token).buildAsync()
    }

    override fun onStop() {
        controller?.let { androidx.media3.session.MediaController.releaseFuture(it) }
        controller = null
        super.onStop()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            registerForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) {}
                .launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }
        val model = (application as YaModSyncApp).model
        setContent {
            YaModSyncTheme {
                val login by model.login.collectAsStateWithLifecycle()
                when (val state = login) {
                    LoginState.Checking -> Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                    }
                    is LoginState.SignedOut -> LoginScreen(reason = state.reason, onToken = model::signIn)
                    is LoginState.SignedIn -> SignedIn(model)
                }
            }
        }
    }
}

/** Что на экране поверх вкладок. Полный плеер и настройки — свои экраны, «назад» возвращает к вкладкам. */
enum class Screen { Shell, Player, Settings }

@androidx.compose.runtime.Composable
private fun SignedIn(model: AppModel) {
    var screen by androidx.compose.runtime.saveable.rememberSaveable { androidx.compose.runtime.mutableStateOf(Screen.Shell) }
    val snapshot by model.session.snapshot.collectAsStateWithLifecycle()
    val room by model.room.collectAsStateWithLifecycle()
    val login by model.login.collectAsStateWithLifecycle()
    androidx.activity.compose.BackHandler(enabled = screen != Screen.Shell) { screen = Screen.Shell }
    when (screen) {
        Screen.Shell -> AppShell(
            snapshot = snapshot,
            roomName = room?.room,
            account = (login as? LoginState.SignedIn)?.name?.ifBlank { null } ?: "Я",
            onCommand = model.session::command,
            onOpenPlayer = { screen = Screen.Player },
            onOpenSettings = { screen = Screen.Settings },
        ) { tab, _ -> Placeholder(tab.title) }
        Screen.Player -> Placeholder("Плеер")
        Screen.Settings -> Placeholder("Настройки")
    }
}

/** Временно, пока у вкладки нет своего экрана (задачи 11–15). */
@androidx.compose.runtime.Composable
private fun Placeholder(title: String) {
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background), contentAlignment = Alignment.Center) {
        Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
    }
}
