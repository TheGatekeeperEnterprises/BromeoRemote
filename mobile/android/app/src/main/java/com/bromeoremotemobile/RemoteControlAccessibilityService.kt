package com.bromeoremotemobile

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.view.accessibility.AccessibilityEvent

/**
 * Dispatches synthetic touch gestures so a PC viewing this phone (see
 * mobile/src/session.ts's host role) can actually control it, not just watch.
 * A regular app cannot inject touches into other apps at all — Android's
 * AccessibilityService + dispatchGesture() is the standard, non-root
 * mechanism for this (same approach TeamViewer QuickSupport/AirDroid use).
 * Must be enabled manually by the user via Settings — see RemoteControlModule.
 */
class RemoteControlAccessibilityService : AccessibilityService() {

    companion object {
        // The bridge module calls into whichever instance is currently bound —
        // there is only ever one, but it doesn't exist until the user enables
        // the service in Settings, hence the nullable static reference.
        var instance: RemoteControlAccessibilityService? = null
            private set
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        instance = null
        return super.onUnbind(intent)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Intentionally ignored — this service only ever dispatches gestures,
        // it never reads screen content.
    }

    override fun onInterrupt() {}

    private fun screenPoint(xPct: Double, yPct: Double): Pair<Float, Float> {
        val metrics = resources.displayMetrics
        return Pair((xPct * metrics.widthPixels).toFloat(), (yPct * metrics.heightPixels).toFloat())
    }

    fun tap(xPct: Double, yPct: Double) {
        val (x, y) = screenPoint(xPct, yPct)
        val path = Path().apply { moveTo(x, y) }
        val stroke = GestureDescription.StrokeDescription(path, 0, 50)
        dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
    }

    fun longPress(xPct: Double, yPct: Double) {
        val (x, y) = screenPoint(xPct, yPct)
        val path = Path().apply { moveTo(x, y) }
        val stroke = GestureDescription.StrokeDescription(path, 0, 600)
        dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
    }

    /** points: list of (xPct, yPct) sampled during a mousedown→mousemove*→mouseup drag. */
    fun swipePath(points: List<Pair<Double, Double>>, durationMs: Long) {
        if (points.isEmpty()) return
        val path = Path()
        points.forEachIndexed { i, (xPct, yPct) ->
            val (x, y) = screenPoint(xPct, yPct)
            if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        val stroke = GestureDescription.StrokeDescription(path, 0, durationMs.coerceAtLeast(1))
        dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
    }

    /** Approximates a scroll wheel as a short swipe centered on the given point. */
    fun scroll(xPct: Double, yPct: Double, deltaXPct: Double, deltaYPct: Double) {
        val (x1, y1) = screenPoint(xPct, yPct)
        val (x2, y2) = screenPoint(xPct - deltaXPct, yPct - deltaYPct)
        val path = Path().apply {
            moveTo(x1, y1)
            lineTo(x2, y2)
        }
        val stroke = GestureDescription.StrokeDescription(path, 0, 120)
        dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
    }
}
