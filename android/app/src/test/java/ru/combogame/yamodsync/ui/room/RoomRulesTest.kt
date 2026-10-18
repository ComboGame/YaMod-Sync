package ru.combogame.yamodsync.ui.room

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import ru.combogame.yamodsync.core.Listener
import ru.combogame.yamodsync.core.RoomListing
import ru.combogame.yamodsync.core.RoomSnapshot

class RoomRulesTest {
    private val me = Listener(1, "Я", you = true)
    private val anya = Listener(2, "Аня", feeds = true)
    private val misha = Listener(3, "Миша")
    private val noPlus = Listener(4, "Без", plus = false)
    private val wave = """{"seeds":["user:onyourwave"],"by":"Аня"}"""
    private val room = RoomSnapshot(station = wave, listeners = listOf(me, anya, misha, noPlus))

    @Test
    fun theWaveGoesToSomeoneWhoDoesNotLeadItAndHasPlus() {
        assertEquals(listOf(misha), handOverCandidates(room))
    }

    @Test
    fun onlyAnAdminMayHandTheWaveToThemselves() {
        assertEquals(listOf(me, misha), handOverCandidates(room.copy(admin = true)))
    }

    @Test
    fun aNonAdminHasNoActionsOnOthers() {
        assertTrue(adminActions(room, misha).isEmpty())
    }

    @Test
    fun anAdminHasNoActionsOnTheirOwnRow() {
        assertTrue(adminActions(room.copy(admin = true), me.copy(admin = true)).isEmpty())
    }

    @Test
    fun anAdminCanHandTheWaveAndTheirRights() {
        val admin = room.copy(admin = true)
        assertEquals(setOf(AdminAction.HandWave, AdminAction.MakeAdmin), adminActions(admin, misha))
        // Ведущему волну её не передают, без Плюса — тоже.
        assertEquals(setOf(AdminAction.MakeAdmin), adminActions(admin, anya))
        assertEquals(setOf(AdminAction.MakeAdmin), adminActions(admin, noPlus))
    }

    @Test
    fun withoutAWaveThereIsNothingToHand() {
        assertEquals(setOf(AdminAction.MakeAdmin), adminActions(room.copy(admin = true, station = null), misha))
    }

    @Test
    fun aRoomOnTheListIsEnteredByItsExactName() {
        val listed = listOf(RoomListing("дом"), RoomListing("Работа"))
        assertEquals("Войти", joinButtonText("дом", listed))
        assertEquals("Создать", joinButtonText("дача", listed))
        assertEquals("Войти", joinButtonText(" дом ", listed))
    }

    @Test
    fun roomsErrorsAreTheCoresPhrases() {
        assertEquals("Неверный пароль", roomsErrorText("unauthorized", "неверный пароль"))
        assertEquals("Не удалось подключиться к серверу: timeout", roomsErrorText("unreachable", "не удалось подключиться к серверу: timeout"))
    }
}
