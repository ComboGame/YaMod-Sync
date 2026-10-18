package ru.combogame.yamodsync.ui.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import ru.combogame.yamodsync.core.LyricLine
import ru.combogame.yamodsync.core.RoomSnapshot
import ru.combogame.yamodsync.core.TrackRef

class PlayerTextsTest {
    private val a = TrackRef("1", "10", title = "А")
    private val b = TrackRef("2", "20", title = "Б")
    private val playing = RoomSnapshot(track = a, queue = listOf(a, b), roomPlaying = true, status = "connected", localTrack = "1")

    @Test
    fun theRoomsWaveIsNamedAfterTheRoom() {
        assertEquals("Волна комнаты «дом»", sourceLabel(playing.copy(station = "user:onyourwave"), roomName = "дом", liked = emptySet()))
    }

    @Test
    fun aloneTheWaveIsMineOrItsPreset() {
        assertEquals("Моя волна", sourceLabel(playing.copy(station = "user:onyourwave"), roomName = null, liked = emptySet()))
        val rnb = """{"seeds":["genre:rnb"],"name":"R&B"}"""
        assertEquals("R&B", sourceLabel(playing.copy(station = rnb), roomName = null, liked = emptySet()))
    }

    @Test
    fun aQueueOfLikedTracksIsMyLikes() {
        assertEquals("Мне нравится", sourceLabel(playing, roomName = "дом", liked = setOf("1", "2", "3")))
    }

    @Test
    fun anyOtherQueueIsTheRooms() {
        assertEquals("Очередь комнаты", sourceLabel(playing, roomName = "дом", liked = setOf("1")))
        assertEquals("Очередь", sourceLabel(playing, roomName = null, liked = emptySet()))
    }

    @Test
    fun aloneThereIsNoSyncLine() {
        assertNull(syncLine(playing.copy(driftMs = 38), inRoom = false))
    }

    @Test
    fun togetherItSaysHowClose() {
        assertEquals("В синхроне с комнатой · 38 мс", syncLine(playing.copy(driftMs = 38), inRoom = true)?.text)
        assertEquals(SyncTone.Together, syncLine(playing.copy(driftMs = -38), inRoom = true)?.tone)
    }

    @Test
    fun headphonesGoneItSaysThePhoneIsPausedAlone() {
        assertEquals("Здесь на паузе, комната играет дальше", syncLine(playing.copy(driftMs = 38, volume = 0f), inRoom = true)?.text)
    }

    @Test
    fun farOffItIsCatchingUp() {
        val line = syncLine(playing.copy(driftMs = 640), inRoom = true)
        assertEquals("Догоняю комнату · 640 мс", line?.text)
        assertEquals(SyncTone.Catching, line?.tone)
    }

    @Test
    fun pausedForEveryone() {
        assertEquals("Пауза у всех", syncLine(playing.copy(roomPlaying = false), inRoom = true)?.text)
    }

    @Test
    fun timesAreMinutesAndSeconds() {
        assertEquals("01:08", formatTime(68_400))
        assertEquals("00:00", formatTime(0))
        assertEquals("62:05", formatTime(3_725_000))
    }

    @Test
    fun theShareLinkPointsAtTheTrackInItsAlbum() {
        assertEquals("https://music.yandex.ru/album/10/track/1", shareUrl(a))
        assertEquals("https://music.yandex.ru/track/1", shareUrl(a.copy(albumId = null)))
    }

    @Test
    fun theLyricLineIsTheLastOneStarted() {
        val lines = listOf(LyricLine(0, "раз"), LyricLine(5_000, "два"), LyricLine(9_000, "три"))
        assertEquals(-1, currentLine(listOf(LyricLine(1_000, "x")), 500))
        assertEquals(1, currentLine(lines, 6_000))
        assertEquals(2, currentLine(lines, 60_000))
    }
}
