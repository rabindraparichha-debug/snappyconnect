import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform;

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_callkit_incoming/entities/entities.dart';
import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';
import 'package:telnyx_webrtc/telnyx_client.dart';

/// Device push token plumbing for incoming calls.
///
/// Without a push token Telnyx can only reach a client that already holds a
/// live WebSocket, which is why calls previously rang only while the app was
/// open. The token is handed to Telnyx as `notificationToken` at sign-in;
/// Telnyx then sends a push that wakes the app for a call.
///
/// The two platforms use different transports:
///  * iOS   — PushKit / APNs VoIP, via the CallKit plugin. No Firebase.
///  * Android — Firebase Cloud Messaging.
///
/// Everything Firebase-related is guarded: until `google-services.json` is
/// added, [firebaseReady] stays false, [deviceToken] returns null on Android,
/// and the app falls back to the foreground service exactly as before.
class PushService {
  PushService._();

  static String? _cachedToken;
  static bool _firebaseReady = false;

  /// Whether Firebase initialised — false when the app has no FCM config.
  static bool get firebaseReady => _firebaseReady;

  /// Call once from `main()` before `runApp`.
  static Future<void> init() async {
    if (!Platform.isAndroid) return;
    try {
      await Firebase.initializeApp();
      _firebaseReady = true;
      FirebaseMessaging.onBackgroundMessage(firebaseBackgroundHandler);
      await FirebaseMessaging.instance.requestPermission();
      // A call arriving while the app is open still needs the CallKit screen.
      FirebaseMessaging.onMessage.listen(showIncomingCall);
    } catch (_) {
      // No google-services.json yet: Android keeps using the foreground
      // service, which only rings while the app is running.
      _firebaseReady = false;
    }
  }

  /// The push token for this device, or null when unavailable.
  static Future<String?> deviceToken() async {
    try {
      if (Platform.isIOS) {
        // PushKit issues the token asynchronously after launch, so it can be
        // briefly empty on a cold start; the cache covers later logins.
        final token = await FlutterCallkitIncoming.getDevicePushTokenVoIP();
        if (token != null && token.isNotEmpty) return _cachedToken = token;
      } else if (Platform.isAndroid && _firebaseReady) {
        final token = await FirebaseMessaging.instance.getToken();
        if (token != null && token.isNotEmpty) return _cachedToken = token;
      }
    } catch (_) {
      // Not fatal: the app still works while it is open.
    }
    return _cachedToken;
  }

  /// Wait briefly for a token on a cold start.
  static Future<String?> awaitDeviceToken({
    Duration timeout = const Duration(seconds: 3),
  }) async {
    final deadline = DateTime.now().add(timeout);
    while (DateTime.now().isBefore(deadline)) {
      final token = await deviceToken();
      if (token != null && token.isNotEmpty) return token;
      await Future<void>.delayed(const Duration(milliseconds: 250));
    }
    return _cachedToken;
  }

  /// Show the native incoming-call screen for a Telnyx push.
  static Future<void> showIncomingCall(RemoteMessage message) async {
    final metadata = _telnyxMetadata(message.data);
    final caller = (metadata?['caller_name'] as String?)?.trim();
    final number = (metadata?['caller_number'] as String?)?.trim();
    // Telnyx supplies the call id; fall back to a unique local one.
    final callId = (metadata?['call_id'] as String?) ??
        DateTime.now().microsecondsSinceEpoch.toString();

    await FlutterCallkitIncoming.showCallkitIncoming(
      CallKitParams(
        id: callId,
        nameCaller: (caller != null && caller.isNotEmpty)
            ? caller
            : ((number != null && number.isNotEmpty) ? number : 'Unknown caller'),
        handle: number ?? '',
        type: 0,
        // Telnyx's payload is read back out of here when the call is answered.
        appName: 'SnappyConnect',
        extra: <String, dynamic>{'metadata': metadata ?? message.data},
        android: const AndroidParams(
          isCustomNotification: true,
          isShowLogo: false,
          ringtonePath: 'system_ringtone_default',
          backgroundColor: '#0F172A',
          actionColor: '#4152E4',
          // Wakes the screen for a call the way a real dialer does.
          isShowFullLockedScreen: true,
        ),
        ios: const IOSParams(handleType: 'generic', supportsHolding: true),
      ),
    );
  }

  /// Clear any call CallKit is still showing, so no stale incoming screen is
  /// left behind once a call ends or is handled elsewhere.
  static Future<void> endAllCalls() async {
    try {
      await FlutterCallkitIncoming.endAllCalls();
    } catch (_) {
      /* noop */
    }
  }

  /// Listen for CallKit actions (answer / decline / end).
  ///
  /// [onIncoming] carries the Telnyx push metadata for a call that arrived
  /// while the app was asleep; the caller passes it to
  /// TelnyxCallService.handlePush, which connects and attaches.
  static StreamSubscription<CallEvent?> listen({
    required void Function(Map<dynamic, dynamic> metadata) onIncoming,
    required void Function(Map<dynamic, dynamic> metadata) onAccept,
    required void Function(Map<dynamic, dynamic> metadata) onDecline,
    void Function()? onEnded,
  }) {
    return FlutterCallkitIncoming.onEvent.listen((CallEvent? event) {
      switch (event) {
        case CallEventActionCallIncoming(:final callKitParams):
          final metadata = _metadataOf(callKitParams);
          if (metadata != null) onIncoming(metadata);
        case CallEventActionCallAccept(:final callKitParams):
          final metadata = _metadataOf(callKitParams);
          if (metadata != null) onAccept(metadata);
        case CallEventActionCallDecline(:final callKitParams):
          final metadata = _metadataOf(callKitParams);
          if (metadata != null) onDecline(metadata);
        case CallEventActionCallEnded():
        case CallEventActionCallTimeout():
          onEnded?.call();
        default:
          break;
      }
    });
  }

  /// Telnyx nests its payload under `extra.metadata` (iOS AppDelegate and the
  /// Android handler both stash it there).
  static Map<dynamic, dynamic>? _metadataOf(CallKitParams params) {
    final extra = params.extra;
    if (extra == null) return null;
    final metadata = extra['metadata'];
    return metadata is Map ? metadata : null;
  }

  /// FCM delivers Telnyx's metadata as a JSON string under `metadata`.
  static Map<dynamic, dynamic>? _telnyxMetadata(Map<String, dynamic> data) {
    final raw = data['metadata'];
    if (raw is Map) return raw;
    if (raw is String && raw.isNotEmpty) {
      try {
        return jsonDecode(raw) as Map<dynamic, dynamic>;
      } catch (_) {
        return null;
      }
    }
    return null;
  }
}

/// Android background isolate: FCM wakes the app here when it is not running.
///
/// Must be top level and entry-point annotated, or the isolate cannot find it.
@pragma('vm:entry-point')
Future<void> firebaseBackgroundHandler(RemoteMessage message) async {
  await PushService.showIncomingCall(message);

  // Stash the decision so the UI isolate can finish the call once the app is
  // brought to the foreground — the background isolate cannot own the socket.
  FlutterCallkitIncoming.onEvent.listen((CallEvent? event) {
    switch (event) {
      case CallEventActionCallAccept():
        TelnyxClient.setPushMetaData(message.data, isAnswer: true, isDecline: false);
      case CallEventActionCallDecline():
        TelnyxClient.setPushMetaData(message.data, isAnswer: false, isDecline: true);
      default:
        break;
    }
  });
}
