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
        status: json['status'] as String? ?? 'active',
      );

  String get providerLabel => switch (provider) {
        'telnyx' => 'Telnyx (USA)',
        'grandstream' => 'Grandstream PBX (UAE)',
        'native_dialer' => 'Native Dialer (India)',
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
