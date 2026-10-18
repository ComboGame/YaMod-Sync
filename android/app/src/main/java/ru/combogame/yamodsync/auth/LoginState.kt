package ru.combogame.yamodsync.auth

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive
import ru.combogame.yamodsync.core.CoreError
import ru.combogame.yamodsync.core.parseReply

/** Вход в Яндекс: страница входа Яндекса в WebView, токен из её перенаправления. */
const val YANDEX_LOGIN_URL =
    "https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d"

sealed interface LoginState {
    data object Checking : LoginState

    data class SignedOut(val reason: String? = null) : LoginState

    /** `offline` — токен есть, но проверить его у Яндекса сейчас не вышло. */
    data class SignedIn(
        val login: String,
        val name: String,
        val plus: Boolean?,
        val offline: Boolean = false,
    ) : LoginState
}

/**
 * Что сказал Яндекс о токене (ответ `Native.account`). Отказ — повод войти
 * снова; нет сети — не повод выбрасывать рабочий токен.
 */
fun loginStateFor(accountJson: String, previous: LoginState): LoginState {
    val reply = parseReply(accountJson)
    reply.onSuccess { value ->
        val account = value as? JsonObject ?: return LoginState.SignedOut("Яндекс ответил непонятно")
        fun text(key: String) = (account[key] as? JsonPrimitive)?.content.orEmpty()
        return LoginState.SignedIn(
            login = text("login"),
            name = text("display_name"),
            plus = account["plus"]?.jsonPrimitive?.booleanOrNull,
        )
    }
    val error = reply.exceptionOrNull() as? CoreError
    if (error?.code == "unauthorized") return LoginState.SignedOut("Вход устарел — войдите снова")
    return when (previous) {
        is LoginState.SignedIn -> previous.copy(offline = true)
        else -> LoginState.SignedIn(login = "", name = "", plus = null, offline = true)
    }
}

/** Токен из адреса, на который Яндекс перенаправляет после входа (`#access_token=…`). */
fun tokenFromRedirect(url: String): String? {
    val fragment = url.substringAfter('#', missingDelimiterValue = "")
    if (fragment.isEmpty()) return null
    return fragment.split('&')
        .firstOrNull { it.startsWith("access_token=") }
        ?.substringAfter('=')
        ?.takeIf { it.isNotBlank() }
}
