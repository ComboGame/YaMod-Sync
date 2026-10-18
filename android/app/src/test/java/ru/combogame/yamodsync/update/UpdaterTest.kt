package ru.combogame.yamodsync.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdaterTest {
    private fun release(tag: String, apk: Boolean = true, draft: Boolean = false, prerelease: Boolean = false): String {
        val version = tag.substringAfter("-v")
        val assets = buildList {
            if (apk) add("""{"name":"YaModSync-$version.apk","browser_download_url":"https://example.org/$tag/YaModSync-$version.apk","size":4200000}""")
            add("""{"name":"SHA256SUMS.txt","browser_download_url":"https://example.org/$tag/SHA256SUMS.txt","size":90}""")
        }
        return """{"tag_name":"$tag","draft":$draft,"prerelease":$prerelease,"body":"Что нового в $version","assets":[${assets.joinToString(",")}]}"""
    }

    private val releases = "[" + listOf(release("mod-v1.2.0"), release("android-v0.2.0"), release("android-v0.1.0")).joinToString(",") + "]"

    @Test
    fun versionsCompareAsNumbers() {
        assertTrue(newerVersion("0.10.0", "0.9.3"))
        assertFalse(newerVersion("0.9.3", "0.10.0"))
        assertFalse(newerVersion("0.2.0", "0.2.0"))
        assertTrue(newerVersion("0.2.1", "0.2"))
    }

    @Test
    fun theNewestAndroidReleaseIsPicked() {
        val found = pickRelease(releases, current = "0.1.0")
        assertEquals("0.2.0", found?.version)
        assertEquals("https://example.org/android-v0.2.0/YaModSync-0.2.0.apk", found?.apkUrl)
        assertEquals("https://example.org/android-v0.2.0/SHA256SUMS.txt", found?.sumsUrl)
        assertEquals("YaModSync-0.2.0.apk", found?.apkName)
        assertEquals(4_200_000L, found?.size)
        assertEquals("Что нового в 0.2.0", found?.notes)
    }

    @Test
    fun nothingWhenUpToDate() {
        assertNull(pickRelease(releases, current = "0.2.0"))
    }

    @Test
    fun aReleaseWithoutAnApkIsSkipped() {
        val json = "[" + listOf(release("android-v0.3.0", apk = false), release("android-v0.2.0")).joinToString(",") + "]"
        assertEquals("0.2.0", pickRelease(json, current = "0.1.0")?.version)
    }

    @Test
    fun draftsAndPrereleasesAreNotOffered() {
        val json = "[" + listOf(release("android-v0.4.0", draft = true), release("android-v0.3.0", prerelease = true)).joinToString(",") + "]"
        assertNull(pickRelease(json, current = "0.1.0"))
    }

    @Test
    fun theChecksumIsFoundByFileName() {
        val sums = "ab12  YaModSync-0.2.0.apk\nCD34 *other.exe\n"
        assertEquals("ab12", checksumFor(sums, "YaModSync-0.2.0.apk"))
        assertEquals("cd34", checksumFor(sums, "other.exe"))
        assertNull(checksumFor(sums, "missing.apk"))
    }
}
