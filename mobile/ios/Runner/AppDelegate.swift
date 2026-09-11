import Flutter
import UIKit
import PushKit
import flutter_callkit_incoming

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate, PKPushRegistryDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    // Register for VoIP pushes so Telnyx can wake the app for an incoming
    // call. Without this the app only rings while it is already running.
    let registry = PKPushRegistry(queue: nil)
    registry.delegate = self
    registry.desiredPushTypes = [.voIP]
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
  }

  // MARK: - PushKit

  /// The VoIP token identifies this device to APNs. Handing it to the CallKit
  /// plugin lets Dart read it back and pass it to Telnyx as notificationToken.
  func pushRegistry(_ registry: PKPushRegistry,
                    didUpdate credentials: PKPushCredentials,
                    for type: PKPushType) {
    guard type == .voIP else { return }
    let deviceToken = credentials.token.map { String(format: "%02x", $0) }.joined()
    SwiftFlutterCallkitIncomingPlugin.sharedInstance?.setDevicePushTokenVoIP(deviceToken)
  }

  func pushRegistry(_ registry: PKPushRegistry,
                    didInvalidatePushTokenFor type: PKPushType) {
    guard type == .voIP else { return }
    SwiftFlutterCallkitIncomingPlugin.sharedInstance?.setDevicePushTokenVoIP("")
  }

  /// iOS requires a VoIP push to report a call to CallKit immediately, or it
  /// kills the app. Show the native incoming-call screen straight away and
  /// carry Telnyx's metadata through so Dart can answer the call.
  func pushRegistry(_ registry: PKPushRegistry,
                    didReceiveIncomingPushWith payload: PKPushPayload,
                    for type: PKPushType,
                    completion: @escaping () -> Void) {
    guard type == .voIP else {
      completion()
      return
    }

    let metadata = payload.dictionaryPayload["metadata"] as? [String: Any] ?? [:]
    let callerName = (metadata["caller_name"] as? String) ?? ""
    let callerNumber = (metadata["caller_number"] as? String) ?? ""
    let callID = (metadata["call_id"] as? String).flatMap { $0.isEmpty ? nil : $0 }
      ?? UUID().uuidString

    let caller = !callerName.isEmpty
      ? callerName
      : (callerNumber.isEmpty ? "Unknown caller" : callerNumber)

    let data = flutter_callkit_incoming.Data(
      id: callID,
      nameCaller: caller,
      handle: callerNumber,
      type: 0
    )
    data.uuid = (UUID(uuidString: callID) ?? UUID()).uuidString
    data.nameCaller = caller
    data.normalHandle = 1
    data.extra = payload.dictionaryPayload as NSDictionary

    SwiftFlutterCallkitIncomingPlugin.sharedInstance?.showCallkitIncoming(data, fromPushKit: true)
    completion()
  }
}
