/// Calling regions and how a dialed number maps to one.
class Regions {
  static const india = 'india';
  static const usa = 'usa';
  static const uae = 'uae';

  static const all = [india, usa, uae];

  static const _dialCodes = {
    india: ['+91', '0091', '91'],
    usa: ['+1', '001'],
    uae: ['+971', '00971', '971'],
  };

  static String label(String region) => switch (region) {
        india => '🇮🇳 India',
        usa => '🇺🇸 USA',
        uae => '🇦🇪 UAE',
        _ => region,
      };

  static String hint(String region) => switch (region) {
        india => 'Calls open your phone’s dialer (your own SIM)',
        usa => 'Calls go over the internet (Telnyx)',
        uae => 'Calls go through the office PBX line',
        _ => '',
      };

  /// Region implied by a number's international dial code, or null when the
  /// number is in local format (e.g. UAE `05…`).
  static String? fromNumber(String phoneNumber) {
    final n = phoneNumber.replaceAll(RegExp(r'[\s\-().]'), '');
    String? best;
    var bestLength = 0;
    _dialCodes.forEach((region, codes) {
      for (final code in codes) {
        if (n.startsWith(code) && code.length > bestLength) {
          best = region;
          bestLength = code.length;
        }
      }
    });
    return best;
  }
}
