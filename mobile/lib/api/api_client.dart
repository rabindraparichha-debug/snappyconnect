import 'dart:convert';

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

  /// 10.0.2.2 reaches the host machine from the Android emulator.
  static const defaultBaseUrl = 'http://10.0.2.2:4000/api/v1';

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

  Future<void> login(String serverUrl, String email, String password) async {
    baseUrl = serverUrl.replaceAll(RegExp(r'/+$'), '');
    final data = await post('/auth/login', body: {'email': email, 'password': password})
        as Map<String, dynamic>;
    _token = data['accessToken'] as String;
    currentUser = User.fromJson(data['user'] as Map<String, dynamic>);

    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('baseUrl', baseUrl);
    await prefs.setString('token', _token!);
    await prefs.setString('user', jsonEncode(data['user']));
  }

  Future<void> logout() async {
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
