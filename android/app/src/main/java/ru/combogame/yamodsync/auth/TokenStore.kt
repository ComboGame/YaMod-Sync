package ru.combogame.yamodsync.auth

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.authStore by preferencesDataStore(name = "auth")
private val TOKEN = stringPreferencesKey("yandex_token")

/** Токен Яндекса — в приватном файле приложения; наружу и в логи не попадает. */
class TokenStore(private val context: Context) {
    val token: Flow<String?> = context.authStore.data.map { it[TOKEN]?.takeIf(String::isNotBlank) }

    suspend fun save(token: String) {
        context.authStore.edit { it[TOKEN] = token }
    }

    suspend fun clear() {
        context.authStore.edit { it.remove(TOKEN) }
    }
}
