import 'package:url_launcher/url_launcher.dart';

/// Hand a conversation over to WhatsApp.
///
/// This is a hand-off, not an integration: the message is typed and sent in
/// WhatsApp, and any reply stays there rather than appearing in SnappyConnect.
class WhatsAppService {
  /// Opens the WhatsApp chat for [phoneNumber], optionally pre-filled.
  ///
  /// wa.me takes digits only — a leading "+" or any spacing makes it fail.
  static Future<bool> open(String phoneNumber, {String? message}) async {
    final digits = phoneNumber.replaceAll(RegExp(r'\D'), '');
    if (digits.isEmpty) return false;
    final uri = Uri.parse(
      'https://wa.me/$digits'
      '${message != null && message.isNotEmpty ? '?text=${Uri.encodeComponent(message)}' : ''}',
    );
    try {
      return await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      return false;
    }
  }
}
