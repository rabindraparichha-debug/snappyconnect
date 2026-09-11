import 'package:flutter/foundation.dart';

/// Lets any screen (history, messages) hand a number to the dialer tab.
/// HomeScreen listens to switch tabs; DialerScreen listens to fill the field.
class DialIntent {
  static final ValueNotifier<String?> pending = ValueNotifier(null);

  static void call(String number) {
    // Reset first so dialing the same number twice still notifies.
    pending.value = null;
    pending.value = number;
  }
}
