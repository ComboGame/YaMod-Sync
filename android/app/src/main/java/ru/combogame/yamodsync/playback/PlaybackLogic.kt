package ru.combogame.yamodsync.playback

import ru.combogame.yamodsync.core.RoomCommand
import ru.combogame.yamodsync.core.RoomSnapshot

/** Обложка Яндекса нужного размера: шаблон `…/%%` → `https://…/400x400`. */
fun coverUrl(template: String?, size: Int = 400): String? =
    template?.takeIf { it.isNotBlank() }?.let { "https://" + it.replace("%%", "${size}x$size") }

/** Что показывают уведомление, экран блокировки и Bluetooth — из снапшота комнаты. */
data class PlayerView(
    val hasTrack: Boolean,
    val trackId: String?,
    val title: String,
    val artist: String,
    val artworkUrl: String?,
    val durationMs: Long,
    val positionMs: Long,
    /** Комната играет или ждёт готовности всех — для системы это «играет». */
    val playWhenReady: Boolean,
    val buffering: Boolean,
    val liked: Boolean,
)

/**
 * Звук выключен только на этом телефоне: в комнате отключились наушники или идёт
 * звонок (см. [focusAction]). Комната играет дальше, а здесь это пауза.
 */
val RoomSnapshot.mutedHere: Boolean get() = volume == 0f

/** Играет ли для этого телефона — что показывают кнопки и уведомление. */
fun playingHere(s: RoomSnapshot?): Boolean = s != null && (s.roomPlaying == true || s.waiting) && !s.mutedHere

/**
 * «Играть / пауза». На телефоне, где звук выключен только здесь, это «играть»:
 * звук включается с позиции комнаты, а пауза всем не ставится. Иначе он остался бы
 * немым — вернуть звук было нечем.
 */
fun toggleCommands(s: RoomSnapshot?): List<RoomCommand> =
    if (s?.mutedHere == true) listOfNotNull(RoomCommand.Volume(1f), RoomCommand.Toggle.takeIf { s.roomPlaying == false })
    else listOf(RoomCommand.Toggle)

fun playerViewOf(snapshot: RoomSnapshot?): PlayerView {
    val track = snapshot?.track
    return PlayerView(
        hasTrack = track != null,
        trackId = track?.trackId,
        title = track?.title.orEmpty(),
        // Связь с комнатой пропала — сказать об этом там, куда смотрят с выключенным экраном.
        artist = if (snapshot?.status == "reconnecting") listOfNotNull("Переподключаюсь…", track?.artist?.ifBlank { null }).joinToString(" · ") else track?.artist.orEmpty(),
        artworkUrl = coverUrl(track?.coverUri),
        durationMs = snapshot?.durationMs?.takeIf { it > 0 } ?: track?.durationMs ?: 0,
        positionMs = snapshot?.positionMs ?: 0,
        playWhenReady = track != null && playingHere(snapshot),
        buffering = track != null && (snapshot.loading || snapshot.waiting),
        liked = snapshot?.trackLiked == true,
    )
}

/** Что система говорит о звуке приложения. */
enum class FocusEvent { LossTransient, LossTransientCanDuck, Loss, Gain, BecomingNoisy }

enum class FocusAction {
    /** Поставить паузу — без комнаты это пауза только для себя. */
    PauseRoom,

    /** В комнате пауза остановила бы всех: замолчать только на этом телефоне. */
    MuteLocally,
    Duck,
    RestoreVolume,
}

fun focusAction(event: FocusEvent, inRoom: Boolean): FocusAction = when (event) {
    FocusEvent.LossTransientCanDuck -> FocusAction.Duck
    FocusEvent.Gain -> FocusAction.RestoreVolume
    FocusEvent.LossTransient, FocusEvent.Loss, FocusEvent.BecomingNoisy ->
        if (inRoom) FocusAction.MuteLocally else FocusAction.PauseRoom
}

/**
 * Сердечко у текущего трека. Волну, которую ведёт этот телефон, Яндекс учит тем же
 * сердечком; фидбек от остальных не идёт — волна не их (как в моде).
 */
fun likeCommands(s: RoomSnapshot?): List<RoomCommand> {
    val track = s?.track ?: return emptyList()
    val liked = !s.trackLiked
    val like = RoomCommand.Like(track, liked)
    return if (s.feeding) listOf(like, RoomCommand.WaveFeedback(if (liked) "like" else "unlike", track.trackId)) else listOf(like)
}

/** «Не нравится»: тому, кто ведёт волну, — фидбек и пропуск, остальным — просто пропуск. */
fun dislikeCommands(s: RoomSnapshot?): List<RoomCommand> {
    val track = s?.track ?: return emptyList()
    return if (s.feeding) listOf(RoomCommand.WaveFeedback("dislike", track.trackId), RoomCommand.Next) else listOf(RoomCommand.Next)
}
