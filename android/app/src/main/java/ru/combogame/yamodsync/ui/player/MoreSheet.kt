package ru.combogame.yamodsync.ui.player

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Album
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.ThumbDown
import androidx.compose.runtime.Composable
import ru.combogame.yamodsync.core.TrackRef

/** «Ещё»: не нравится, к артисту и альбому (пока — на сайте Яндекс Музыки). */
@Composable
fun MoreSheet(track: TrackRef, onDislike: () -> Unit, onOpen: (String) -> Unit, onDismiss: () -> Unit) {
    YaSheet(track.title, onDismiss) {
        SheetRow("Не нравится", Icons.Rounded.ThumbDown, onDislike)
        if (track.artist.isNotBlank()) {
            SheetRow("К артисту", Icons.Rounded.Person) {
                onOpen("https://music.yandex.ru/search?text=" + android.net.Uri.encode(track.artist))
            }
        }
        track.albumId?.let { album ->
            SheetRow("К альбому", Icons.Rounded.Album) { onOpen("https://music.yandex.ru/album/$album") }
        }
    }
}
