package ru.combogame.yamodsync.settings

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.emptyPreferences
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * DataStore в памяти: файловый на JVM под Windows не может заменить файл при второй
 * записи (на Android такого нет), а проверяется здесь не файл, а [SettingsStore].
 */
private class MemoryStore : DataStore<Preferences> {
    private val state = MutableStateFlow(emptyPreferences())
    private val lock = Mutex()
    override val data: Flow<Preferences> = state
    override suspend fun updateData(transform: suspend (t: Preferences) -> Preferences): Preferences =
        lock.withLock { transform(state.value).also { state.value = it } }
}

class AppSettingsTest {
    private fun store() = SettingsStore(MemoryStore())

    @Test
    fun freshSettingsAreTheDefaults() = runTest {
        val s = store().current()
        assertEquals(Theme.Oled, s.theme)
        assertEquals(Accent.Green, s.accent)
        assertEquals(Quality.High, s.quality)
        assertFalse(s.autoJoin)
        assertEquals("", s.name)
        assertTrue("an installation id is made at once", s.clientId.isNotBlank())
    }

    @Test
    fun theInstallationIdNeverChanges() = runTest {
        val store = store()
        assertEquals(store.current().clientId, store.current().clientId)
    }

    @Test
    fun aChangeIsKept() = runTest {
        val store = store()
        store.update { it.copy(quality = Quality.Economy, relay = "ws://10.0.2.2:8799", room = "дом", autoJoin = true) }
        val s = store.current()
        assertEquals(Quality.Economy, s.quality)
        assertEquals("ws://10.0.2.2:8799", s.relay)
        assertEquals("дом", s.room)
        assertTrue(s.autoJoin)
    }

    @Test
    fun anUnknownStoredValueFallsBackToTheDefault() {
        assertEquals(Accent.Green, enumOr("Pink", Accent.Green))
        assertEquals(Accent.Blue, enumOr("Blue", Accent.Green))
    }
}
