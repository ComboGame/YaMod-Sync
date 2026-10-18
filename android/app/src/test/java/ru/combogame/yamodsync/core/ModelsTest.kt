package ru.combogame.yamodsync.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelsTest {
    private fun fixture(name: String) =
        requireNotNull(javaClass.classLoader?.getResource(name)) { "нет $name" }.readText()

    @Test
    fun aRealSnapshotFromTheBridgeIsRead() {
        val snapshot = parseSnapshot(fixture("snapshot.json"))
        assertEquals("connected", snapshot.status)
        assertEquals(5, snapshot.queue?.size)
        assertEquals("Трек 1", snapshot.track?.title)
        assertEquals(2, snapshot.listeners.size)
        assertNull("клиент не сказал про Плюс", snapshot.listeners[1].plus)
        assertTrue(snapshot.listeners[0].admin)
        assertTrue(snapshot.feeding)
    }

    @Test
    fun fieldsTheAppDoesNotKnowAreIgnored() {
        val snapshot = parseSnapshot("""{"connected":true,"something_new":{"a":1},"status":"connected"}""")
        assertTrue(snapshot.connected)
        assertNull(snapshot.queue)
    }

    @Test
    fun aStationIsReadAsASpecOrABareSeed() {
        val spec = parseStation("""{"seeds":["genre:rnb"],"name":"R'n'B","by":"Рома"}""")!!
        assertEquals(listOf("genre:rnb"), spec.seeds)
        assertEquals("Рома", spec.by)
        assertFalse(isPlainWave(spec))
        val bare = parseStation("user:onyourwave")!!
        assertEquals(listOf("user:onyourwave"), bare.seeds)
        assertTrue(isPlainWave(bare))
        assertNull(parseStation(null))
    }

    @Test
    fun commandsAreWrittenTheWayTheCoreReadsThem() {
        assertEquals(
            Json.parseToJsonElement("""{"c":"wave","seeds":[],"fresh":true}"""),
            RoomCommand.Wave(emptyList(), fresh = true).toJson(),
        )
        assertEquals(Json.parseToJsonElement("""{"c":"toggle"}"""), RoomCommand.Toggle.toJson())
        val hand: JsonObject = RoomCommand.HandWave(3).toJson().jsonObject
        assertEquals("hand_wave", hand["c"].toString().trim('"'))
    }
}
