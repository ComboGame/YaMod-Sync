package ru.combogame.yamodsync.settings

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStoreFile
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.util.UUID

/** Фон приложения: чёрный OLED или графит Modrinth. */
enum class Theme(val background: Long) { Oled(0xFF000000), Graphite(0xFF16181C) }

enum class Accent(val color: Long, val title: String) {
    Green(0xFF1BD96A, "Зелёный"),
    Blue(0xFF4F9CFF, "Синий"),
    Orange(0xFFE08325, "Оранжевый"),
    Violet(0xFFC084FC, "Фиолетовый"),
}

/** Качество звука; `core` — как его зовёт ядро (`api::Quality`). Без потерь нет: см. задачу 5 плана. */
enum class Quality(val core: String, val title: String) {
    High("high", "Высокое"),
    Economy("economy", "Экономия трафика"),
}

data class AppSettings(
    val theme: Theme = Theme.Oled,
    val accent: Accent = Accent.Green,
    val quality: Quality = Quality.High,
    /** Входить в последнюю комнату при запуске. */
    val autoJoin: Boolean = false,
    val name: String = "",
    /** Постоянный id установки: по нему релей узнаёт админа после переподключения. */
    val clientId: String = "",
    val relay: String = "",
    val room: String = "",
    val password: String = "",
)

fun <E : Enum<E>> enumOr(name: String?, default: E): E =
    default.declaringJavaClass.enumConstants?.firstOrNull { it.name == name } ?: default

private object Keys {
    val theme = stringPreferencesKey("theme")
    val accent = stringPreferencesKey("accent")
    val quality = stringPreferencesKey("quality")
    val autoJoin = booleanPreferencesKey("auto_join")
    val name = stringPreferencesKey("name")
    val clientId = stringPreferencesKey("client_id")
    val relay = stringPreferencesKey("relay")
    val room = stringPreferencesKey("room")
    val password = stringPreferencesKey("password")
}

/** Настройки приложения в DataStore. Пароль комнаты лежит здесь же и в логи не идёт. */
class SettingsStore(private val store: DataStore<Preferences>) {
    val settings: Flow<AppSettings> = store.data.map(::read)

    /** Текущие настройки; id установки появляется при первом чтении и дальше не меняется. */
    suspend fun current(): AppSettings {
        if (store.data.first()[Keys.clientId].isNullOrBlank()) {
            store.edit { if (it[Keys.clientId].isNullOrBlank()) it[Keys.clientId] = UUID.randomUUID().toString() }
        }
        return read(store.data.first())
    }

    suspend fun update(change: (AppSettings) -> AppSettings) {
        store.edit { prefs ->
            val next = change(read(prefs))
            prefs[Keys.theme] = next.theme.name
            prefs[Keys.accent] = next.accent.name
            prefs[Keys.quality] = next.quality.name
            prefs[Keys.autoJoin] = next.autoJoin
            prefs[Keys.name] = next.name
            if (next.clientId.isNotBlank()) prefs[Keys.clientId] = next.clientId
            prefs[Keys.relay] = next.relay
            prefs[Keys.room] = next.room
            prefs[Keys.password] = next.password
        }
    }

    private fun read(p: Preferences) = AppSettings(
        theme = enumOr(p[Keys.theme], Theme.Oled),
        accent = enumOr(p[Keys.accent], Accent.Green),
        quality = enumOr(p[Keys.quality], Quality.High),
        autoJoin = p[Keys.autoJoin] ?: false,
        name = p[Keys.name].orEmpty(),
        clientId = p[Keys.clientId].orEmpty(),
        relay = p[Keys.relay].orEmpty(),
        room = p[Keys.room].orEmpty(),
        password = p[Keys.password].orEmpty(),
    )

    companion object {
        fun of(context: Context) = SettingsStore(PreferenceDataStoreFactory.create { context.preferencesDataStoreFile("settings") })
    }
}
