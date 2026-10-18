package ru.combogame.yamodsync.ui.collection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import ru.combogame.yamodsync.core.RoomCommand
import ru.combogame.yamodsync.core.TrackRef
import kotlin.random.Random

class LikesCommandsTest {
    private val all = List(8) { TrackRef(trackId = "$it", title = "Трек $it") }

    @Test
    fun listenPlaysFromTheTopInOrder() {
        assertEquals(listOf(RoomCommand.Shuffle(false), RoomCommand.SetQueue(all, 0)), playLikes(all, start = 0, shuffle = false))
    }

    /**
     * The relay keeps a set queue in the order it was given, and its shuffle only reorders
     * what is still to come — so the phone shuffles the list itself and then turns shuffle on
     * (for tracks added later). Shuffle first would have reordered the old queue instead.
     */
    @Test
    fun shuffleSendsAShuffledQueueThenTurnsShuffleOn() {
        val commands = playLikes(all, start = 0, shuffle = true, random = Random(7))
        val queue = commands[0] as RoomCommand.SetQueue
        assertEquals(0, queue.start)
        assertEquals(all.toSet(), queue.tracks.toSet())
        assertNotEquals(all, queue.tracks)
        assertEquals(RoomCommand.Shuffle(true), commands[1])
    }

    @Test
    fun aTappedTrackStartsTheQueueAtIt() {
        assertEquals(RoomCommand.SetQueue(all, 4), playLikes(all, start = 4, shuffle = false).last())
    }

    @Test
    fun countsAreSaidInRussian() {
        assertEquals("1 трек", tracksCount(1))
        assertEquals("3 трека", tracksCount(3))
        assertEquals("12 треков", tracksCount(12))
        assertEquals("21 трек", tracksCount(21))
        assertEquals("412 треков", tracksCount(412))
    }
}
