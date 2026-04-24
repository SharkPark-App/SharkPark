package com.mobile.carbluetooth

import android.bluetooth.BluetoothA2dp
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothHeadset
import android.bluetooth.BluetoothProfile
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Detects car Bluetooth (A2DP / HFP) connect/disconnect events.
 *
 * Events emitted to JS:
 *   "onCarBluetoothConnect"    — car Bluetooth audio profile connected
 *   "onCarBluetoothDisconnect" — car Bluetooth audio profile disconnected
 */
class CarBluetoothModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "CarBluetoothModule"

    @Volatile
    private var isCarConnected = false
    private var listenerCount = 0
    private var receiver: BroadcastReceiver? = null

    // Track connected A2DP / HFP profiles to avoid false disconnects
    // when only one profile drops (e.g. HFP drops but A2DP stays).
    private val connectedProfiles = mutableSetOf<String>()

    init {
        checkInitialState()
        registerReceiver()
    }

    // ── Public API ────────────────────────────────────────────────────────────

    @ReactMethod
    fun isConnected(promise: Promise) {
        promise.resolve(isCarConnected)
    }

    @ReactMethod
    fun addListener(@Suppress("UNUSED_PARAMETER") eventName: String) {
        listenerCount++
    }

    @ReactMethod
    fun removeListeners(@Suppress("UNUSED_PARAMETER") count: Int) {
        listenerCount = (listenerCount - count).coerceAtLeast(0)
    }

    // ── Broadcast receiver ────────────────────────────────────────────────────

    private fun registerReceiver() {
        val filter = IntentFilter().apply {
            addAction(BluetoothA2dp.ACTION_CONNECTION_STATE_CHANGED)
            addAction(BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED)
        }
        receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                handleBluetoothIntent(intent)
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            reactApplicationContext.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            reactApplicationContext.registerReceiver(receiver, filter)
        }
    }

    private fun handleBluetoothIntent(intent: Intent) {
        val state = intent.getIntExtra(BluetoothProfile.EXTRA_STATE, BluetoothProfile.STATE_DISCONNECTED)
        val device: BluetoothDevice? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
        }

        val profileKey = "${intent.action}:${device?.address ?: "unknown"}"

        when (state) {
            BluetoothProfile.STATE_CONNECTED -> {
                connectedProfiles.add(profileKey)
                if (!isCarConnected) {
                    isCarConnected = true
                    emitEvent("onCarBluetoothConnect", device)
                }
            }
            BluetoothProfile.STATE_DISCONNECTED -> {
                connectedProfiles.remove(profileKey)
                if (isCarConnected && connectedProfiles.isEmpty()) {
                    isCarConnected = false
                    emitEvent("onCarBluetoothDisconnect", device)
                }
            }
        }
    }

    // ── Initial state check ───────────────────────────────────────────────────

    private fun checkInitialState() {
        val adapter = BluetoothAdapter.getDefaultAdapter() ?: return
        // Check A2DP profile connection state
        adapter.getProfileProxy(reactApplicationContext, object : BluetoothProfile.ServiceListener {
            override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) {
                try {
                    val devices = proxy.connectedDevices
                    if (devices.isNotEmpty()) {
                        isCarConnected = true
                        devices.forEach { device ->
                            connectedProfiles.add("a2dp:${device.address}")
                        }
                    }
                } catch (_: SecurityException) {
                    // BLUETOOTH_CONNECT not granted at runtime — isCarConnected stays false
                } finally {
                    adapter.closeProfileProxy(profile, proxy)
                }
            }
            override fun onServiceDisconnected(profile: Int) {}
        }, BluetoothProfile.A2DP)
    }

    // ── Event emission ────────────────────────────────────────────────────────

    private fun emitEvent(eventName: String, device: BluetoothDevice?) {
        if (listenerCount == 0) return

        val params = Arguments.createMap().apply {
            putString("timestamp", isoTimestamp())
            putString("deviceName", try { device?.name } catch (_: SecurityException) { null } ?: "unknown")
            putString("deviceAddress", device?.address ?: "unknown")
        }

        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    private fun isoTimestamp(): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(Date())
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────

    override fun invalidate() {
        receiver?.let {
            try { reactApplicationContext.unregisterReceiver(it) } catch (_: Exception) {}
        }
        receiver = null
        connectedProfiles.clear()
        super.invalidate()
    }
}
