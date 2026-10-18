package ru.combogame.yamodsync.playback

import android.app.PendingIntent
import android.content.Intent
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import ru.combogame.yamodsync.MainActivity
import ru.combogame.yamodsync.YaModSyncApp

private const val LIKE = "ru.combogame.yamodsync.LIKE"

/**
 * Служба воспроизведения: держит процесс живым, пока играет музыка, и даёт
 * системе медиа-сессию. Уведомление с плеером строит Media3 из состояния
 * [CorePlayer] и обновляет само — при смене трека и при паузе из комнаты.
 */
@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
    private var mediaSession: MediaSession? = null
    private var focus: FocusController? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    override fun onCreate() {
        super.onCreate()
        val app = application as YaModSyncApp
        val model = app.model
        focus = FocusController(this, model)
        wakeLock = getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "yamodsync:playback")
            .apply { setReferenceCounted(false) }
        @Suppress("DEPRECATION")
        wifiLock = getSystemService(WifiManager::class.java).createWifiLock(
            if (Build.VERSION.SDK_INT >= 29) WifiManager.WIFI_MODE_FULL_LOW_LATENCY else WifiManager.WIFI_MODE_FULL_HIGH_PERF,
            "yamodsync:room",
        ).apply { setReferenceCounted(false) }

        lateinit var session: MediaSession
        val player = CorePlayer(model.session, app.scope) { view ->
            holdLocks(view.playWhenReady)
            focus?.onPlaying(view.playWhenReady)
            session.setMediaButtonPreferences(listOf(likeButton(view.liked)))
        }
        session = MediaSession.Builder(this, player)
            .setCallback(Callback())
            .setMediaButtonPreferences(listOf(likeButton(false)))
            .setSessionActivity(
                PendingIntent.getActivity(
                    this, 0, Intent(this, MainActivity::class.java),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                ),
            )
            .build()
        mediaSession = session
    }

    private fun likeButton(liked: Boolean) =
        CommandButton.Builder(if (liked) CommandButton.ICON_HEART_FILLED else CommandButton.ICON_HEART_UNFILLED)
            .setDisplayName(if (liked) "Убрать из «Мне нравится»" else "Мне нравится")
            .setSessionCommand(SessionCommand(LIKE, Bundle.EMPTY))
            .build()

    /** Процессор и Wi-Fi не засыпают, пока играет музыка: звук декодирует ядро в этом процессе. */
    private fun holdLocks(playing: Boolean) {
        if (playing) {
            wakeLock?.acquire(6 * 60 * 60 * 1000L)
            wifiLock?.acquire()
        } else {
            wakeLock?.takeIf { it.isHeld }?.release()
            wifiLock?.takeIf { it.isHeld }?.release()
        }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = mediaSession

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Смахнули приложение, а музыка стоит — служба больше не нужна.
        val player = mediaSession?.player
        if (player == null || !player.playWhenReady) stopSelf()
    }

    override fun onDestroy() {
        focus?.release()
        holdLocks(false)
        mediaSession?.run {
            player.release()
            release()
        }
        mediaSession = null
        super.onDestroy()
    }

    private inner class Callback : MediaSession.Callback {
        override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult =
            MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                .setAvailableSessionCommands(
                    MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon().add(SessionCommand(LIKE, Bundle.EMPTY)).build(),
                )
                .build()

        override fun onCustomCommand(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
            customCommand: SessionCommand,
            args: Bundle,
        ): ListenableFuture<SessionResult> {
            if (customCommand.customAction == LIKE) {
                val model = (application as YaModSyncApp).model
                likeCommands(model.session.snapshot.value).forEach(model.session::command)
            }
            return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
        }
    }
}
