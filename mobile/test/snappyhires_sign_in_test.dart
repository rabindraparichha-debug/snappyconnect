import 'package:flutter_test/flutter_test.dart';
import 'package:snappyconnect_mobile/api/snappyhires_sign_in.dart';

void main() {
  test('challenge matches the API (RFC 7636 appendix B vector)', () {
    expect(
      SnappyHiresSignIn.challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  test('verifier is long enough, URL-safe, and its challenge passes the API check', () {
    final v = SnappyHiresSignIn.newVerifier();
    expect(v.length, greaterThanOrEqualTo(43));
    expect(RegExp(r'^[A-Za-z0-9_-]+$').hasMatch(v), isTrue);
    expect(RegExp(r'^[A-Za-z0-9_-]{43}$').hasMatch(SnappyHiresSignIn.challengeFor(v)), isTrue);
  });

  test('callback yields the exchange code', () {
    expect(
      SnappyHiresSignIn.parseCallback('snappyconnect://auth/snappyhires?code=abc123'),
      'abc123',
    );
  });

  test('callback errors become readable messages', () {
    expect(
      () => SnappyHiresSignIn.parseCallback('snappyconnect://auth/snappyhires?sso_error=no_account'),
      throwsA(isA<SnappyHiresSignInError>()
          .having((e) => e.message, 'message', contains('Ask an admin'))),
    );
    expect(
      () => SnappyHiresSignIn.parseCallback('snappyconnect://auth/snappyhires?sso_error=cancelled'),
      throwsA(isA<SnappyHiresSignInError>()
          .having((e) => e.message, 'message', contains('cancelled'))),
    );
    expect(
      () => SnappyHiresSignIn.parseCallback('snappyconnect://auth/snappyhires'),
      throwsA(isA<SnappyHiresSignInError>()),
    );
  });
}
