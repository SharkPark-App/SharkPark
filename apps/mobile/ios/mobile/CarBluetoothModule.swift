import Foundation
import AVFoundation
import React

/// Detects car Bluetooth audio connect/disconnect events using AVAudioSession
/// route change notifications. Works in all app states (foreground/background).
///
/// Events emitted to JS:
///   "onCarBluetoothConnect"    — car Bluetooth audio output connected
///   "onCarBluetoothDisconnect" — car Bluetooth audio output disconnected
@objc(CarBluetoothModule)
class CarBluetoothModule: RCTEventEmitter {

  private var hasListeners = false
  private var isCarBluetoothConnected = false

  override init() {
    super.init()
    setupRouteChangeObserver()
    // Check initial state
    isCarBluetoothConnected = Self.hasCarBluetoothOutput()
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  // MARK: - RCTEventEmitter overrides

  override static func requiresMainQueueSetup() -> Bool { false }

  override func supportedEvents() -> [String]! {
    ["onCarBluetoothConnect", "onCarBluetoothDisconnect"]
  }

  override func startObserving() { hasListeners = true }
  override func stopObserving()  { hasListeners = false }

  // MARK: - Public API

  /// Returns whether car Bluetooth audio is currently connected.
  @objc func isConnected(_ resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(isCarBluetoothConnected)
  }

  // MARK: - Route change handling

  private func setupRouteChangeObserver() {
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleRouteChange),
      name: AVAudioSession.routeChangeNotification,
      object: nil
    )
  }

  @objc private func handleRouteChange(_ notification: Notification) {
    guard let userInfo = notification.userInfo,
          let reasonValue = userInfo[AVAudioSessionRouteChangeReasonKey] as? UInt,
          let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue) else {
      return
    }

    let wasConnected = isCarBluetoothConnected
    let isNowConnected = Self.hasCarBluetoothOutput()
    isCarBluetoothConnected = isNowConnected

    guard hasListeners, wasConnected != isNowConnected else { return }

    switch reason {
    case .newDeviceAvailable:
      if isNowConnected {
        sendEvent(withName: "onCarBluetoothConnect", body: [
          "timestamp": ISO8601DateFormatter().string(from: Date()),
          "portType": Self.carBluetoothPortName() ?? "unknown"
        ])
      }
    case .oldDeviceUnavailable:
      if !isNowConnected {
        sendEvent(withName: "onCarBluetoothDisconnect", body: [
          "timestamp": ISO8601DateFormatter().string(from: Date()),
          "previousPortType": Self.previousCarBluetoothPortName(notification) ?? "unknown"
        ])
      }
    default:
      break
    }
  }

  // MARK: - Helpers

  /// Check if any current audio output is a car Bluetooth route (A2DP / HFP / CarPlay).
  private static func hasCarBluetoothOutput() -> Bool {
    let route = AVAudioSession.sharedInstance().currentRoute
    return route.outputs.contains { isCarAudioPort($0) }
  }

  /// Returns the name of the connected car Bluetooth port, if any.
  private static func carBluetoothPortName() -> String? {
    let route = AVAudioSession.sharedInstance().currentRoute
    return route.outputs.first(where: { isCarAudioPort($0) })?.portName
  }

  /// Extracts the previous car Bluetooth port name from a route-change notification.
  private static func previousCarBluetoothPortName(_ notification: Notification) -> String? {
    guard let previousRoute = notification.userInfo?[AVAudioSessionRouteChangePreviousRouteKey] as? AVAudioSessionRouteDescription else {
      return nil
    }
    return previousRoute.outputs.first(where: { isCarAudioPort($0) })?.portName
  }

  /// Identifies audio ports that correspond to car Bluetooth (A2DP, HFP, or CarPlay).
  private static func isCarAudioPort(_ port: AVAudioSessionPortDescription) -> Bool {
    let carPorts: Set<AVAudioSession.Port> = [
      .bluetoothA2DP,   // Bluetooth Advanced Audio Distribution (stereo, car speakers)
      .bluetoothHFP,    // Bluetooth Hands-Free Profile (calls, car kit)
      .carAudio         // CarPlay
    ]
    return carPorts.contains(port.portType)
  }
}
