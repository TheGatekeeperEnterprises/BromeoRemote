package com.bromeoremotemobile

import android.content.Context
import android.provider.Settings
import android.view.KeyEvent
import android.view.inputmethod.InputMethodManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise

class VirtualKeyboardModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "VirtualKeyboardModule"
    }

    @ReactMethod
    fun commitText(text: String) {
        BromeoRemoteKeyboardService.commitText(text)
    }

    @ReactMethod
    fun sendKeyEvent(keyCode: Int) {
        BromeoRemoteKeyboardService.sendKeyEvent(keyCode)
    }

    @ReactMethod
    fun deleteSurroundingText(before: Int, after: Int) {
        BromeoRemoteKeyboardService.deleteSurroundingText(before, after)
    }

    @ReactMethod
    fun isKeyboardEnabled(promise: Promise) {
        val imm = reactApplicationContext.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        val list = imm.enabledInputMethodList
        val myPackageName = reactApplicationContext.packageName
        
        var isEnabled = false
        for (imi in list) {
            if (imi.packageName == myPackageName) {
                isEnabled = true
                break
            }
        }
        promise.resolve(isEnabled)
    }

    @ReactMethod
    fun isKeyboardActive(promise: Promise) {
        val defaultIme = Settings.Secure.getString(reactApplicationContext.contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD)
        promise.resolve(defaultIme != null && defaultIme.contains(reactApplicationContext.packageName))
    }

    @ReactMethod
    fun openKeyboardSettings() {
        val intent = android.content.Intent(Settings.ACTION_INPUT_METHOD_SETTINGS)
        intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        reactApplicationContext.startActivity(intent)
    }
}
