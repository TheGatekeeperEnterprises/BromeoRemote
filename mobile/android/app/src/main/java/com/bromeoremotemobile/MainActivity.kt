package com.bromeoremotemobile

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.oney.WebRTCModule.WebRTCModuleOptions

class MainActivity : ReactActivity() {

  // Swap the LaunchTheme (splash windowBackground, set in AndroidManifest.xml)
  // back to the normal AppTheme now that the window exists — the splash stays
  // visible until this activity's first frame draws.
  override fun onCreate(savedInstanceState: android.os.Bundle?) {
    setTheme(R.style.AppTheme)
    val options = WebRTCModuleOptions.getInstance()
    options.enableMediaProjectionService = true
    super.onCreate(null)
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "BromeoRemoteMobile"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
