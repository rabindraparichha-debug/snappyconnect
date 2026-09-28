import 'dart:convert';
import '../services/call_service_keeper.dart';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../models.dart';

class ApiException implements Exception {
  ApiException(this.message, [this.statusCode]);

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

/// Thin JSON HTTP client with token persistence. Points at the
/// SnappyConnect API (NestJS backend).
class ApiClient {
  ApiClient._();

  static final ApiClient instance = ApiClient._();

  /// Production API. (For the Android emulator against a local backend,
  /// change it to http://10.0.2.2:4000/api/v1 on the login screen.)
  static const defaultBaseUrl = 'https://call.snappyhires.com/api/v1';

  String baseUrl = defaultBaseUrl;
  String? _token;
  User? currentUser;

  bool get isLoggedIn => _token != null && currentUser != null;

  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    baseUrl = prefs.getString('baseUrl') ?? defaultBaseUrl;
    _token = prefs.getString('token');
    final userJson = prefs.getString('user');
    if (userJson != null) {
      try {
        currentUser = User.fromJson(jsonDecode(userJson) as Map<String, dynamic>);
      } catch (_) {
        currentUser = null;
      }
    }
  }

  /// Just the host, for showing in the login field — "call.snappyhires.com"
  /// rather than the full API URL. Matching the stored value against
  /// [defaultBaseUrl] as a string was too brittle: a trailing slash or a
  /// "www." prefix produced a different string, so the field fell back to
  /// displaying the raw stored URL.
  String get serverHost {
    for (final candidate in [baseUrl, defaultBaseUrl]) {
      final uri = Uri.tryParse(candidate);
      if (uri != null && uri.host.isNotEmpty) {
        final needsPort = uri.hasPort && uri.port != 443 && uri.port != 80;
        return needsPort ? '${uri.host}:${uri.port}' : uri.host;
      }
    }
    return 'call.snappyhires.com';
  }

  /// Recruiters only need to type the domain: "call.snappyhires.com" becomes
  /// "https://call.snappyhires.com/api/v1". A full URL passes through, and an
  /// explicit http:// (local dev, emulator) is respected.
  static String normalizeServerUrl(String input) {
    var url = input.trim().replaceAll(RegExp(r'/+$'), '');
    if (url.isEmpty) return defaultBaseUrl;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://$url';
    }
    final uri = Uri.parse(url);
    if (!uri.path.contains('/api')) {
      url = '$url/api/v1';
    }
    return url;
  }

  Future<void> login(String serverUrl, String email, String password) async {
    baseUrl = normalizeServerUrl(serverUrl);
    final data = await post('/auth/login', body: {'email': email, 'password': password})
        as Map<String, dynamic>;
    _token = data['accessToken'] as String;
    currentUser = User.fromJson(data['user'] as Map<String, dynamic>);

    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('baseUrl', baseUrl);
    await prefs.setString('token', _token!);
    await prefs.setString('user', jsonEncode(data['user']));
  }

  /// Called on sign-out, before the token is cleared, so the calling stack
  /// can unregister this device. Without it a signed-out phone keeps ringing:
  /// Telnyx delivers to whoever is registered, and the push credential is
  /// bound to the device, not to the session.
  static Future<void> Function()? onSignOut;

  Future<void> logout() async {
    // Stop the on-duty service so its notification does not linger after
    // signing out.
    await CallServiceKeeper.stop();
    try {
      await onSignOut?.call();
    } catch (_) {
      // Never trap someone in a session because teardown failed.
    }
    _token = null;
    currentUser = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('token');
    await prefs.remove('user');
  }

  Future<dynamic> get(String path, {Map<String, String>? query}) =>
      _request('GET', path, query: query);

  Future<dynamic> post(String path, {Object? body}) => _request('POST', path, body: body);

  Future<dynamic> patch(String path, {Object? body}) => _request('PATCH', path, body: body);

  Future<dynamic> delete(String path) => _request('DELETE', path);

  /// Auth header for players and downloaders that fetch a URL themselves.
  Map<String, String> get authHeaders =>
      _token == null ? const {} : {'Authorization': 'Bearer $_token'};

  /// Upload a file as multipart/form-data — used for voice samples, which
  /// are far too big to send as JSON.
  Future<dynamic> uploadFile(
    String path,
    String filePath, {
    Map<String, String> fields = const {},
    String field = 'file',
  }) async {
    final request = http.MultipartRequest('POST', Uri.parse('$baseUrl$path'))
      ..headers.addAll(authHeaders)
      ..fields.addAll(fields)
      ..files.add(await http.MultipartFile.fromPath(field, filePath));
    late http.StreamedResponse streamed;
    try {
      streamed = await request.send().timeout(const Duration(seconds: 60));
    } catch (_) {
      throw ApiException('Could not reach the SnappyConnect server.');
    }
    final res = await http.Response.fromStream(streamed);
    if (res.statusCode >= 400) {
      String message = 'Upload failed (${res.statusCode})';
      try {
        final raw = jsonDecode(res.body)['message'];
        if (raw is List) {
          message = raw.join(', ');
        } else if (raw is String) {
          message = raw;
        }
      } catch (_) {}
      throw ApiException(message, res.statusCode);
    }
    return res.body.isEmpty ? null : jsonDecode(res.body);
  }

  Future<dynamic> _request(
    String method,
    String path, {
    Object? body,
    Map<String, String>? query,
  }) async {
    var uri = Uri.parse('$baseUrl$path');
    if (query != null && query.isNotEmpty) {
      uri = uri.replace(queryParameters: {...uri.queryParameters, ...query});
    }

    final headers = <String, String>{
      if (_token != null) 'Authorization': 'Bearer $_token',
      if (body != null) 'Content-Type': 'application/json',
    };

    final encodedBody = body != null ? jsonEncode(body) : null;

    late http.Response res;
    try {
      res = switch (method) {
        'GET' => await http.get(uri, headers: headers).timeout(const Duration(seconds: 15)),
        'PATCH' => await http
            .patch(uri, headers: headers, body: encodedBody)
            .timeout(const Duration(seconds: 15)),
        'DELETE' => await http
            .delete(uri, headers: headers)
            .timeout(const Duration(seconds: 15)),
        _ => await http
            .post(uri, headers: headers, body: encodedBody)
            .timeout(const Duration(seconds: 15)),
      };
    } catch (_) {
      throw ApiException('Could not reach the SnappyConnect server.');
    }

    if (res.statusCode == 401) {
      await logout();
      throw ApiException('Session expired — please sign in again.', 401);
    }
    if (res.statusCode >= 400) {
      String message = 'Request failed (${res.statusCode})';
      try {
        final data = jsonDecode(res.body);
        final raw = data['message'];
        if (raw is List) {
          message = raw.join(', ');
        } else if (raw is String) {
          message = raw;
        }
      } catch (_) {}
      throw ApiException(message, res.statusCode);
    }

    if (res.body.isEmpty) return null;
    return jsonDecode(res.body);
  }
}
