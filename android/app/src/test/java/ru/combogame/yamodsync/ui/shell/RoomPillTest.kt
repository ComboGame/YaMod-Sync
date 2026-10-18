package ru.combogame.yamodsync.ui.shell

import org.junit.Assert.assertEquals
import org.junit.Test
import ru.combogame.yamodsync.core.Listener
import ru.combogame.yamodsync.core.RoomSnapshot

class RoomPillTest {
    private val three = List(3) { Listener(peer = it.toLong(), name = "п$it") }

    @Test
    fun inARoomItSaysWhichAndHowMany() {
        assertEquals("дом · 3", roomPillText(RoomSnapshot(status = "connected", listeners = three), roomName = "дом"))
    }

    @Test
    fun aLostConnectionSaysSo() {
        assertEquals("Переподключаюсь", roomPillText(RoomSnapshot(status = "reconnecting", listeners = three), roomName = "дом"))
    }

    /** The phone's own room is how it plays alone, not a room to speak of. */
    @Test
    fun thePhonesOwnRoomIsNoRoom() {
        assertEquals("Не в комнате", roomPillText(RoomSnapshot(status = "connected", listeners = three.take(1)), roomName = null))
        assertEquals("Не в комнате", roomPillText(null, roomName = null))
    }
}
