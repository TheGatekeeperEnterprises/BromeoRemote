package com.bromeoremotemobile

import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.PixelCopy
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.UIManagerHelper
import java.io.ByteArrayOutputStream

/**
 * Captures a still frame from RTCView's underlying SurfaceView using
 * PixelCopy — the only Android API that correctly reads SurfaceView
 * content. A standard View.draw()-based snapshot (e.g. react-native-
 * view-shot) produces a black image for SurfaceView-backed views like
 * RTCView — this is a confirmed, well-documented limitation (the
 * react-native-webrtc maintainer's own answer: "It's not possible"),
 * not something fixable at the JS level.
 *
 * RTCView (react-native-webrtc) is a plain ViewGroup wrapping a
 * SurfaceViewRenderer somewhere in its children (see WebRTCView.java in
 * react-native-webrtc's source) — findSurfaceView() walks the tree to
 * reach it without needing to fork or patch that library.
 *
 * UIManagerHelper.getUIManagerForReactTag() is the architecture-agnostic
 * way to resolve a native view from a React tag — works whether Fabric
 * (New Architecture, enabled in this app) or the legacy renderer is active.
 */
class AiBuddyScreenshotModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "AiBuddyScreenshotModule"

    @ReactMethod
    fun captureView(viewTag: Int, promise: Promise) {
        val mainHandler = Handler(Looper.getMainLooper())
        mainHandler.post {
            try {
                val uiManager = UIManagerHelper.getUIManagerForReactTag(reactApplicationContext, viewTag)
                val view = uiManager?.resolveView(viewTag)
                if (view == null) {
                    promise.reject("NO_VIEW", "Kon de RTCView niet vinden.")
                    return@post
                }
                val surfaceView = findSurfaceView(view)
                if (surfaceView == null) {
                    promise.reject("NO_SURFACE", "Geen SurfaceView gevonden in deze view.")
                    return@post
                }
                if (surfaceView.width <= 0 || surfaceView.height <= 0) {
                    promise.reject("NOT_READY", "Er is nog geen beeld om vast te leggen.")
                    return@post
                }
                val bitmap = Bitmap.createBitmap(surfaceView.width, surfaceView.height, Bitmap.Config.ARGB_8888)
                PixelCopy.request(
                    surfaceView,
                    bitmap,
                    { result ->
                        if (result == PixelCopy.SUCCESS) {
                            val out = ByteArrayOutputStream()
                            bitmap.compress(Bitmap.CompressFormat.JPEG, 85, out)
                            val base64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
                            promise.resolve("data:image/jpeg;base64,$base64")
                        } else {
                            promise.reject("COPY_FAILED", "PixelCopy mislukt (code $result).")
                        }
                    },
                    mainHandler
                )
            } catch (e: Exception) {
                promise.reject("CAPTURE_ERROR", e.message, e)
            }
        }
    }

    private fun findSurfaceView(root: View): SurfaceView? {
        if (root is SurfaceView) return root
        if (root is ViewGroup) {
            for (i in 0 until root.childCount) {
                val found = findSurfaceView(root.getChildAt(i))
                if (found != null) return found
            }
        }
        return null
    }
}
