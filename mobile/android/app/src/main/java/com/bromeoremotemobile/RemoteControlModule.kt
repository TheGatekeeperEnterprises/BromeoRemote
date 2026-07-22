package com.bromeoremotemobile

import android.content.Intent
import android.provider.Settings
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap

/**
 * JS-facing bridge for RemoteControlAccessibilityService. All methods are
 * fire-and-forget except isEnabled — dispatchGesture() failures (e.g. the
 * service not actually enabled) aren't surfaced back to the WebRTC control
 * channel, which has no meaningful way to report per-gesture failure anyway.
 */
class RemoteControlModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "RemoteControlModule"

    @ReactMethod
    fun isEnabled(promise: com.facebook.react.bridge.Promise) {
        val context = reactApplicationContext
        val expectedComponent = "${context.packageName}/${RemoteControlAccessibilityService::class.java.name}"
        val enabledServices = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        )
        val enabled = enabledServices != null && enabledServices.split(":").any { it.equals(expectedComponent, ignoreCase = true) }
        promise.resolve(enabled)
    }

    @ReactMethod
    fun openSettings() {
        val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        reactApplicationContext.startActivity(intent)
    }

    @ReactMethod
    fun tap(xPct: Double, yPct: Double) {
        RemoteControlAccessibilityService.instance?.tap(xPct, yPct)
    }

    @ReactMethod
    fun longPress(xPct: Double, yPct: Double) {
        RemoteControlAccessibilityService.instance?.longPress(xPct, yPct)
    }

    @ReactMethod
    fun swipePath(points: ReadableArray, durationMs: Double) {
        val parsed = mutableListOf<Pair<Double, Double>>()
        for (i in 0 until points.size()) {
            val point: ReadableMap = points.getMap(i) ?: continue
            parsed.add(Pair(point.getDouble("x"), point.getDouble("y")))
        }
        RemoteControlAccessibilityService.instance?.swipePath(parsed, durationMs.toLong())
    }

    @ReactMethod
    fun scroll(xPct: Double, yPct: Double, deltaXPct: Double, deltaYPct: Double) {
        RemoteControlAccessibilityService.instance?.scroll(xPct, yPct, deltaXPct, deltaYPct)
    }
}
