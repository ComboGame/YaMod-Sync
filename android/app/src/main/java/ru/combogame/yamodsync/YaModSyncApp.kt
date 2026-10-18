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
    lateinit var model: AppModel
        private set

    override fun onCreate() {
        super.onCreate()
        val native = JniNative(this)
        model = AppModel(this, native, CoreSession(native, scope, Dispatchers.IO), scope)
    }
}
