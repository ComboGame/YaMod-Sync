package ru.combogame.yamodsync.playback

import android.os.Looper
import androidx.annotation.OptIn
import androidx.core.net.toUri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.SimpleBasePlayer
import androidx.media3.common.util.UnstableApi
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import ru.combogame.yamodsync.core.CoreSession
import ru.combogame.yamodsync.core.RoomCommand

/**
 * Плеер для медиа-сессии: звука в нём нет, его играет ядро. Он показывает
 * системе снапшот комнаты (шторка, экран блокировки, часы, Bluetooth) и
 * превращает её кнопки в команды комнате — те же, что у кнопок приложения.
 */
@OptIn(UnstableApi::class)
class CorePlayer(
    private val session: CoreSession,
    scope: CoroutineScope,
    private val onView: (PlayerView) -> Unit = {},
) : SimpleBasePlayer(Looper.getMainLooper()) {
    var view: PlayerView = playerViewOf(null)
        private set

    private val collector: Job = scope.launch(Dispatchers.Main) {
        session.snapshot.collect { snapshot ->
            val next = playerViewOf(snapshot)
            if (next != view) {
                view = next
                onView(next)
                invalidateState()
            }
        }
    }

    override fun getState(): State {
        val commands = Player.Commands.Builder()
            .addAll(
                COMMAND_PLAY_PAUSE,
                COMMAND_SEEK_TO_NEXT,
                COMMAND_SEEK_TO_PREVIOUS,
                COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,
                COMMAND_GET_CURRENT_MEDIA_ITEM,
                COMMAND_GET_METADATA,
                COMMAND_GET_TIMELINE,
                COMMAND_RELEASE,
            )
            .build()
        val builder = State.Builder().setAvailableCommands(commands)
        val id = view.trackId
        if (!view.hasTrack || id == null) return builder.setPlaybackState(STATE_IDLE).build()
        val item = MediaItem.Builder()
            .setMediaId(id)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(view.title)
                    .setArtist(view.artist)
                    .setArtworkUri(view.artworkUrl?.toUri())
                    .build(),
            )
            .build()
        val position = if (view.playWhenReady && !view.buffering) {
            // Между снапшотами система сама досчитывает позицию.
            PositionSupplier.getExtrapolating(view.positionMs, 1f)
        } else {
            PositionSupplier.getConstant(view.positionMs)
        }
        return builder
            .setPlaylist(listOf(MediaItemData.Builder(id).setMediaItem(item).setDurationUs(view.durationMs * 1000).build()))
            .setCurrentMediaItemIndex(0)
            .setContentPositionMs(position)
            .setPlayWhenReady(view.playWhenReady, PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
            .setPlaybackState(if (view.buffering) STATE_BUFFERING else STATE_READY)
            .build()
    }

    override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> {
        // `toggle`: ядро решает по состоянию комнаты, пауза это или продолжение.
        if (playWhenReady != view.playWhenReady) session.command(RoomCommand.Toggle)
        return Futures.immediateVoidFuture()
    }

    override fun handleSeek(mediaItemIndex: Int, positionMs: Long, seekCommand: Int): ListenableFuture<*> {
        session.command(
            when (seekCommand) {
                COMMAND_SEEK_TO_NEXT, COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> RoomCommand.Next
                COMMAND_SEEK_TO_PREVIOUS, COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> RoomCommand.Prev
                else -> RoomCommand.Seek(positionMs.coerceAtLeast(0))
            },
        )
        return Futures.immediateVoidFuture()
    }

    override fun handleRelease(): ListenableFuture<*> {
        collector.cancel()
        return Futures.immediateVoidFuture()
    }
}
