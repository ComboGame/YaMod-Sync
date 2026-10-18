package ru.combogame.yamodsync.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LoginStateTest {
    @Test
    fun aKnownAccountIsSignedIn() {
        val state = loginStateFor("""{"ok":{"login":"roma","display_name":"Рома","plus":true}}""", LoginState.Checking)
        assertEquals(LoginState.SignedIn(login = "roma", name = "Рома", plus = true), state)
    }

    @Test
    fun aRejectedTokenSendsTheListenerToSignInAgain() {
        val state = loginStateFor("""{"error":"…","code":"unauthorized"}""", LoginState.Checking)
        assertEquals(LoginState.SignedOut("Вход устарел — войдите снова"), state)
    }

    /** No network is not a reason to throw a working token away. */
    @Test
    fun aNetworkErrorKeepsTheSignInAndSaysItIsOffline() {
        val before = LoginState.SignedIn(login = "roma", name = "Рома", plus = true)
        assertEquals(before.copy(offline = true), loginStateFor("""{"error":"нет сети","code":"network"}""", before))
        val atStart = loginStateFor("""{"error":"нет сети","code":"network"}""", LoginState.Checking)
        assertEquals(LoginState.SignedIn(login = "", name = "", plus = null, offline = true), atStart)
    }

    @Test
    fun theTokenIsTakenFromYandexsRedirect() {
        assertEquals(
            "y0_AgAAAAB",
            tokenFromRedirect("https://music.yandex.ru/#access_token=y0_AgAAAAB&token_type=bearer&expires_in=31536000"),
        )
        assertNull(tokenFromRedirect("https://passport.yandex.ru/auth?retpath=x"))
        assertNull(tokenFromRedirect("https://music.yandex.ru/#access_token=&token_type=bearer"))
    }
}
