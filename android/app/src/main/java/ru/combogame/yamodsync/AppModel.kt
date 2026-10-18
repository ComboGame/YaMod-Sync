package ru.combogame.yamodsync

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import ru.combogame.yamodsync.auth.LoginState
import ru.combogame.yamodsync.auth.TokenStore
import ru.combogame.yamodsync.auth.loginStateFor
import ru.combogame.yamodsync.core.CoreSession
import ru.combogame.yamodsync.core.NativeApi
import ru.combogame.yamodsync.core.RoomConfig
import ru.combogame.yamodsync.core.StartConfig

/**
 * Всё, что живёт дольше экрана: вход, сессия ядра и то, к какой комнате она
 * подключена. Экраны только читают отсюда и зовут действия.
 */
class AppModel(
    private val context: Context,
    private val native: NativeApi,
    val session: CoreSession,
    private val scope: CoroutineScope,
) {
    private val tokens = TokenStore(context)
    private val _login = MutableStateFlow<LoginState>(LoginState.Checking)
    val login: StateFlow<LoginState> = _login.asStateFlow()

    private var token: String = ""

    /** Комната, к которой подключена сессия; null — своя комната на телефоне. */
    private val _room = MutableStateFlow<RoomConfig?>(null)
    val room: StateFlow<RoomConfig?> = _room.asStateFlow()

    /** Настройки сессии, которые задают экраны (ник, качество, id установки). */
    var name: String = ""
    var quality: String = "high"
    var clientId: String = ""

    init {
        scope.launch {
            val saved = tokens.token.first()
            if (saved == null) {
                _login.value = LoginState.SignedOut()
                return@launch
            }
            token = saved
            check()
            restart()
        }
    }

    private suspend fun check() {
        val reply = withContext(Dispatchers.IO) { native.account(token) }
        _login.value = loginStateFor(reply, _login.value)
        if (_login.value is LoginState.SignedOut) {
            tokens.clear()
            token = ""
        }
    }

    fun signIn(newToken: String) {
        scope.launch {
            token = newToken
            tokens.save(newToken)
            _login.value = LoginState.Checking
            check()
            if (_login.value is LoginState.SignedIn) restart()
        }
    }

    fun signOut() {
        scope.launch {
            session.stop()
            tokens.clear()
            token = ""
            _login.value = LoginState.SignedOut()
        }
    }

    /** Войти в комнату сервера или (null) вернуться в свою. */
    fun join(room: RoomConfig?) {
        _room.value = room
        scope.launch { restart() }
    }

    /** Перезапускает сессию с текущими настройками: вход, комната, качество. */
    suspend fun restart(): Result<Unit> = session.start(
        StartConfig(
            token = token,
            clientId = clientId,
            dataDir = context.filesDir.absolutePath,
            quality = quality,
            name = name,
            room = _room.value,
        ),
    )
}
