package ru.combogame.yamodsync.core

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Stands in for the Rust core: answers with canned JSON and counts the calls. */
private class FakeNative(private val snapshots: List<String>) : NativeApi {
    var polls = 0
    val commands = mutableListOf<String>()
    var stopped = false

    override fun start(configJson: String) = """{"ok":42}"""
    override fun snapshot(handle: Long): String {
        val text = snapshots[minOf(polls, snapshots.size - 1)]
        polls++
        return """{"ok":$text}"""
    }
    override fun command(handle: Long, commandJson: String): String {
        commands += commandJson
        return """{"ok":true}"""
    }
    override fun likes(handle: Long) = """{"ok":{"tracks":[],"updated_ms":0}}"""
    override fun lyrics(handle: Long, trackId: String) = """{"ok":null}"""
    override fun wavePresets(handle: Long) = """{"ok":[]}"""
    override fun rooms(relay: String, password: String) = """{"ok":[]}"""
    override fun account(token: String) = """{"ok":{"login":"x","display_name":"x","plus":true}}"""
    override fun stop(handle: Long): String {
        stopped = true
        return """{"ok":true}"""
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class CoreSessionTest {
    private val withQueue =
        """{"connected":true,"status":"connected","queue_revision":1,"queue":[{"track_id":"1","title":"a","artist":"b","duration_ms":1000}]}"""
    private val withoutQueue = """{"connected":true,"status":"connected","queue_revision":1,"position_ms":500}"""

    @Test
    fun aStartedSessionIsPolledAndAnAbsentQueueKeepsTheLastOne() = runTest {
        val native = FakeNative(listOf(withQueue, withoutQueue))
        val session = CoreSession(native, backgroundScope, StandardTestDispatcher(testScheduler), pollMs = 250)
        assertTrue(session.start(StartConfig(dataDir = "/data")).isSuccess)
        runCurrent()
        assertEquals(1, session.snapshot.value?.queue?.size)
        advanceTimeBy(300)
        runCurrent()
        val snapshot = assertNotNull(session.snapshot.value).let { session.snapshot.value!! }
        assertEquals(500L, snapshot.positionMs)
        assertEquals("the queue the core left out is the one already held", 1, snapshot.queue?.size)
    }

    @Test
    fun commandsReachTheCoreAndStoppingEndsThePolling() = runTest {
        val native = FakeNative(listOf(withQueue))
        val session = CoreSession(native, backgroundScope, StandardTestDispatcher(testScheduler), pollMs = 250)
        session.start(StartConfig(dataDir = "/data"))
        runCurrent()
        session.command(RoomCommand.Next)
        runCurrent()
        assertEquals(listOf("""{"c":"next"}"""), native.commands)
        session.stop()
        val polls = native.polls
        advanceTimeBy(2_000)
        runCurrent()
        assertTrue(native.stopped)
        assertEquals("no polling after stop", polls, native.polls)
    }
}
