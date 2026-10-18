package ru.combogame.yamodsync.update

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.core.net.toUri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import ru.combogame.yamodsync.core.coreJson
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** Релиз приложения на GitHub, новее установленного. */
data class Release(
    val version: String,
    /** Заметки релиза, как написаны на GitHub («Что нового»). */
    val notes: String,
    val apkUrl: String,
    val apkName: String,
    val sumsUrl: String?,
    val size: Long,
)

@Serializable
private data class GitHubAsset(val name: String, val browserDownloadUrl: String, val size: Long = 0)

@Serializable
private data class GitHubRelease(
    val tagName: String,
    val draft: Boolean = false,
    val prerelease: Boolean = false,
    val body: String? = null,
    val assets: List<GitHubAsset> = emptyList(),
)

private const val TAG_PREFIX = "android-v"
private val APK = Regex("""YaModSync-.+\.apk""")
const val RELEASES_URL = "https://api.github.com/repos/ComboGame/YaMod-Sync/releases?per_page=30"

/** `0.10.0` новее `0.9.3`: части — числа, а не текст (как `newer` в updater.ts мода). */
fun newerVersion(candidate: String, than: String): Boolean {
    val a = candidate.split('.', '-').map { it.toIntOrNull() ?: 0 }
    val b = than.split('.', '-').map { it.toIntOrNull() ?: 0 }
    for (i in 0 until maxOf(a.size, b.size)) {
        val diff = a.getOrElse(i) { 0 } - b.getOrElse(i) { 0 }
        if (diff != 0) return diff > 0
    }
    return false
}

/**
 * Самый новый релиз приложения (`android-v*`, не черновик и не пре-релиз, с APK),
 * если он новее [current]. Релизы мода (`mod-v*`) лежат в том же репозитории — мимо.
 */
fun pickRelease(releasesJson: String, current: String): Release? =
    coreJson.decodeFromString(ListSerializer(GitHubRelease.serializer()), releasesJson)
        .asSequence()
        .filter { !it.draft && !it.prerelease && it.tagName.startsWith(TAG_PREFIX) }
        .mapNotNull { r ->
            val apk = r.assets.firstOrNull { APK.matches(it.name) } ?: return@mapNotNull null
            Release(
                version = r.tagName.removePrefix(TAG_PREFIX),
                notes = r.body.orEmpty().trim(),
                apkUrl = apk.browserDownloadUrl,
                apkName = apk.name,
                sumsUrl = r.assets.firstOrNull { it.name == "SHA256SUMS.txt" }?.browserDownloadUrl,
                size = apk.size,
            )
        }
        .filter { newerVersion(it.version, current) }
        .maxWithOrNull { a, b -> if (newerVersion(a.version, b.version)) 1 else if (newerVersion(b.version, a.version)) -1 else 0 }

/** Хеш файла из `SHA256SUMS.txt` (строки `хеш  имя` или `хеш *имя`, как пишет sha256sum). */
fun checksumFor(sums: String, fileName: String): String? = sums.lineSequence()
    .map { it.trim().split(Regex("""\s+"""), limit = 2) }
    .firstOrNull { it.size == 2 && it[1].removePrefix("*") == fileName }
    ?.first()
    ?.lowercase()

/**
 * Обновление из релизов GitHub. Android даёт приложению вне Google Play скачать своё
 * обновление, но не поставить его молча: установщик всегда спрашивает, а в первый раз
 * ещё и просит разрешить установку из этого приложения. Защищает обновление подпись
 * APK — чужим ключом Android приложение не заменит — и сверка SHA-256 с релизом.
 */
object Updater {
    fun currentVersion(context: Context): String =
        runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull() ?: "0"

    /** Новый релиз или null; ошибки сети — исключением, их покажет карточка. */
    suspend fun latest(context: Context): Release? = withContext(Dispatchers.IO) {
        pickRelease(get(RELEASES_URL, currentVersion(context)).decodeToString(), currentVersion(context))
    }

    /** Качает APK в кэш приложения (прежние загрузки стираются) и сверяет его SHA-256. */
    suspend fun download(context: Context, release: Release, onProgress: (Float) -> Unit): File = withContext(Dispatchers.IO) {
        val folder = File(context.cacheDir, "updates").apply {
            deleteRecursively()
            mkdirs()
        }
        val expected = release.sumsUrl?.let { checksumFor(get(it, currentVersion(context)).decodeToString(), release.apkName) }
            ?: error("в релизе нет контрольной суммы для ${release.apkName}")
        val target = File(folder, release.apkName)
        val digest = MessageDigest.getInstance("SHA-256")
        val connection = open(release.apkUrl, currentVersion(context))
        try {
            if (connection.responseCode != 200) error("GitHub ответил ${connection.responseCode}")
            val total = connection.contentLengthLong.takeIf { it > 0 } ?: release.size
            connection.inputStream.use { input ->
                target.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    var done = 0L
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        output.write(buffer, 0, read)
                        digest.update(buffer, 0, read)
                        done += read
                        if (total > 0) onProgress((done.toFloat() / total).coerceAtMost(1f))
                    }
                }
            }
        } finally {
            connection.disconnect()
        }
        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        if (actual != expected) {
            target.delete()
            error("файл повреждён: контрольная сумма не совпала")
        }
        target
    }

    /**
     * Отдаёт APK системному установщику через [PackageInstaller]. Возвращает текст,
     * если не может: файл не от этого приложения или подписан чужим ключом, либо
     * установка из приложения ещё не разрешена — тогда открывается эта настройка.
     */
    fun install(context: Context, apk: File): String? {
        val pm = context.packageManager
        val archive = archiveInfo(pm, apk) ?: return "это не установочный файл Android"
        if (archive.packageName != context.packageName) return "файл от другого приложения: ${archive.packageName}"
        if (!sameSigner(pm, context.packageName, archive)) return "файл подписан чужим ключом — устанавливать его нельзя"
        if (!pm.canRequestPackageInstalls()) {
            context.startActivity(
                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, "package:${context.packageName}".toUri())
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            return "Разрешите установку из этого приложения и нажмите «Установить» ещё раз"
        }
        val installer = pm.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            setSize(apk.length())
            if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
        }
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("base.apk", 0, apk.length()).use { out -> apk.inputStream().use { it.copyTo(out) }; session.fsync(out) }
            val status = Intent(context, InstallReceiver::class.java).setPackage(context.packageName)
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            session.commit(PendingIntent.getBroadcast(context, id, status, flags).intentSender)
        }
        return null
    }

    private fun open(url: String, version: String): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 30_000
            // GitHub отвечает переадресацией на своё файловое хранилище.
            instanceFollowRedirects = true
            setRequestProperty("Accept", "application/vnd.github+json")
            setRequestProperty("User-Agent", "YaModSync-Android/$version")
        }

    private fun get(url: String, version: String): ByteArray {
        val connection = open(url, version)
        try {
            if (connection.responseCode != 200) error("GitHub ответил ${connection.responseCode}")
            return connection.inputStream.use { it.readBytes() }
        } finally {
            connection.disconnect()
        }
    }

    private fun archiveInfo(pm: PackageManager, apk: File): PackageInfo? {
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else @Suppress("DEPRECATION") PackageManager.GET_SIGNATURES
        return pm.getPackageArchiveInfo(apk.absolutePath, flags)
    }

    /** Подписан ли скачанный APK тем же ключом, что установленное приложение. */
    private fun sameSigner(pm: PackageManager, packageName: String, archive: PackageInfo): Boolean {
        if (Build.VERSION.SDK_INT >= 28) {
            val installed = pm.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo?.apkContentsSigners ?: return false
            val candidate = archive.signingInfo?.apkContentsSigners ?: return false
            return installed.toSet() == candidate.toSet()
        }
        @Suppress("DEPRECATION")
        val installed = pm.getPackageInfo(packageName, PackageManager.GET_SIGNATURES).signatures ?: return false
        @Suppress("DEPRECATION")
        val candidate = archive.signatures ?: return false
        return installed.toSet() == candidate.toSet()
    }
}
