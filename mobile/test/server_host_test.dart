import 'package:flutter_test/flutter_test.dart';
import 'package:snappyconnect_mobile/api/api_client.dart';

/// The login field must always offer the plain domain. Comparing the stored
/// value against defaultBaseUrl as a string was brittle — a trailing slash or
/// a "www." prefix made it fall back to showing the raw stored API URL.
void main() {
  final client = ApiClient.instance;

  test('shows the domain for the default server', () {
    client.baseUrl = ApiClient.defaultBaseUrl;
    expect(client.serverHost, 'call.snappyhires.com');
  });

  test('shows the domain for stored variants that are not string-equal', () {
    for (final stored in [
      'https://call.snappyhires.com/api/v1/',
      'https://call.snappyhires.com',
      'https://call.snappyhires.com/api/v1',
    ]) {
      client.baseUrl = stored;
      expect(client.serverHost, 'call.snappyhires.com', reason: stored);
    }
  });

  test('keeps a genuinely different host, with a non-standard port', () {
    client.baseUrl = 'http://10.0.2.2:4000/api/v1';
    expect(client.serverHost, '10.0.2.2:4000');
  });

  test('falls back to the default when the stored value is unusable', () {
    client.baseUrl = 'not a url';
    expect(client.serverHost, 'call.snappyhires.com');
    client.baseUrl = ApiClient.defaultBaseUrl;
  });
}
