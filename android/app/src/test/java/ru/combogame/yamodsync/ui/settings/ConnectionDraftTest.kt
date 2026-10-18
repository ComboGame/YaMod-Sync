package ru.combogame.yamodsync.ui.settings

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import ru.combogame.yamodsync.settings.AppSettings

class ConnectionDraftTest {
    private val saved = AppSettings(relay = "ws://h:8787", password = "p", name = "Рома")

    @Test
    fun anUntouchedFormHasNothingToSave() {
        assertFalse(ConnectionDraft("ws://h:8787", "p", "Рома").differsFrom(saved))
    }

    @Test
    fun anyChangedFieldIsWorthSaving() {
        assertTrue(ConnectionDraft("ws://other:8787", "p", "Рома").differsFrom(saved))
        assertTrue(ConnectionDraft("ws://h:8787", "q", "Рома").differsFrom(saved))
        assertTrue(ConnectionDraft("ws://h:8787", "p", "Рома2").differsFrom(saved))
    }
}
