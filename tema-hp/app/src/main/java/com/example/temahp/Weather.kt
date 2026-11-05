package com.example.temahp

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Cuaca semasa dari Open-Meteo (percuma, tanpa kunci API).
 * Lokasi lalai: Shah Alam (sepadan zon SGR01). Boleh ditukar dengan tahan kad cuaca.
 */
object Weather {

    private const val KEY_COORDS = "wx_coords"
    private const val KEY_CACHE = "wx_cache"
    private const val DEFAULT_COORDS = "3.0733,101.5185"

    data class Now(val temp: Double, val code: Int, val humidity: Int, val fetchedAt: Long)

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PrayerTimes.PREF, Context.MODE_PRIVATE)

    fun coords(ctx: Context): Pair<Double, Double> {
        val raw = prefs(ctx).getString(KEY_COORDS, DEFAULT_COORDS) ?: DEFAULT_COORDS
        return parseCoords(raw) ?: parseCoords(DEFAULT_COORDS)!!
    }

    fun parseCoords(text: String): Pair<Double, Double>? {
        val parts = text.split(",").map { it.trim().toDoubleOrNull() }
        if (parts.size != 2) return null
        val lat = parts[0] ?: return null
        val lon = parts[1] ?: return null
        if (lat !in -90.0..90.0 || lon !in -180.0..180.0) return null
        return Pair(lat, lon)
    }

    fun setCoords(ctx: Context, lat: Double, lon: Double) {
        prefs(ctx).edit().putString(KEY_COORDS, "$lat,$lon").apply()
    }

    /** Dipanggil di thread latar. Pulang null jika tiada sambungan. */
    fun fetch(lat: Double, lon: Double): Now? {
        val url = URL(
            "https://api.open-meteo.com/v1/forecast?latitude=$lat&longitude=$lon" +
                "&current=temperature_2m,relative_humidity_2m,weather_code&timezone=Asia%2FKuala_Lumpur"
        )
        val conn = url.openConnection() as HttpURLConnection
        return try {
            conn.connectTimeout = 10_000
            conn.readTimeout = 10_000
            if (conn.responseCode != 200) {
                null
            } else {
                val text = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                val cur = JSONObject(text).getJSONObject("current")
                Now(
                    temp = cur.getDouble("temperature_2m"),
                    code = cur.getInt("weather_code"),
                    humidity = cur.getInt("relative_humidity_2m"),
                    fetchedAt = System.currentTimeMillis(),
                )
            }
        } catch (e: Exception) {
            null
        } finally {
            conn.disconnect()
        }
    }

    fun save(ctx: Context, now: Now) {
        val json = JSONObject()
            .put("t", now.temp)
            .put("c", now.code)
            .put("h", now.humidity)
            .put("at", now.fetchedAt)
        prefs(ctx).edit().putString(KEY_CACHE, json.toString()).apply()
    }

    fun cached(ctx: Context): Now? {
        val s = prefs(ctx).getString(KEY_CACHE, null) ?: return null
        return try {
            val j = JSONObject(s)
            Now(j.getDouble("t"), j.getInt("c"), j.getInt("h"), j.getLong("at"))
        } catch (e: Exception) {
            null
        }
    }

    fun describe(code: Int): String = when (code) {
        0 -> "Cerah"
        1, 2 -> "Sebahagian berawan"
        3 -> "Mendung"
        45, 48 -> "Berkabut"
        51, 53, 55, 56, 57 -> "Gerimis"
        61, 63, 65, 66, 67, 80, 81, 82 -> "Hujan"
        95, 96, 99 -> "Ribut petir"
        else -> "Berawan"
    }
}
