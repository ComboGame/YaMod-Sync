package ru.combogame.yamodsync.auth

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import ru.combogame.yamodsync.R
import ru.combogame.yamodsync.ui.theme.YaTokens

/**
 * Вход: сначала экран-приглашение, по кнопке — страница входа Яндекса. Пароль
 * вводится только на странице Яндекса; приложение берёт лишь токен из адреса,
 * на который Яндекс перенаправляет после входа.
 */
@Composable
fun LoginScreen(reason: String?, onToken: (String) -> Unit) {
    var showPage by remember { mutableStateOf(false) }
    if (showPage) {
        YandexLoginPage(onToken = onToken, onCancel = { showPage = false })
        return
    }
    Column(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).safeDrawingPadding().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        androidx.compose.foundation.Image(
            painter = painterResource(R.mipmap.ic_launcher),
            contentDescription = null,
            modifier = Modifier.size(88.dp),
        )
        Spacer(Modifier.height(24.dp))
        Text("Яндекс Музыка Sync", style = MaterialTheme.typography.headlineSmall, color = YaTokens.TextStrong)
        Spacer(Modifier.height(8.dp))
        Text(
            "Войдите в аккаунт Яндекса: «Моя волна», «Мне нравится» и треки комнаты играют с вашего аккаунта.",
            style = MaterialTheme.typography.bodyMedium,
            color = YaTokens.Text,
            textAlign = TextAlign.Center,
        )
        if (reason != null) {
            Spacer(Modifier.height(12.dp))
            Text(reason, style = MaterialTheme.typography.bodyMedium, color = YaTokens.Warning, textAlign = TextAlign.Center)
        }
        Spacer(Modifier.height(28.dp))
        Button(
            onClick = { showPage = true },
            modifier = Modifier.fillMaxWidth().height(52.dp),
            shape = RoundedCornerShape(YaTokens.RadiusButton),
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
        ) {
            Text("Войти через Яндекс", style = MaterialTheme.typography.titleSmall)
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun YandexLoginPage(onToken: (String) -> Unit, onCancel: () -> Unit) {
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).safeDrawingPadding()) {
        Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
            Text("Вход в Яндекс", style = MaterialTheme.typography.titleMedium, color = YaTokens.TextStrong, modifier = Modifier.align(Alignment.CenterStart))
            Text(
                "Отмена",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.align(Alignment.CenterEnd).clickable(onClick = onCancel).padding(4.dp),
            )
        }
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { context ->
                WebView(context).apply {
                    // AndroidView ставит WRAP_CONTENT, и тогда WebView считает 100vh нулём: выезжающие
                    // снизу меню Яндекса («Отправить код повторно» → пуш или смс) оказывались над экраном.
                    layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    CookieManager.getInstance().setAcceptCookie(true)
                    webViewClient = object : WebViewClient() {
                        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                            val token = url?.let(::tokenFromRedirect) ?: return
                            view.stopLoading()
                            onToken(token)
                        }
                    }
                    loadUrl(YANDEX_LOGIN_URL)
                }
            },
        )
    }
}
