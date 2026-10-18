package ru.combogame.yamodsync

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ru.combogame.yamodsync.core.StartConfig
import ru.combogame.yamodsync.ui.theme.YaModSyncTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val app = application as YaModSyncApp
        setContent {
            YaModSyncTheme {
                val snapshot by app.session.snapshot.collectAsStateWithLifecycle()
                var error by remember { mutableStateOf<String?>(null) }
                LaunchedEffect(Unit) {
                    if (!app.session.running) {
                        app.session.start(StartConfig(dataDir = filesDir.absolutePath, name = "Телефон"))
                            .onFailure { error = it.message }
                    }
                }
                Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background), contentAlignment = Alignment.Center) {
                    Text(
                        error ?: snapshot?.let { "Ядро запущено: ${it.listeners.size} в комнате, ${it.status}" } ?: "Запускаю ядро…",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                }
            }
        }
    }
}
