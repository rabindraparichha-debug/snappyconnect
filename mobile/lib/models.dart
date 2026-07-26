class User {
  User({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
    this.mobileNumber,
    this.country,
    this.provider,
    this.providerConfig = const {},
    this.regions = const [],
    required this.status,
  });

  final String id;
  final String name;
  final String email;
  final String role;
  final String? mobileNumber;
  final String? country;
  final String? provider; // telnyx | grandstream | native_dialer
  final Map<String, dynamic> providerConfig;

  /// Regions this user may call from: india | usa | uae.
  final List<String> regions;
  final String status;

  factory User.fromJson(Map<String, dynamic> json) => User(
        id: json['id'] as String,
        name: json['name'] as String,
        email: json['email'] as String,
        role: json['role'] as String? ?? 'user',
        mobileNumber: json['mobileNumber'] as String?,
        country: json['country'] as String?,
        provider: json['provider'] as String?,
        providerConfig:
            (json['providerConfig'] as Map<String, dynamic>?) ?? const {},
        regions: ((json['regions'] as List<dynamic>?) ?? const [])
            .map((r) => r.toString())
            .toList(),
        status: json['status'] as String? ?? 'active',
      );

  /// Regions the user can work in — falls back to the one implied by provider.
  List<String> get allowedRegions {
    if (regions.isNotEmpty) return regions;
    return switch (provider) {
      'telnyx' => const ['usa'],
      'native_dialer' => const ['india'],
      'asterisk' || 'grandstream' => const ['uae'],
      _ => const [],
    };
  }

  String get providerLabel => switch (provider) {
        'telnyx' => 'Telnyx (USA)',
        'grandstream' => 'Grandstream PBX (UAE)',
        'native_dialer' => 'Native Dialer (India)',
        'asterisk' => 'In-App SIP (UAE)',
        _ => 'Unassigned',
      };
}

class CallRequest {
  CallRequest({required this.id, required this.phoneNumber, required this.createdAt});

  final String id;
  final String phoneNumber;
  final DateTime createdAt;

  factory CallRequest.fromJson(Map<String, dynamic> json) => CallRequest(
        id: json['id'] as String,
        phoneNumber: json['phoneNumber'] as String,
        createdAt: DateTime.parse(json['createdAt'] as String),
      );
}

class CallLogItem {
  CallLogItem({
    required this.id,
    required this.phoneNumber,
    required this.provider,
    required this.direction,
    required this.status,
    required this.durationSeconds,
    this.startedAt,
  });

  final String id;
  final String phoneNumber;
  final String provider;
  final String direction;
  final String status;
  final int durationSeconds;
  final DateTime? startedAt;

  factory CallLogItem.fromJson(Map<String, dynamic> json) => CallLogItem(
        id: json['id'] as String,
        phoneNumber: json['phoneNumber'] as String,
        provider: json['provider'] as String,
        direction: json['direction'] as String,
        status: json['status'] as String,
        durationSeconds: (json['durationSeconds'] as num?)?.toInt() ?? 0,
        startedAt: json['startedAt'] != null
            ? DateTime.tryParse(json['startedAt'] as String)
            : (json['createdAt'] != null
                ? DateTime.tryParse(json['createdAt'] as String)
                : null),
      );
}

/// One SMS conversation with a contact (shared USA number inbox).
class SmsThread {
  SmsThread({
    required this.phoneNumber,
    required this.lastMessage,
    required this.lastAt,
    required this.direction,
    required this.total,
  });

  final String phoneNumber;
  final String lastMessage;
  final DateTime lastAt;
  final String direction;
  final int total;

  factory SmsThread.fromJson(Map<String, dynamic> json) => SmsThread(
        phoneNumber: json['phoneNumber'] as String,
        lastMessage: json['lastMessage'] as String? ?? '',
        lastAt: DateTime.parse(json['lastAt'] as String).toLocal(),
        direction: json['direction'] as String? ?? 'outbound',
        total: (json['total'] as num?)?.toInt() ?? 0,
      );
}

/// A single SMS in a conversation.
class SmsMessage {
  SmsMessage({
    required this.id,
    required this.body,
    required this.direction,
    required this.status,
    required this.createdAt,
  });

  final String id;
  final String body;
  final String direction;
  final String status;
  final DateTime createdAt;

  factory SmsMessage.fromJson(Map<String, dynamic> json) => SmsMessage(
        id: json['id'] as String,
        body: json['body'] as String? ?? '',
        direction: json['direction'] as String? ?? 'outbound',
        status: json['status'] as String? ?? 'sent',
        createdAt: DateTime.parse(json['createdAt'] as String).toLocal(),
      );
}
