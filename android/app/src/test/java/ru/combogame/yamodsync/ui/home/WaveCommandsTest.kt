package ru.combogame.yamodsync.ui.home

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import ru.combogame.yamodsync.core.RoomCommand
import ru.combogame.yamodsync.core.RoomSnapshot
import ru.combogame.yamodsync.core.WavePreset

class WaveCommandsTest {
    private val rnb = WavePreset(id = "rnb", title = "R&B", seeds = listOf("genre:rnb"))
    private val annasWave = """{"seeds":["genre:rnb"],"name":"R&B","by":"Аня"}"""

    @Test
    fun noPresetMeansMyWave() {
        assertEquals(RoomCommand.Wave(emptyList()), waveCommand(null))
    }

    @Test
    fun aPresetPlaysItsSeeds() {
        assertEquals(RoomCommand.Wave(listOf("genre:rnb")), waveCommand(rnb))
    }

    @Test
    fun withoutPlusTheWaveCannotBeStarted() {
        assertFalse(canStartWave(RoomSnapshot(hasPlus = false)))
        assertTrue(canStartWave(RoomSnapshot(hasPlus = true)))
        // Не узнали — считаем, что Плюс есть: решит Яндекс.
        assertTrue(canStartWave(RoomSnapshot(hasPlus = null)))
    }

    @Test
    fun anotherListenersWaveIsTheirs() {
        assertEquals("Аня", waveOwner(RoomSnapshot(station = annasWave)))
    }

    @Test
    fun ownAdminsAndUnfedWavesHaveNoOtherOwner() {
        assertNull(waveOwner(RoomSnapshot(station = annasWave, feeding = true)))
        assertNull(waveOwner(RoomSnapshot(station = annasWave, admin = true)))
        assertNull(waveOwner(RoomSnapshot(station = annasWave, stationUnfed = true)))
        assertNull(waveOwner(RoomSnapshot(station = null)))
    }

    @Test
    fun aWaveFromAnOldClientHasSomeoneElseAsOwner() {
        assertEquals("другой участник", waveOwner(RoomSnapshot(station = "genre:rock")))
    }
}

class WaveRefusalTest {
    @Test
    fun aGuestHearsWhoseWaveItIsBeforeAnythingAboutPlus() {
        val s = RoomSnapshot(station = """{"seeds":["genre:rnb"],"by":"Аня"}""", hasPlus = false)
        assertEquals("Волну ведёт Аня: режим и очередь меняет только он", waveRefusal(s))
        assertEquals(NEEDS_PLUS_TEXT, waveRefusal(RoomSnapshot(hasPlus = false)))
        assertNull(waveRefusal(RoomSnapshot(hasPlus = true)))
    }
}
