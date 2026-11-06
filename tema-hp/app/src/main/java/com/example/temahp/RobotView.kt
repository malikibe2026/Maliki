package com.example.temahp

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.view.View

/** Robot kecil bernama HUMAIRA: kepala dengan paparan muka gelap, mata berkelip, dan antena bercahaya. */
class RobotView(context: Context) : View(context) {

    private val d = context.resources.displayMetrics.density
    private var blinkUntil = 0L

    private val ink = Color.rgb(42, 10, 15)
    private val coral = Color.rgb(255, 112, 92)
    private val cream = Color.rgb(255, 246, 238)
    private val peach = Color.rgb(255, 205, 186)

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
    }
    private val glow = Paint(Paint.ANTI_ALIAS_FLAG)

    /** Mata tertutup selama kira-kira 160 ms. */
    fun blink() {
        blinkUntil = System.currentTimeMillis() + 160L
        invalidate()
        postDelayed({ invalidate() }, 180L)
    }

    /** Robot bergerak naik turun perlahan. */
    fun bob(tick: Int) {
        translationY = (Math.sin(tick * 0.6) * 4 * d).toFloat()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val w = width.toFloat()
        val h = height.toFloat()
        if (w <= 0f || h <= 0f) return
        val cx = w / 2f

        val headW = w * 0.74f
        val headH = h * 0.56f
        val head = RectF(cx - headW / 2, h * 0.20f, cx + headW / 2, h * 0.20f + headH)

        // Antena dengan cahaya coral
        val antTop = h * 0.04f
        line.color = peach
        line.strokeWidth = 3 * d
        canvas.drawLine(cx, head.top, cx, antTop, line)
        glow.color = Color.argb(70, 255, 112, 92)
        canvas.drawCircle(cx, antTop, 11 * d, glow)
        glow.color = coral
        canvas.drawCircle(cx, antTop, 5.5f * d, glow)

        // Telinga
        fill.color = peach
        val earH = headH * 0.36f
        val earW = 7 * d
        canvas.drawRoundRect(
            RectF(head.left - earW, head.centerY() - earH / 2, head.left + 4 * d, head.centerY() + earH / 2),
            4 * d, 4 * d, fill,
        )
        canvas.drawRoundRect(
            RectF(head.right - 4 * d, head.centerY() - earH / 2, head.right + earW, head.centerY() + earH / 2),
            4 * d, 4 * d, fill,
        )

        // Kepala: gradien krim ke peach
        fill.shader = LinearGradient(0f, head.top, 0f, head.bottom, cream, peach, Shader.TileMode.CLAMP)
        canvas.drawRoundRect(head, 28 * d, 28 * d, fill)
        fill.shader = null

        // Paparan muka gelap
        val face = RectF(head.left + 10 * d, head.top + 10 * d, head.right - 10 * d, head.bottom - 10 * d)
        val faceW = face.width()
        val faceH = face.height()
        fill.color = ink
        canvas.drawRoundRect(face, 20 * d, 20 * d, fill)

        // Mata: pil krim, atau garis lurus bila berkelip
        val eyeW = faceW * 0.19f
        val eyeH = faceH * 0.36f
        val eyeY = face.centerY() - faceH * 0.12f
        val blinking = System.currentTimeMillis() < blinkUntil
        for (ex in listOf(cx - faceW * 0.22f, cx + faceW * 0.22f)) {
            if (blinking) {
                line.color = cream
                line.strokeWidth = 5 * d
                canvas.drawLine(ex - eyeW / 2, eyeY, ex + eyeW / 2, eyeY, line)
            } else {
                fill.color = cream
                canvas.drawRoundRect(
                    RectF(ex - eyeW / 2, eyeY - eyeH / 2, ex + eyeW / 2, eyeY + eyeH / 2),
                    eyeW / 2, eyeW / 2, fill,
                )
            }
        }

        // Senyuman
        val mouthW = faceW * 0.3f
        val mouthTop = face.bottom - faceH * 0.28f
        line.color = coral
        line.strokeWidth = 4 * d
        canvas.drawArc(
            RectF(cx - mouthW / 2, mouthTop, cx + mouthW / 2, mouthTop + faceH * 0.2f),
            20f, 140f, false, line,
        )

        // Badan
        val bodyW = headW * 0.56f
        val bodyTop = head.bottom + 4 * d
        val body = RectF(cx - bodyW / 2, bodyTop, cx + bodyW / 2, h - 2 * d)
        fill.shader = LinearGradient(0f, body.top, 0f, body.bottom, peach, coral, Shader.TileMode.CLAMP)
        canvas.drawRoundRect(body, 18 * d, 18 * d, fill)
        fill.shader = null
    }
}
