import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter/services.dart';
import 'package:flutter_web_auth_2/flutter_web_auth_2.dart';

/// "Continue with SnappyHires" — the shared SnappyHires account.
///
/// The app does not run OAuth itself: the SnappyConnect API holds the OAuth
/// client and the registered redirect URI. In app-return mode the API's
/// callback ends on `snappyconnect://auth/snappyhires?code=…` with a
/// two-minute, single-use code that carries no token. The app binds that code
/// to a secret it never sends until the exchange (PKCE-style), so a code
/// caught by another app claiming the same scheme is useless. The exchange
/// returns exactly what `POST /auth/login` returns.
///
/// Only people who already have an active SnappyConnect account under the
/// same e-mail can sign in this way — nobody is created.
class SnappyHiresSignIn {
  /// Must match SNAPPYHIRES_APP_RETURN_URL on the API (default
  /// `snappyconnect://auth/snappyhires`) and the Android CallbackActivity.
  static const callbackScheme = 'snappyconnect';

  static const _errors = {
    'no_account': 'No SnappyConnect account uses that SnappyHires email. '
        'Ask an admin for access, or sign in with your password.',
    'unverified': 'Please verify your SnappyHires email first, then try again.',
    'expired': 'That sign-in took too long. Please try again.',
    'cancelled': 'Sign-in was cancelled.',
    'disabled': 'SnappyHires sign-in is not available on this server.',
    'failed': 'SnappyHires sign-in failed. Please try again.',
  };

  /// Opens the system sign-in sheet against [baseUrl] (the API root, e.g.
  /// `https://call.snappyhires.com/api/v1`) and returns the one-time code
  /// plus the verifier to exchange it with, or `null` if the person closed
  /// the sheet. Throws [SnappyHiresSignInError] with a message fit to show.
  static Future<({String code, String verifier})?> authorize(String baseUrl) async {
    final verifier = newVerifier();
    final start = Uri.parse('$baseUrl/auth/snappyhires/start')
        .replace(queryParameters: {'app_challenge': challengeFor(verifier)});

    final String result;
    try {
      result = await FlutterWebAuth2.authenticate(
        url: start.toString(),
        callbackUrlScheme: callbackScheme,
      );
    } on PlatformException catch (e) {
      if (e.code == 'CANCELED') return null;
      throw const SnappyHiresSignInError('Could not open SnappyHires sign-in.');
    }
    return (code: parseCallback(result), verifier: verifier);
  }

  /// 64 URL-safe characters from a secure random source.
  static String newVerifier() {
    final rnd = Random.secure();
    return base64UrlEncode(List<int>.generate(48, (_) => rnd.nextInt(256)))
        .replaceAll('=', '');
  }

  /// base64url(SHA-256(verifier)) without padding — the API checks the same.
  static String challengeFor(String verifier) =>
      base64UrlEncode(sha256.convert(utf8.encode(verifier)).bytes)
          .replaceAll('=', '');

  /// The exchange code from `snappyconnect://auth/snappyhires?code=…`, or a
  /// readable [SnappyHiresSignInError] for `?sso_error=…`.
  static String parseCallback(String url) {
    final q = Uri.parse(url).queryParameters;
    final error = q['sso_error'];
    if (error != null) {
      throw SnappyHiresSignInError(_errors[error] ?? _errors['failed']!);
    }
    final code = q['code'];
    if (code == null || code.isEmpty) {
      throw SnappyHiresSignInError(_errors['failed']!);
    }
    return code;
  }
}

class SnappyHiresSignInError implements Exception {
  const SnappyHiresSignInError(this.message);
  final String message;
  @override
  String toString() => message;
}
