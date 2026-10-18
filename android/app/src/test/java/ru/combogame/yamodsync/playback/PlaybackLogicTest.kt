package ru.combogame.yamodsync.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import ru.combogame.yamodsync.core.RoomCommand
import ru.combogame.yamodsync.core.RoomSnapshot
import ru.combogame.yamodsync.core.TrackRef

class PlayerStateMapperTest {
    private val track = TrackRef(trackId = "7", title = "Молчи", artist = "кис-кис", durationMs = 198_000, coverUri = "avatars.yandex.net/get-music-content/1/a/%%")

    @Test
    fun theRoomsTrackIsWhatTheNotificationShows() {
        val view = playerViewOf(RoomSnapshot(track = track, roomPlaying = true, positionMs = 61_000, durationMs = 198_000, trackLiked = true))
        assertTrue(view.hasTrack)
        assertEquals("Молчи", view.title)
        assertEquals("кис-кис", view.artist)
        assertEquals("https://avatars.yandex.net/get-music-content/1/a/400x400", view.artworkUrl)
        assertTrue(view.playWhenReady)
        assertEquals(61_000L, view.positionMs)
        assertEquals(198_000L, view.durationMs)
        assertTrue(view.liked)
    }

    @Test
    fun aTrackWaitingForTheRoomCountsAsPlayingAndBuffering() {
        val view = playerViewOf(RoomSnapshot(track = track, roomPlaying = false, waiting = true))
        assertTrue(view.playWhenReady)
        assertTrue(view.buffering)
    }

    @Test
    fun nothingQueuedIsAnEmptyPlayer() {
        val view = playerViewOf(RoomSnapshot(track = null))
        assertFalse(view.hasTrack)
        assertFalse(view.playWhenReady)
        assertNull(playerViewOf(null).artworkUrl)
    }
}

class FocusPolicyTest {
    @Test
    fun aloneTheMusicPausesForACallAndForUnpluggedHeadphones() {
        assertEquals(FocusAction.PauseRoom, focusAction(FocusEvent.LossTransient, inRoom = false))
        assertEquals(FocusAction.PauseRoom, focusAction(FocusEvent.Loss, inRoom = false))
        assertEquals(FocusAction.PauseRoom, focusAction(FocusEvent.BecomingNoisy, inRoom = false))
    }

    /** In a room a pause would stop everybody; only this phone goes quiet. */
    @Test
    fun inARoomOnlyThisPhoneGoesQuiet() {
        assertEquals(FocusAction.MuteLocally, focusAction(FocusEvent.LossTransient, inRoom = true))
        assertEquals(FocusAction.MuteLocally, focusAction(FocusEvent.Loss, inRoom = true))
        assertEquals(FocusAction.MuteLocally, focusAction(FocusEvent.BecomingNoisy, inRoom = true))
    }

    @Test
    fun duckingAndRegainingWorkTheSameEverywhere() {
        for (inRoom in listOf(true, false)) {
            assertEquals(FocusAction.Duck, focusAction(FocusEvent.LossTransientCanDuck, inRoom))
            assertEquals(FocusAction.RestoreVolume, focusAction(FocusEvent.Gain, inRoom))
        }
    }
}

class LikeCommandsTest {
    private val track = ru.combogame.yamodsync.core.TrackRef("7", "70")

    @Test
    fun theWavesFeederTeachesItWithTheHeart() {
        val s = RoomSnapshot(track = track, feeding = true)
        assertEquals(listOf(RoomCommand.Like(track, true), RoomCommand.WaveFeedback("like", "7")), likeCommands(s))
        assertEquals(listOf(RoomCommand.Like(track, false), RoomCommand.WaveFeedback("unlike", "7")), likeCommands(s.copy(trackLiked = true)))
    }

    @Test
    fun othersOnlyLikeTheTrack() {
        assertEquals(listOf(RoomCommand.Like(track, true)), likeCommands(RoomSnapshot(track = track)))
    }

    @Test
    fun aDislikeFromAnyoneElseIsASkip() {
        assertEquals(listOf(RoomCommand.Next), dislikeCommands(RoomSnapshot(track = track)))
        assertEquals(listOf(RoomCommand.WaveFeedback("dislike", "7"), RoomCommand.Next), dislikeCommands(RoomSnapshot(track = track, feeding = true)))
    }
}

class ReconnectingNotificationTest {
    private val track = TrackRef("7", "70", title = "Трек", artist = "Артист")

    /** Связь пропала посреди трека: экран блокировки говорит об этом, а не молчит. */
    @Test
    fun aLostConnectionIsSaidUnderTheTitle() {
        val view = playerViewOf(RoomSnapshot(track = track, status = "reconnecting"))
        assertEquals("Трек", view.title)
        assertEquals("Переподключаюсь… · Артист", view.artist)
    }

    @Test
    fun connectedShowsTheArtist() {
        assertEquals("Артист", playerViewOf(RoomSnapshot(track = track, status = "connected")).artist)
    }
}

class MutedHereTest {
    private val track = TrackRef("7", "70", title = "Трек", artist = "Артист")

    /** Наушники отключились в комнате: комната играет дальше, а этот телефон — на паузе. */
    @Test
    fun aPhoneMutedInARoomShowsPaused() {
        val muted = RoomSnapshot(track = track, roomPlaying = true, volume = 0f)
        assertFalse(playingHere(muted))
        assertFalse(playerViewOf(muted).playWhenReady)
        assertTrue(playingHere(muted.copy(volume = 1f)))
    }

    /** «Играть» на таком телефоне включает звук здесь, а не ставит паузу всем. */
    @Test
    fun playOnAMutedPhoneUnmutesItInsteadOfPausingTheRoom() {
        assertEquals(listOf(RoomCommand.Volume(1f)), toggleCommands(RoomSnapshot(track = track, roomPlaying = true, volume = 0f)))
    }

    /** Комнату за это время поставили на паузу: звук включается, и комната продолжает. */
    @Test
    fun playOnAMutedPhoneInAPausedRoomAlsoResumesIt() {
        assertEquals(
            listOf(RoomCommand.Volume(1f), RoomCommand.Toggle),
            toggleCommands(RoomSnapshot(track = track, roomPlaying = false, volume = 0f)),
        )
    }

    @Test
    fun anAudiblePhoneTogglesTheRoom() {
        assertEquals(listOf(RoomCommand.Toggle), toggleCommands(RoomSnapshot(track = track, roomPlaying = true)))
        assertEquals(listOf(RoomCommand.Toggle), toggleCommands(null))
    }
}
