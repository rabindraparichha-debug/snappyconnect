import 'dart:convert';
import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:ota_update/ota_update.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../api/api_client.dart';

/// Self-updater for the Android build. On launch the app compares its own
/// version with `/downloads/version.json` on the server; when the server has
/// a newer build the user gets a one-tap "Update" dialog that downloads the
/// APK and opens Android's installer — no visit to the download page needed.
class UpdateService {
  UpdateService._();

  /// Android rarely cold-starts an app that lives in the recents list, so a
  /// launch-only check can miss releases for days. Re-check whenever the app
  /// comes to the foreground, at most once an hour.
  static DateTime? _lastCheck;
  static bool _dialogShowing = false;

  /// `https://call.snappyhires.com/api/v1` → `https://call.snappyhires.com`.
  static String get _origin {
    final uri = Uri.parse(ApiClient.instance.baseUrl);
    return '${uri.scheme}://${uri.authority}';
  }

  static Future<void> checkAndPrompt(BuildContext context) async {
    // Android only: version.json describes the APK, and the installer this
    // dialog drives (ota_update) has no iOS implementation — offering it on
    // iOS would pop an "Update" button that throws when tapped. iOS updates
    // arrive through TestFlight instead.
    if (!Platform.isAndroid) return;
    if (_dialogShowing) return;
    final now = DateTime.now();
    if (_lastCheck != null && now.difference(_lastCheck!).inMinutes < 60) return;
    _lastCheck = now;
    try {
      final res = await http
          .get(Uri.parse('$_origin/downloads/version.json'))
          .timeout(const Duration(seconds: 10));
      if (res.statusCode != 200) return;
      final info = (jsonDecode(res.body) as Map<String, dynamic>)['android']
          as Map<String, dynamic>?;
      if (info == null) return;
      final latest = info['version'] as String? ?? '';
      final current = (await PackageInfo.fromPlatform()).version;
      if (!_isNewer(latest, current)) return;
      if (!context.mounted) return;
      _dialogShowing = true;
      try {
        await _promptUpdate(context, latest, info['notes'] as String? ?? '');
      } finally {
        _dialogShowing = false;
      }
    } catch (_) {
      // Update checks must never get in the way of taking calls.
    }
  }

  static bool _isNewer(String latest, String current) {
    List<int> parts(String v) =>
        v.split('.').map((p) => int.tryParse(p.trim()) ?? 0).toList();
    final a = parts(latest);
    final b = parts(current);
    for (var i = 0; i < 3; i++) {
      final x = i < a.length ? a[i] : 0;
      final y = i < b.length ? b[i] : 0;
      if (x != y) return x > y;
    }
    return false;
  }

  static Future<void> _promptUpdate(
      BuildContext context, String version, String notes) {
    return showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Update available ($version)'),
        content: Text(notes.isEmpty
            ? 'A new version of SnappyConnect is ready. It downloads and '
                'installs right from here — takes about a minute.'
            : notes),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Later'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              _runOta(context);
            },
            child: const Text('Update now'),
          ),
        ],
      ),
    );
  }

  static void _runOta(BuildContext context) {
    final messenger = ScaffoldMessenger.of(context);
    messenger.showSnackBar(
      const SnackBar(
        content: Text('Downloading update… keep the app open'),
        duration: Duration(minutes: 5),
      ),
    );
    try {
      OtaUpdate()
          .execute('$_origin/downloads/snappyconnect.apk',
              destinationFilename: 'snappyconnect.apk')
          .listen((event) {
        if (event.status == OtaStatus.INSTALLING) {
          messenger.hideCurrentSnackBar();
        } else if (event.status != OtaStatus.DOWNLOADING) {
          // Any error state: let the user fall back to the website.
          messenger.hideCurrentSnackBar();
          messenger.showSnackBar(SnackBar(
            content: Text(
                'Update failed (${event.status.name.toLowerCase()}). '
                'You can also install it from $_origin/downloads/'),
          ));
        }
      }, onError: (Object e) {
        messenger.hideCurrentSnackBar();
        messenger.showSnackBar(SnackBar(
          content:
              Text('Update failed. You can install it from $_origin/downloads/'),
        ));
      });
    } catch (_) {
      messenger.hideCurrentSnackBar();
    }
  }
}
