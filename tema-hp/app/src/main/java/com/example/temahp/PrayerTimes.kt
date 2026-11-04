package com.example.temahp

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * Waktu solat dari API e-Solat JAKIM.
 * Data satu bulan diambil sekali dan di-cache dalam SharedPreferences,
 * supaya API tidak dipanggil setiap hari.
 */
object PrayerTimes {

    const val PREF = "tema_hp"
    const val KEY_ZONE = "zone"
    private const val DEFAULT_ZONE = "SGR01"
    private const val DAY_MS = 86_400_000L

    // Nama Melayu -> kunci JSON JAKIM
    private val ORDER = listOf(
        "Subuh" to "fajr",
        "Syuruk" to "syuruk",
        "Zohor" to "dhuhr",
        "Asar" to "asr",
        "Maghrib" to "maghrib",
        "Isyak" to "isha",
    )

    data class Next(val name: String, val msLeft: Long)

    fun zone(prefs: SharedPreferences): String =
        prefs.getString(KEY_ZONE, DEFAULT_ZONE) ?: DEFAULT_ZONE

    fun isValidZone(code: String): Boolean = Regex("[A-Z]{3}[0-9]{2}").matches(code)

    /** Dipanggil di thread latar. Pulangkan null jika tiada data (contoh: tiada internet). */
    fun loadDay(context: Context, zone: String, day: Calendar): List<Pair<String, Calendar>>? {
        return try {
            val prefs = context.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            val month = String.format(Locale.US, "%04d%02d", day.get(Calendar.YEAR), day.get(Calendar.MONTH) + 1)
            val key = "cache_${zone}_$month"
            val cached = prefs.getString(key, null)
            val raw = cached ?: fetchMonth(zone) ?: return null
            val array = JSONObject(raw).optJSONArray("prayerTime") ?: return null
            if (cached == null) prefs.edit().putString(key, raw).apply()
            timesFor(array, day)
        } catch (e: Exception) {
            null
        }
    }

    /** Waktu seterusnya (tidak termasuk Syuruk). Selepas Isyak, pulang Subuh esok. */
    fun next(times: List<Pair<String, Calendar>>, nowMs: Long): Next? {
        for ((name, t) in times) {
            if (name == "Syuruk") continue
            if (t.timeInMillis > nowMs) return Next(name, t.timeInMillis - nowMs)
        }
        val subuh = times.firstOrNull { it.first == "Subuh" }?.second ?: return null
        return Next("Subuh", subuh.timeInMillis + DAY_MS - nowMs)
    }

    fun countdown(ms: Long): String {
        val mins = ms / 60_000
        val h = mins / 60
        val m = mins % 60
        return when {
            h > 0 -> "${h}j ${m}m"
            m > 0 -> "${m}m"
            else -> "< 1m"
        }
    }

    private fun fetchMonth(zone: String): String? {
        val conn = URL("https://www.e-solat.gov.my/index.php?r=esolatApi/takwimsolat&period=month&zone=$zone")
            .openConnection() as HttpURLConnection
        return try {
            conn.connectTimeout = 10_000
            conn.readTimeout = 10_000
            if (conn.responseCode != 200) {
                null
            } else {
                conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            }
        } catch (e: Exception) {
            null
        } finally {
            conn.disconnect()
        }
    }

    private fun timesFor(array: JSONArray, day: Calendar): List<Pair<String, Calendar>>? {
        val fmt = SimpleDateFormat("dd-MMM-yyyy", Locale.ENGLISH)
        for (i in 0 until array.length()) {
            val entry = array.optJSONObject(i) ?: continue
            val parsed: Date = parseDate(fmt, entry.optString("date")) ?: continue
            val c = Calendar.getInstance().apply { time = parsed }
            if (c.get(Calendar.YEAR) != day.get(Calendar.YEAR) ||
                c.get(Calendar.DAY_OF_YEAR) != day.get(Calendar.DAY_OF_YEAR)
            ) continue

            val result = ORDER.map { (label, key) -> clockOn(entry.optString(key), day)?.let { label to it } }
            return if (result.any { it == null }) null else result.filterNotNull()
        }
        return null
    }

    private fun parseDate(fmt: SimpleDateFormat, s: String): Date? =
        try {
            fmt.parse(s)
        } catch (e: Exception) {
            null
        }

    // "HH:mm" atau "HH:mm:ss" -> Calendar pada hari yang sama
    private fun clockOn(hhmm: String, day: Calendar): Calendar? {
        val parts = hhmm.split(":")
        val h = parts.getOrNull(0)?.toIntOrNull() ?: return null
        val m = parts.getOrNull(1)?.toIntOrNull() ?: return null
        return (day.clone() as Calendar).apply {
            set(Calendar.HOUR_OF_DAY, h)
            set(Calendar.MINUTE, m)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
    }
}
