import 'package:flutter/foundation.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';

/// Keeps the app's process (and therefore the SIP registration) alive while a
/// recruiter is on duty, so return calls ring even when the app is in the
/// background or the screen is off. Android shows a persistent notification
/// while this is running — that is what buys us the exemption from being
/// killed. Stopping it (sign-out) removes the notification.
class CallServiceKeeper {
  static bool _initialised = false;

  static void init() {
    if (_initialised || kIsWeb) return;
    _initialised = true;
    FlutterForegroundTask.initCommunicationPort();
    FlutterForegroundTask.init(
      androidNotificationOptions: AndroidNotificationOptions(
        channelId: 'snappyconnect_calls',
        channelName: 'SnappyConnect calling',
        channelDescription: 'Keeps your line connected so incoming calls can ring.',
        channelImportance: NotificationChannelImportance.LOW,
        priority: NotificationPriority.LOW,
        onlyAlertOnce: true,
      ),
      iosNotificationOptions: const IOSNotificationOptions(
        showNotification: false,
        playSound: false,
      ),
      foregroundTaskOptions: ForegroundTaskOptions(
        eventAction: ForegroundTaskEventAction.repeat(60000),
        autoRunOnBoot: true,
        autoRunOnMyPackageReplaced: true,
        allowWakeLock: true,
        allowWifiLock: true,
      ),
    );
  }

  /// Ask for the permissions Android needs to show call notifications and to
  /// keep running in the background. Safe to call repeatedly.
  static Future<void> requestPermissions() async {
    if (kIsWeb) return;
    final notification = await FlutterForegroundTask.checkNotificationPermission();
    if (notification != NotificationPermission.granted) {
      await FlutterForegroundTask.requestNotificationPermission();
    }
    if (!await FlutterForegroundTask.isIgnoringBatteryOptimizations) {
      await FlutterForegroundTask.requestIgnoreBatteryOptimization();
    }
  }

  static Future<void> start({required String line}) async {
    if (kIsWeb) return;
    init();
    if (await FlutterForegroundTask.isRunningService) {
      await FlutterForegroundTask.updateService(
        notificationTitle: 'SnappyConnect — on duty',
        notificationText: 'Line $line connected. Incoming calls will ring.',
      );
      return;
    }
    await FlutterForegroundTask.startService(
      serviceId: 4001,
      notificationTitle: 'SnappyConnect — on duty',
      notificationText: 'Line $line connected. Incoming calls will ring.',
      callback: _startCallback,
    );
  }

  static Future<void> stop() async {
    if (kIsWeb) return;
    if (await FlutterForegroundTask.isRunningService) {
      await FlutterForegroundTask.stopService();
    }
  }
}

@pragma('vm:entry-point')
void _startCallback() {
  FlutterForegroundTask.setTaskHandler(_KeepAliveHandler());
}

/// The service itself does no work — its only job is to keep the process (and
/// the SIP registration living in the main isolate) from being killed.
class _KeepAliveHandler extends TaskHandler {
  @override
  Future<void> onStart(DateTime timestamp, TaskStarter starter) async {}

  @override
  void onRepeatEvent(DateTime timestamp) {}

  @override
  Future<void> onDestroy(DateTime timestamp, bool isTimeout) async {}
}
