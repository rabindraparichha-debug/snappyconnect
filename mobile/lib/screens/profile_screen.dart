import 'package:flutter/material.dart';

import '../api/api_client.dart';
import 'login_screen.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final user = ApiClient.instance.currentUser;

    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: user == null
          ? const Center(child: Text('Not signed in'))
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Center(
                  child: CircleAvatar(
                    radius: 36,
                    backgroundColor: const Color(0xFFDEE9FF),
                    child: Text(
                      user.name.isNotEmpty ? user.name[0].toUpperCase() : '?',
                      style: const TextStyle(
                        fontSize: 28,
                        fontWeight: FontWeight.w700,
                        color: Color(0xFF3540C9),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Center(
                  child: Text(user.name,
                      style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
                ),
                Center(
                  child: Text(user.email, style: const TextStyle(color: Color(0xFF64748B))),
                ),
                const SizedBox(height: 24),
                _InfoTile(label: 'Role', value: user.role),
                _InfoTile(label: 'Mobile Number', value: user.mobileNumber ?? '—'),
                _InfoTile(label: 'Country', value: user.country ?? '—'),
                _InfoTile(label: 'Calling Provider', value: user.providerLabel),
                if (user.provider == 'grandstream')
                  _InfoTile(
                    label: 'PBX Extension',
                    value: (user.providerConfig['extension'] as String?) ?? '—',
                  ),
                _InfoTile(label: 'Server', value: ApiClient.instance.baseUrl),
                const SizedBox(height: 24),
                OutlinedButton.icon(
                  onPressed: () async {
                    await ApiClient.instance.logout();
                    if (context.mounted) {
                      Navigator.of(context).pushAndRemoveUntil(
                        MaterialPageRoute(builder: (_) => const LoginScreen()),
                        (_) => false,
                      );
                    }
                  },
                  icon: const Icon(Icons.logout),
                  label: const Text('Sign out'),
                ),
              ],
            ),
    );
  }
}

class _InfoTile extends StatelessWidget {
  const _InfoTile({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(label, style: const TextStyle(color: Color(0xFF64748B))),
          ),
          Flexible(
            child: Text(
              value,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}
