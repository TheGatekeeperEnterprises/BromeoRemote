package com.bromeoremotemobile

import android.inputmethodservice.InputMethodService
import android.view.KeyEvent
import android.view.View
import android.widget.LinearLayout

class BromeoRemoteKeyboardService : InputMethodService() {

    companion object {
        var instance: BromeoRemoteKeyboardService? = null
        
        fun commitText(text: String) {
            instance?.currentInputConnection?.commitText(text, 1)
        }
        
        fun sendKeyEvent(keyEventCode: Int) {
            instance?.currentInputConnection?.sendKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, keyEventCode))
            instance?.currentInputConnection?.sendKeyEvent(KeyEvent(KeyEvent.ACTION_UP, keyEventCode))
        }

        fun deleteSurroundingText(before: Int, after: Int) {
            instance?.currentInputConnection?.deleteSurroundingText(before, after)
        }
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    override fun onDestroy() {
        super.onDestroy()
        if (instance == this) {
            instance = null
        }
    }

    // Prevents an actual physical keyboard UI from rendering on the screen
    // We just want an invisible background service that receives our PC events
    override fun onCreateInputView(): View {
        val view = LinearLayout(this)
        view.layoutParams = LinearLayout.LayoutParams(0, 0)
        return view
    }
}
