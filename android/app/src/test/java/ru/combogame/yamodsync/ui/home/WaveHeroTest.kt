package ru.combogame.yamodsync.ui.home

import org.junit.Assert.assertEquals
import org.junit.Test
import ru.combogame.yamodsync.core.StationInfo

class WaveHeroTest {
    private val myWave = StationInfo(seeds = listOf("user:onyourwave"))

    @Test
    fun aloneTheWaveIsNotCalledTheRoomsWave() {
        assertEquals("Подбирается для вас", waveHeroView(myWave, owner = null, playing = true, unfed = false, plain = true, inRoom = false).caption)
    }

    @Test
    fun inARoomTheWaveIsTheRooms() {
        assertEquals("Волна комнаты · подбирается для вас", waveHeroView(myWave, owner = null, playing = true, unfed = false, plain = true, inRoom = true).caption)
        assertEquals("Волна комнаты · ведёт Аня", waveHeroView(myWave, owner = "Аня", playing = true, unfed = false, plain = true, inRoom = true).caption)
    }
}
