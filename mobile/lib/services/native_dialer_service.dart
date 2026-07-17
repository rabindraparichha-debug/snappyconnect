import 'dart:io';

import 'package:call_log/call_log.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/api_client.dart';

/// Result of looking up the device call log after a native call.
class DeviceCallResult {
  DeviceCallResult({required this.durationSeconds, required this.answered});

  final int durationSeconds;
  final bool answered;
}

/// Native Mobile Dialer flow (India): open the phone's dialer with the
/// user's own SIM, then read the device call log (Android) to sync the
/// real duration back to SnappyConnect.
class NativeDialerService {
  /// Opens the platform dialer with the number pre-filled.
  Future<bool> openDialer(String phoneNumber) async {
    final uri = Uri(scheme: 'tel', path: phoneNumber);
    return launchUrl(uri);
  }

  /// Android only: find the most recent device call to [phoneNumber] and
  /// return its duration. Returns null when unavailable (iOS, denied
  /// permission, or no matching entry) — callers fall back to manual entry.
  Future<DeviceCallResult?> lookupLastCall(String phoneNumber, DateTime since) async {
    if (!Platform.isAndroid) return null;

    // READ_CALL_LOG is declared in the manifest; request the phone
    // permission group as a best effort (the plugin verifies access).
    await Permission.phone.request();

    try {
      final entries = await CallLog.query(
        dateFrom: since.millisecondsSinceEpoch,
        number: _digitsOnly(phoneNumber),
      );
      if (entries.isEmpty) return null;
      final entry = entries.first;
      final duration = entry.duration ?? 0;
      return DeviceCallResult(durationSeconds: duration, answered: duration > 0);
    } catch (_) {
      return null;
    }
  }

  /// Android only: bulk-sync recent device calls to the backend
  /// (POST /calls/sync). Returns the number of imported records.
  Future<int> syncRecentCalls({int days = 7}) async {
    if (!Platform.isAndroid) return 0;

    final since = DateTime.now().subtract(Duration(days: days));
    final entries = await CallLog.query(dateFrom: since.millisecondsSinceEpoch);

    final calls = <Map<String, dynamic>>[];
    for (final entry in entries) {
      final number = entry.number;
      final timestamp = entry.timestamp;
      if (number == null || timestamp == null) continue;

      final direction = switch (entry.callType) {
        CallType.incoming => 'inbound',
        CallType.missed => 'inbound',
        CallType.rejected => 'inbound',
        _ => 'outbound',
      };
      final status = switch (entry.callType) {
        CallType.missed => 'missed',
        CallType.rejected => 'canceled',
        _ => (entry.duration ?? 0) > 0 ? 'completed' : 'no_answer',
      };

      calls.add({
        'phoneNumber': number,
        'direction': direction,
        'status': status,
        'durationSeconds': entry.duration ?? 0,
        'startedAt':
            DateTime.fromMillisecondsSinceEpoch(timestamp).toUtc().toIso8601String(),
      });
    }

    if (calls.isEmpty) return 0;
    final result = await ApiClient.instance.post('/calls/sync', body: {'calls': calls})
        as Map<String, dynamic>;
    return (result['imported'] as num?)?.toInt() ?? 0;
  }

  String _digitsOnly(String number) => number.replaceAll(RegExp(r'\D'), '');
}
