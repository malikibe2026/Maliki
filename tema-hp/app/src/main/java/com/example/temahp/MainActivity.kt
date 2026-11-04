package com.example.temahp

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.IntentFilter
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
import android.widget.AdapterView
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

    private val handler = Handler(Looper.getMainLooper())
    private val prefs by lazy { getSharedPreferences(PrayerTimes.PREF, MODE_PRIVATE) }

    private val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
    private val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT

    private lateinit var clockView: TextView
    private lateinit var dateView: TextView
    private lateinit var nextView: TextView
    private lateinit var listView: TextView
    private lateinit var statusView: TextView
    private lateinit var batteryView: TextView
    private lateinit var storageView: TextView
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
        setContentView(buildUi())
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

    // Launcher tidak keluar bila tekan Back
    override fun onBackPressed() {}

    // ---------- UI ----------
    private fun buildUi(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(14, 16, 22))
            setPadding(dp(16), dp(20), dp(16), dp(12))
        }

        clockView = text(52f, bold = true)
        dateView = text(14f, alpha = 0.7f)
        root.addView(clockView)
        root.addView(dateView)

        // Kad waktu solat: tahan lama untuk tukar zon
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = rounded(Color.rgb(30, 34, 44))
            setPadding(dp(14), dp(12), dp(14), dp(12))
            setOnLongClickListener {
                askZone()
                true
            }
        }
        nextView = text(18f, bold = true)
        listView = text(14f)
        statusView = text(11f, alpha = 0.5f)
        card.addView(nextView)
        card.addView(listView)
        card.addView(statusView)
        root.addView(card, lp(MATCH, WRAP, top = dp(12)))

        // Bateri dan storan
        val infoRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        batteryView = text(14f)
        storageView = text(14f)
        infoRow.addView(batteryView, lp(0, WRAP, weight = 1f))
        infoRow.addView(storageView, lp(0, WRAP, weight = 1f))
        root.addView(infoRow, lp(MATCH, WRAP, top = dp(12)))

        // Carian aplikasi
        searchBox = EditText(this).apply {
            hint = "Cari aplikasi"
            setHintTextColor(Color.GRAY)
            setTextColor(Color.WHITE)
            setSingleLine(true)
            inputType = InputType.TYPE_CLASS_TEXT
            background = rounded(Color.rgb(30, 34, 44))
            setPadding(dp(14), dp(12), dp(14), dp(12))
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = filterApps()
                override fun afterTextChanged(s: Editable?) {}
            })
        }
        root.addView(searchBox, lp(MATCH, WRAP, top = dp(12)))

        appList = ListView(this).apply {
            adapter = appAdapter
            setDivider(null)
            setOnItemClickListener { _, _, position, _ -> launch(shownApps[position].pkg) }
        }
        root.addView(appList, lp(MATCH, 0, top = dp(10), weight = 1f))

        return root
    }

    private fun text(size: Float, bold: Boolean = false, alpha: Float = 1f): TextView =
        TextView(this).apply {
            textSize = size
            setTextColor(Color.WHITE)
            this.alpha = alpha
            if (bold) setTypeface(Typeface.DEFAULT_BOLD)
        }

    private fun rounded(color: Int): GradientDrawable =
        GradientDrawable().apply {
            setColor(color)
            cornerRadius = dp(14).toFloat()
        }

    private fun lp(w: Int, h: Int, top: Int = 0, weight: Float = 0f): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(w, h, weight).apply { topMargin = top }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    // ---------- Jam dan tarikh ----------
    private fun updateClock(now: Calendar) {
        clockView.text = String.format(Locale.US, "%02d:%02d", now.get(Calendar.HOUR_OF_DAY), now.get(Calendar.MINUTE))
        val days = arrayOf("Ahad", "Isnin", "Selasa", "Rabu", "Khamis", "Jumaat", "Sabtu")
        val months = arrayOf(
            "Januari", "Februari", "Mac", "April", "Mei", "Jun",
            "Julai", "Ogos", "September", "Oktober", "November", "Disember",
        )
        dateView.text = "${days[now.get(Calendar.DAY_OF_WEEK) - 1]}, " +
            "${now.get(Calendar.DAY_OF_MONTH)} ${months[now.get(Calendar.MONTH)]} ${now.get(Calendar.YEAR)}"
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
            nextView.text = if (loading) "Memuatkan waktu solat..." else "Waktu solat tidak tersedia"
            listView.text = ""
            statusView.text = "Tiada sambungan ke JAKIM. Cuba semula sebentar lagi. Tahan kad untuk tukar zon."
            return
        }

        val next = PrayerTimes.next(times, now.timeInMillis)
        nextView.text = if (next == null) "" else "Seterusnya: ${next.name} dalam ${PrayerTimes.countdown(next.msLeft)}"
        listView.text = times.joinToString("\n") { (name, t) ->
            val mark = if (next != null && name == next.name) "▶ " else "   "
            val hhmm = String.format(Locale.US, "%02d:%02d", t.get(Calendar.HOUR_OF_DAY), t.get(Calendar.MINUTE))
            "$mark$name  $hhmm"
        }
        statusView.text = "Zon ${PrayerTimes.zone(prefs)} · JAKIM e-Solat · tahan kad untuk tukar zon"
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

    // ---------- Bateri dan storan ----------
    private fun updateBattery() {
        val i = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = i?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = i?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val status = i?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val charging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
            status == BatteryManager.BATTERY_STATUS_FULL
        batteryView.text = if (level >= 0 && scale > 0) {
            "Bateri ${level * 100 / scale}%" + if (charging) " (cas)" else ""
        } else {
            "Bateri --"
        }
    }

    private fun updateStorage() {
        val stat = StatFs(Environment.getDataDirectory().path)
        storageView.text = "Kosong ${gb(stat.availableBytes)} / ${gb(stat.totalBytes)}"
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
                setPadding(dp(8), dp(10), dp(8), dp(10))
                addView(ImageView(this@MainActivity), LinearLayout.LayoutParams(dp(36), dp(36)))
                addView(
                    TextView(this@MainActivity).apply {
                        textSize = 16f
                        setTextColor(Color.WHITE)
                    },
                    LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(14) },
                )
            }
            val app = shownApps[position]
            (row.getChildAt(0) as ImageView).setImageDrawable(app.icon)
            (row.getChildAt(1) as TextView).text = app.label
            return row
        }
    }
}
