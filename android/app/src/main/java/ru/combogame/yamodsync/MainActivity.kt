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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ru.combogame.yamodsync.auth.LoginScreen
import ru.combogame.yamodsync.auth.LoginState
import ru.combogame.yamodsync.ui.theme.YaModSyncTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val model = (application as YaModSyncApp).model
        setContent {
            YaModSyncTheme {
                val login by model.login.collectAsStateWithLifecycle()
                when (val state = login) {
                    LoginState.Checking -> Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                    }
                    is LoginState.SignedOut -> LoginScreen(reason = state.reason, onToken = model::signIn)
                    is LoginState.SignedIn -> SignedInPlaceholder(model, state)
                }
            }
        }
    }
}

/** Временно, до оболочки с вкладками (задача 10). */
@androidx.compose.runtime.Composable
private fun SignedInPlaceholder(model: AppModel, state: LoginState.SignedIn) {
    val snapshot by model.session.snapshot.collectAsStateWithLifecycle()
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background), contentAlignment = Alignment.Center) {
        Text(
            "Вы вошли: ${state.name.ifEmpty { "аккаунт" }}, Плюс: ${state.plus}. Ядро: ${snapshot?.status ?: "…"}",
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}
