package ru.combogame.yamodsync.playback

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import androidx.core.content.ContextCompat
import ru.combogame.yamodsync.AppModel
import ru.combogame.yamodsync.core.RoomCommand

/**
 * Аудиофокус и выдернутые наушники. Ядро играет само, поэтому за фокусом следит
 * приложение: звонок или другое приложение со звуком — без комнаты пауза, в
 * комнате тишина только на этом телефоне (см. [focusAction]).
 */
class FocusController(private val context: Context, private val model: AppModel) {
    private val audio = context.getSystemService(AudioManager::class.java)
    private var held = false
    private var pausedByFocus = false
    private var receiverRegistered = false

    private val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build(),
        )
        .setOnAudioFocusChangeListener { change ->
            val event = when (change) {
                AudioManager.AUDIOFOCUS_LOSS -> FocusEvent.Loss
                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> FocusEvent.LossTransient
                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> FocusEvent.LossTransientCanDuck
                AudioManager.AUDIOFOCUS_GAIN -> FocusEvent.Gain
                else -> null
            }
            event?.let(::apply)
        }
        .build()

    private val noisy = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) apply(FocusEvent.BecomingNoisy)
        }
    }

    /** Вызывается на каждое изменение «играет / не играет». */
    fun onPlaying(playing: Boolean) {
        if (playing && !held) {
            held = audio.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
            if (!receiverRegistered) {
                ContextCompat.registerReceiver(
                    context, noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), ContextCompat.RECEIVER_NOT_EXPORTED,
                )
                receiverRegistered = true
            }
        }
    }

    fun release() {
        if (held) audio.abandonAudioFocusRequest(request)
        held = false
        if (receiverRegistered) context.unregisterReceiver(noisy)
        receiverRegistered = false
    }

    private fun apply(event: FocusEvent) {
        val inRoom = model.room.value != null
        val playing = model.session.snapshot.value?.let { it.roomPlaying == true || it.waiting } == true
        when (focusAction(event, inRoom)) {
            FocusAction.PauseRoom -> if (playing) {
                model.session.command(RoomCommand.Toggle)
                pausedByFocus = event == FocusEvent.LossTransient
            }
            FocusAction.MuteLocally -> model.session.command(RoomCommand.Volume(0f))
            FocusAction.Duck -> model.session.command(RoomCommand.Volume(0.3f))
            FocusAction.RestoreVolume -> {
                model.session.command(RoomCommand.Volume(1f))
                if (pausedByFocus && !playing) model.session.command(RoomCommand.Toggle)
                pausedByFocus = false
            }
        }
        if (event == FocusEvent.Loss) held = false
    }
}
