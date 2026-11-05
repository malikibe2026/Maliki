package com.example.temahp

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.os.BatteryManager
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.StatFs
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView
import android.widget.Toast
import java.util.Calendar
import java.util.Locale

class MainActivity : Activity() {

    private class AppEntry(val label: String, val pkg: String, val icon: Drawable)

    private class Cell(val key: String, val box: LinearLayout, val name: TextView, val time: TextView) {
        var active: Boolean? = null
    }

    private class Stat(val card: LinearLayout, val value: TextView, val bar: LinearLayout)

    // ---------- Palet warna ----------
    private val redTop = Color.rgb(211, 47, 47)      // merah terang
    private val redMid = Color.rgb(150, 18, 24)      // merah delima
    private val redBottom = Color.rgb(45, 6, 10)     // merah hampir hitam
    private val glass = Color.argb(36, 255, 255, 255)
    private val glassStroke = Color.argb(56, 255, 255, 255)
    private val deepRed = Color.rgb(140, 16, 20)
    private val mint = Color.rgb(184, 242, 208)   // hijau muda premium

    private val prayerNames = listOf("Subuh", "Syuruk", "Zohor", "Asar", "Maghrib", "Isyak")

    private val handler = Handler(Looper.getMainLooper())
    private val prefs by lazy { getSharedPreferences(PrayerTimes.PREF, MODE_PRIVATE) }

    private val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
    private val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT

    private lateinit var robot: RobotView
    private lateinit var weatherTempView: TextView
    private lateinit var weatherDescView: TextView
    private lateinit var weatherMetaView: TextView
    private var weatherLoading = false
    private var weatherOk = false
    private var lastWeatherAttempt = 0L
    private lateinit var greetingView: TextView
    private lateinit var clockView: TextView
    private lateinit var dateView: TextView
    private lateinit var nextNameView: TextView
    private lateinit var countdownView: TextView
    private lateinit var statusView: TextView
    private lateinit var cells: List<Cell>
    private lateinit var battery: Stat
    private lateinit var storage: Stat
    private lateinit var searchBox: EditText
    private lateinit var appList: ListView

    private var allApps: List<AppEntry> = emptyList()
    private val shownApps = mutableListOf<AppEntry>()
    private val appAdapter = AppAdapter()

    private var today: List<Pair<String, Calendar>>? = null
    private var loadedDay = -1
    private var lastAttempt = 0L
    private var loading = false
    private var tick = 0

    private val ticker = object : Runnable {
        override fun run() {
            val now = Calendar.getInstance()
            updateClock(now)
            updatePrayerCard(now)
            robot.bob(tick)
            if (tick % 4 == 0) robot.blink()
            val weatherDue = System.currentTimeMillis() - lastWeatherAttempt > (if (weatherOk) 30 else 5) * 60 * 1000L
            if (weatherDue && !weatherLoading) loadWeather()
            if (tick % 30 == 0) {
                updateBattery()
                updateStorage()
            }
            val dayChanged = dayKey(now) != loadedDay
            val retryDue = today == null && System.currentTimeMillis() - lastAttempt > 5 * 60 * 1000L
            if ((dayChanged || retryDue) && !loading) loadPrayer()
            tick++
            handler.postDelayed(this, 1000L)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = redTop
        window.navigationBarColor = redBottom
        setContentView(buildUi())
        renderWeather(Weather.cached(this))
        loadPrayer()
    }

    override fun onResume() {
        super.onResume()
        handler.post(ticker)
        loadApps()
    }

    override fun onPause() {
        handler.removeCallbacks(ticker)
        super.onPause()
    }

    // Sebagai Home app, Back tidak keluar. Jika dibuka dari ikon biasa, Back kembali ke launcher lama.
    override fun onBackPressed() {
        if (isDefaultHome()) return
        super.onBackPressed()
    }

    private fun isDefaultHome(): Boolean {
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        val resolved = packageManager.resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY)
        return resolved?.activityInfo?.packageName == packageName
    }

    // ---------- UI ----------
    private fun buildUi(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(redTop, redMid, redBottom),
            )
            setPadding(dp(20), dp(28), dp(20), dp(12))
        }

        // Robot HUMAIRA
        robot = RobotView(this)
        root.addView(robot, LinearLayout.LayoutParams(dp(120), dp(120)).apply {
            gravity = Gravity.CENTER_HORIZONTAL
        })
        val nameTag = label(12f, font = "sans-serif-medium").apply {
            text = "HUMAIRA"
            letterSpacing = 0.3f
            gravity = Gravity.CENTER
            background = rounded(Color.argb(60, 255, 255, 255), 12)
            setPadding(dp(12), dp(4), dp(12), dp(4))
        }
        root.addView(nameTag, lp(WRAP, WRAP, top = dp(4)).apply { gravity = Gravity.CENTER_HORIZONTAL })
        greetingView = label(13f, font = "sans-serif-light", alpha = 0.9f).apply {
            gravity = Gravity.CENTER_HORIZONTAL
        }
        root.addView(greetingView, lp(MATCH, WRAP, top = dp(6)))

        // Jam besar
        clockView = label(78f, font = "sans-serif-thin").apply {
            gravity = Gravity.CENTER_HORIZONTAL
            letterSpacing = 0.02f
        }
        dateView = label(12f, font = "sans-serif-medium", alpha = 0.85f).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            letterSpacing = 0.18f
        }
        root.addView(clockView, lp(MATCH, WRAP))
        root.addView(dateView, lp(MATCH, WRAP, top = dp(4)))

        root.addView(buildPrayerCard(), lp(MATCH, WRAP, top = dp(24)))
        root.addView(buildWeatherCard(), lp(MATCH, WRAP, top = dp(12)))

        // Bateri dan storan
        battery = statCard("BATERI")
        storage = statCard("STORAN KOSONG")
        val infoRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        infoRow.addView(battery.card, lp(0, WRAP, weight = 1f).apply { rightMargin = dp(6) })
        infoRow.addView(storage.card, lp(0, WRAP, weight = 1f).apply { leftMargin = dp(6) })
        root.addView(infoRow, lp(MATCH, WRAP, top = dp(12)))

        // Carian aplikasi
        searchBox = EditText(this).apply {
            hint = "Cari aplikasi…"
            setHintTextColor(Color.argb(160, 255, 255, 255))
            setTextColor(Color.WHITE)
            textSize = 15f
            typeface = Typeface.create("sans-serif-light", Typeface.NORMAL)
            setSingleLine(true)
            inputType = InputType.TYPE_CLASS_TEXT
            background = rounded(glass, 24, glassStroke)
            setPadding(dp(20), dp(12), dp(20), dp(12))
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = filterApps()
                override fun afterTextChanged(s: Editable?) {}
            })
        }
        root.addView(searchBox, lp(MATCH, WRAP, top = dp(16)))

        appList = ListView(this).apply {
            adapter = appAdapter
            setDivider(null)
            isVerticalScrollBarEnabled = false
            setOnItemClickListener { _, _, position, _ -> launch(shownApps[position].pkg) }
        }
        root.addView(appList, lp(MATCH, 0, top = dp(8), weight = 1f))

        return root
    }

    private fun buildPrayerCard(): View {
        val card = glassCard().apply {
            setOnLongClickListener {
                askZone()
                true
            }
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val left = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        left.addView(label(10f, font = "sans-serif-medium", alpha = 0.7f).apply {
            text = "WAKTU SETERUSNYA"
            letterSpacing = 0.2f
        })
        nextNameView = label(28f, font = "sans-serif-light")
        left.addView(nextNameView, lp(WRAP, WRAP, top = dp(4)))
        header.addView(left, lp(0, WRAP, weight = 1f))

        countdownView = label(13f, font = "sans-serif-medium").apply {
            background = rounded(Color.argb(60, 255, 255, 255), 16)
            setPadding(dp(12), dp(6), dp(12), dp(6))
        }
        header.addView(countdownView)
        card.addView(header)

        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        cells = prayerNames.map { key ->
            val box = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                setPadding(0, dp(8), 0, dp(8))
            }
            val name = label(10f, font = "sans-serif-medium", alpha = 0.75f).apply {
                text = key
                gravity = Gravity.CENTER
            }
            val time = label(14f).apply {
                text = "--:--"
                gravity = Gravity.CENTER
            }
            box.addView(name, lp(MATCH, WRAP))
            box.addView(time, lp(MATCH, WRAP, top = dp(4)))
            row.addView(box, lp(0, WRAP, weight = 1f).apply {
                leftMargin = dp(2)
                rightMargin = dp(2)
            })
            Cell(key, box, name, time)
        }
        card.addView(row, lp(MATCH, WRAP, top = dp(14)))

        statusView = label(10f, alpha = 0.55f)
        card.addView(statusView, lp(MATCH, WRAP, top = dp(10)))
        return card
    }

    private fun statCard(title: String): Stat {
        val card = glassCard()
        card.addView(label(10f, font = "sans-serif-medium", alpha = 0.7f).apply {
            text = title
            letterSpacing = 0.2f
        })
        val value = label(22f, font = "sans-serif-light").apply { text = "--" }
        card.addView(value, lp(MATCH, WRAP, top = dp(4)))

        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            background = rounded(Color.argb(50, 255, 255, 255), 3)
            addView(View(this@MainActivity).apply { background = rounded(mint, 3) },
                LinearLayout.LayoutParams(0, MATCH, 0f))
            addView(View(this@MainActivity), LinearLayout.LayoutParams(0, MATCH, 100f))
        }
        card.addView(bar, lp(MATCH, dp(5), top = dp(10)))
        return Stat(card, value, bar)
    }

    private fun setBar(bar: LinearLayout, pct: Int) {
        val p = pct.coerceIn(0, 100)
        (bar.getChildAt(0).layoutParams as LinearLayout.LayoutParams).weight = p.toFloat()
        (bar.getChildAt(1).layoutParams as LinearLayout.LayoutParams).weight = (100 - p).toFloat()
        bar.requestLayout()
    }

    private fun glassCard(mintAccent: Boolean = false): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        background = if (mintAccent) {
            rounded(Color.argb(40, 184, 242, 208), 20, Color.argb(120, 184, 242, 208))
        } else {
            rounded(glass, 20, glassStroke)
        }
        setPadding(dp(16), dp(14), dp(16), dp(14))
    }

    private fun label(size: Float, font: String = "sans-serif", alpha: Float = 1f): TextView =
        TextView(this).apply {
            textSize = size
            setTextColor(Color.WHITE)
            this.alpha = alpha
            typeface = Typeface.create(font, Typeface.NORMAL)
            includeFontPadding = false
        }

    private fun rounded(color: Int, radiusDp: Int, stroke: Int? = null): GradientDrawable =
        GradientDrawable().apply {
            setColor(color)
            cornerRadius = dp(radiusDp).toFloat()
            if (stroke != null) setStroke(dp(1), stroke)
        }

    private fun lp(w: Int, h: Int, top: Int = 0, weight: Float = 0f): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(w, h, weight).apply { topMargin = top }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun hhmm(c: Calendar): String =
        String.format(Locale.US, "%02d:%02d", c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE))

    // ---------- Jam dan tarikh ----------
    private fun updateClock(now: Calendar) {
        clockView.text = hhmm(now)
        val hour = now.get(Calendar.HOUR_OF_DAY)
        val salam = when {
            hour < 11 -> "Selamat pagi"
            hour < 15 -> "Selamat tengah hari"
            hour < 19 -> "Selamat petang"
            else -> "Selamat malam"
        }
        greetingView.text = "$salam, Humaira"
        val days = arrayOf("Ahad", "Isnin", "Selasa", "Rabu", "Khamis", "Jumaat", "Sabtu")
        val months = arrayOf(
            "Januari", "Februari", "Mac", "April", "Mei", "Jun",
            "Julai", "Ogos", "September", "Oktober", "November", "Disember",
        )
        dateView.text = ("${days[now.get(Calendar.DAY_OF_WEEK) - 1]}, " +
            "${now.get(Calendar.DAY_OF_MONTH)} ${months[now.get(Calendar.MONTH)]} ${now.get(Calendar.YEAR)}")
            .uppercase(Locale.getDefault())
    }

    private fun dayKey(c: Calendar): Int = c.get(Calendar.YEAR) * 1000 + c.get(Calendar.DAY_OF_YEAR)

    // ---------- Waktu solat ----------
    private fun loadPrayer() {
        loading = true
        lastAttempt = System.currentTimeMillis()
        val zone = PrayerTimes.zone(prefs)
        val appContext = applicationContext
        Thread {
            val now = Calendar.getInstance()
            val result = PrayerTimes.loadDay(appContext, zone, now)
            runOnUiThread {
                today = result
                loadedDay = dayKey(now)
                loading = false
                updatePrayerCard(Calendar.getInstance())
            }
        }.start()
    }

    private fun updatePrayerCard(now: Calendar) {
        val times = today
        if (times == null) {
            nextNameView.text = if (loading) "Memuatkan…" else "Tiada data"
            countdownView.visibility = View.GONE
            cells.forEach {
                it.time.text = "--:--"
                styleCell(it, false)
            }
            statusView.text = if (loading) {
                "Mengambil waktu solat dari JAKIM"
            } else {
                "Tiada sambungan ke JAKIM. Tahan kad untuk tukar zon."
            }
            return
        }

        val next = PrayerTimes.next(times, now.timeInMillis)
        if (next == null) {
            nextNameView.text = ""
            countdownView.visibility = View.GONE
        } else {
            val at = times.firstOrNull { it.first == next.name }?.second
            nextNameView.text = if (at != null) "${next.name}  ${hhmm(at)}" else next.name
            countdownView.text = "dalam ${PrayerTimes.countdown(next.msLeft)}"
            countdownView.visibility = View.VISIBLE
        }
        cells.forEach { cell ->
            val t = times.firstOrNull { it.first == cell.key }?.second
            cell.time.text = if (t == null) "--:--" else hhmm(t)
            styleCell(cell, next != null && cell.key == next.name)
        }
        statusView.text = "Zon ${PrayerTimes.zone(prefs)} · JAKIM e-Solat · tahan kad untuk tukar zon"
    }

    // Waktu seterusnya ditonjolkan dengan latar putih
    private fun styleCell(cell: Cell, active: Boolean) {
        if (cell.active == active) return
        cell.active = active
        if (active) {
            cell.box.background = rounded(mint, 12)
            cell.name.setTextColor(deepRed)
            cell.time.setTextColor(deepRed)
            cell.name.alpha = 1f
            cell.time.typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        } else {
            cell.box.background = null
            cell.name.setTextColor(Color.WHITE)
            cell.time.setTextColor(Color.WHITE)
            cell.name.alpha = 0.75f
            cell.time.typeface = Typeface.create("sans-serif", Typeface.NORMAL)
        }
    }

    private fun askZone() {
        val input = EditText(this).apply {
            setText(PrayerTimes.zone(prefs))
            hint = "cth. SGR01"
            setSingleLine(true)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
        }
        AlertDialog.Builder(this)
            .setTitle("Kod zon JAKIM")
            .setMessage("Cari kod zon anda di e-solat.gov.my")
            .setView(input)
            .setPositiveButton("Simpan") { _, _ ->
                val code = input.text.toString().trim().uppercase(Locale.US)
                if (PrayerTimes.isValidZone(code)) {
                    prefs.edit().putString(PrayerTimes.KEY_ZONE, code).apply()
                    today = null
                    loadedDay = -1
                    loadPrayer()
                } else {
                    Toast.makeText(this, "Kod zon tidak sah (contoh: SGR01)", Toast.LENGTH_LONG).show()
                }
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    // ---------- Cuaca ----------
    private fun buildWeatherCard(): View {
        val card = glassCard(mintAccent = true).apply {
            setOnLongClickListener {
                askCoords()
                true
            }
        }
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val left = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        left.addView(label(10f, font = "sans-serif-medium", alpha = 0.75f).apply {
            text = "CUACA"
            letterSpacing = 0.2f
            setTextColor(mint)
        })
        weatherDescView = label(16f, font = "sans-serif-light")
        left.addView(weatherDescView, lp(MATCH, WRAP, top = dp(4)))
        weatherMetaView = label(11f, alpha = 0.6f)
        left.addView(weatherMetaView, lp(MATCH, WRAP, top = dp(2)))
        row.addView(left, lp(0, WRAP, weight = 1f))

        weatherTempView = label(42f, font = "sans-serif-thin").apply {
            text = "--°C"
            setTextColor(mint)
        }
        row.addView(weatherTempView)
        card.addView(row)
        return card
    }

    private fun renderWeather(now: Weather.Now?) {
        if (now == null) {
            weatherTempView.text = "--°C"
            weatherDescView.text = if (weatherLoading) "Memuatkan cuaca…" else "Tiada data cuaca"
            weatherMetaView.text = "Tahan kad untuk tukar lokasi"
            return
        }
        weatherTempView.text = "${Math.round(now.temp)}°C"
        weatherDescView.text = Weather.describe(now.code)
        weatherMetaView.text = "Kelembapan ${now.humidity}% · tahan kad untuk tukar lokasi"
    }

    private fun loadWeather() {
        weatherLoading = true
        lastWeatherAttempt = System.currentTimeMillis()
        val appContext = applicationContext
        Thread {
            val (lat, lon) = Weather.coords(appContext)
            val fresh = Weather.fetch(lat, lon)
            if (fresh != null) Weather.save(appContext, fresh)
            val shown = fresh ?: Weather.cached(appContext)
            runOnUiThread {
                weatherLoading = false
                weatherOk = fresh != null
                renderWeather(shown)
            }
        }.start()
    }

    private fun askCoords() {
        val (lat, lon) = Weather.coords(this)
        val input = EditText(this).apply {
            setText("$lat,$lon")
            hint = "lat,lon cth. 3.0733,101.5185"
            setSingleLine(true)
            inputType = InputType.TYPE_CLASS_TEXT
        }
        AlertDialog.Builder(this)
            .setTitle("Lokasi cuaca")
            .setMessage("Masukkan latitud dan longitud, dipisahkan dengan koma")
            .setView(input)
            .setPositiveButton("Simpan") { _, _ ->
                val parsed = Weather.parseCoords(input.text.toString())
                if (parsed != null) {
                    Weather.setCoords(this, parsed.first, parsed.second)
                    lastWeatherAttempt = 0L
                    loadWeather()
                } else {
                    Toast.makeText(this, "Format tidak sah (contoh: 3.0733,101.5185)", Toast.LENGTH_LONG).show()
                }
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    // ---------- Bateri dan storan ----------
    private fun updateBattery() {
        val i = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = i?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = i?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val status = i?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val charging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
            status == BatteryManager.BATTERY_STATUS_FULL
        if (level >= 0 && scale > 0) {
            val pct = level * 100 / scale
            battery.value.text = "$pct%" + if (charging) "  ⚡" else ""
            setBar(battery.bar, pct)
        } else {
            battery.value.text = "--"
            setBar(battery.bar, 0)
        }
    }

    private fun updateStorage() {
        val stat = StatFs(Environment.getDataDirectory().path)
        val free = stat.availableBytes
        val total = stat.totalBytes
        storage.value.text = gb(free)
        val usedPct = if (total > 0) ((total - free) * 100 / total).toInt() else 0
        setBar(storage.bar, usedPct)
    }

    private fun gb(bytes: Long): String = String.format(Locale.US, "%.1f GB", bytes / 1073741824.0)

    // ---------- Aplikasi ----------
    private fun loadApps() {
        Thread {
            val pm = packageManager
            val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            val apps = pm.queryIntentActivities(intent, 0)
                .filter { it.activityInfo.packageName != packageName }
                .map { AppEntry(it.loadLabel(pm).toString(), it.activityInfo.packageName, it.loadIcon(pm)) }
                .distinctBy { it.pkg }
                .sortedBy { it.label.lowercase(Locale.getDefault()) }
            runOnUiThread {
                allApps = apps
                filterApps()
            }
        }.start()
    }

    private fun filterApps() {
        val q = searchBox.text.toString().trim().lowercase(Locale.getDefault())
        shownApps.clear()
        shownApps.addAll(
            if (q.isEmpty()) allApps
            else allApps.filter { it.label.lowercase(Locale.getDefault()).contains(q) }
        )
        appAdapter.notifyDataSetChanged()
    }

    private fun launch(pkg: String) {
        packageManager.getLaunchIntentForPackage(pkg)?.let { startActivity(it) }
    }

    private inner class AppAdapter : BaseAdapter() {
        override fun getCount(): Int = shownApps.size

        override fun getItem(position: Int): Any = shownApps[position]

        override fun getItemId(position: Int): Long = position.toLong()

        override fun getView(position: Int, convertView: View?, parent: ViewGroup?): View {
            val row = (convertView as? LinearLayout) ?: LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(6), dp(10), dp(6), dp(10))
                addView(ImageView(this@MainActivity), LinearLayout.LayoutParams(dp(40), dp(40)))
                addView(
                    label(15f, font = "sans-serif-light"),
                    LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(16) },
                )
            }
            val app = shownApps[position]
            (row.getChildAt(0) as ImageView).setImageDrawable(app.icon)
            (row.getChildAt(1) as TextView).text = app.label
            return row
        }
    }
}
