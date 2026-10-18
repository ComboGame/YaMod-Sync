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
import ru.combogame.yamodsync.core.RoomListing
import ru.combogame.yamodsync.core.StartConfig
import ru.combogame.yamodsync.core.coreJson
import ru.combogame.yamodsync.core.parseReply
import ru.combogame.yamodsync.settings.AppSettings
import ru.combogame.yamodsync.settings.SettingsStore
import kotlinx.serialization.builtins.ListSerializer

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

    private val store = SettingsStore.of(context)
    private val _settings = MutableStateFlow(AppSettings())
    val settings: StateFlow<AppSettings> = _settings.asStateFlow()

    init {
        scope.launch {
            val loaded = store.current()
            _settings.value = loaded
            scope.launch { store.settings.collect { _settings.value = it } }
            // «Входить при запуске» — сразу в последнюю комнату, иначе своя комната на телефоне.
            if (loaded.autoJoin && loaded.relay.isNotBlank() && loaded.room.isNotBlank()) {
                _room.value = RoomConfig(loaded.relay, loaded.room, loaded.password)
            }
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

    /** Войти в комнату сервера; адрес, пароль, комната и ник запоминаются для следующего раза. */
    fun join(room: RoomConfig, name: String) {
        _room.value = room
        scope.launch {
            store.update { it.copy(relay = room.relay, room = room.room, password = room.password, name = name.trim()) }
            _settings.value = store.current()
            restart()
        }
    }

    /** Выйти из комнаты — снова своя комната на телефоне. */
    fun leave() {
        _room.value = null
        scope.launch { restart() }
    }

    /** Меняет настройки; качество и ник доходят до ядра перезапуском сессии. */
    fun updateSettings(change: (AppSettings) -> AppSettings) {
        scope.launch {
            val before = _settings.value
            store.update(change)
            val after = store.current()
            _settings.value = after
            if (after.quality != before.quality || after.name != before.name) {
                if (_login.value is LoginState.SignedIn) restart()
            }
        }
    }

    /** Комнаты на сервере — для формы входа; ошибка несёт код `unauthorized`/`old_relay`/`unreachable`. */
    suspend fun rooms(relay: String, password: String): Result<List<RoomListing>> =
        withContext(Dispatchers.IO) { parseReply(native.rooms(relay.trim(), password)) }.mapCatching {
            coreJson.decodeFromJsonElement(ListSerializer(RoomListing.serializer()), it)
        }

    /** Перезапускает сессию с текущими настройками: вход, комната, качество. */
    suspend fun restart(): Result<Unit> = session.start(
        StartConfig(
            token = token,
            clientId = _settings.value.clientId,
            dataDir = context.filesDir.absolutePath,
            quality = _settings.value.quality.core,
            // Без ника в комнате видно имя аккаунта Яндекса.
            name = _settings.value.name.ifBlank { (_login.value as? LoginState.SignedIn)?.name.orEmpty() },
            room = _room.value,
        ),
    )
}
