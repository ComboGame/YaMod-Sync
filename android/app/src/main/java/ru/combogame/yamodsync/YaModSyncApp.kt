package ru.combogame.yamodsync

import android.app.Application
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import ru.combogame.yamodsync.core.CoreSession
import ru.combogame.yamodsync.core.JniNative

/** Одна сессия ядра на процесс: её делят экраны и служба воспроизведения. */
class YaModSyncApp : Application() {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    lateinit var session: CoreSession
        private set

    override fun onCreate() {
        super.onCreate()
        session = CoreSession(JniNative(this), scope, Dispatchers.IO)
    }
}
