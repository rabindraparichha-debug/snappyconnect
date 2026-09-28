import 'package:flutter/material.dart';

import '../api/api_client.dart';

class BatchSummary {
  BatchSummary.fromJson(Map<String, dynamic> json)
      : id = json['id'] as String,
        message = json['message'] as String? ?? '',
        status = json['status'] as String? ?? 'scheduled',
        total = (json['total'] as num?)?.toInt() ?? 0,
        sent = (json['sent'] as num?)?.toInt() ?? 0,
        failed = (json['failed'] as num?)?.toInt() ?? 0,
        startAt = DateTime.tryParse(json['startAt'] as String? ?? '')?.toLocal();

  final String id;
  final String message;
  final String status;
  final int total;
  final int sent;
  final int failed;
  final DateTime? startAt;
}

/// Send one message to many people, spaced out.
///
/// Messages go one every 72 seconds inside an 8am–9pm window in the
/// recipient's time zone: a burst of identical texts is what gets a number
/// blocked by carriers, so the pace is the feature, not a limitation.
class GroupSmsScreen extends StatefulWidget {
  const GroupSmsScreen({super.key});

  @override
  State<GroupSmsScreen> createState() => _GroupSmsScreenState();
}

class _GroupSmsScreenState extends State<GroupSmsScreen> {
  final TextEditingController _numbers = TextEditingController();
  final TextEditingController _message = TextEditingController();
  List<BatchSummary> _batches = [];
  bool _sending = false;
  bool _loading = true;
  String? _error;
  int _maxChars = 135;
  int _maxContacts = 50;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _numbers.dispose();
    _message.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final limits = await ApiClient.instance.get('/sms/batches/limits');
      if (limits is Map<String, dynamic>) {
        _maxChars = (limits['maxMessageChars'] as num?)?.toInt() ?? _maxChars;
        _maxContacts = (limits['maxContacts'] as num?)?.toInt() ?? _maxContacts;
      }
      final data = await ApiClient.instance.get('/sms/batches') as List<dynamic>;
      if (!mounted) return;
      setState(() {
        _batches = data
            .map((e) => BatchSummary.fromJson(e as Map<String, dynamic>))
            .toList();
        _loading = false;
      });
    } catch (err) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = '$err';
        });
      }
    }
  }

  List<Map<String, String>> _parseRecipients() {
    // One per line, "number, name" or just the number.
    final out = <Map<String, String>>[];
    for (final line in _numbers.text.split(RegExp(r'[\n;]'))) {
      final trimmed = line.trim();
      if (trimmed.isEmpty) continue;
      final parts = trimmed.split(',');
      final phone = parts.first.trim();
      if (phone.isEmpty) continue;
      out.add({
        'phone': phone,
        if (parts.length > 1 && parts[1].trim().isNotEmpty) 'name': parts[1].trim(),
      });
    }
    return out;
  }

  Future<void> _send() async {
    final contacts = _parseRecipients();
    final body = _message.text.trim();
    if (contacts.isEmpty || body.isEmpty) return;
    if (contacts.length > _maxContacts) {
      setState(() => _error = 'Up to $_maxContacts people per batch.');
      return;
    }
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await ApiClient.instance.post('/sms/batches', body: {
        'message': body,
        'startAt': DateTime.now().toUtc().toIso8601String(),
        'contacts': contacts,
      });
      _numbers.clear();
      _message.clear();
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Sending to ${contacts.length} people.')),
        );
      }
    } catch (err) {
      if (mounted) setState(() => _error = '$err');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _cancel(BatchSummary batch) async {
    try {
      await ApiClient.instance.post('/sms/batches/${batch.id}/cancel');
      await _load();
    } catch (err) {
      if (mounted) setState(() => _error = '$err');
    }
  }

  @override
  Widget build(BuildContext context) {
    final recipients = _parseRecipients().length;
    final used = _message.text.trim().length;
    return Scaffold(
      appBar: AppBar(title: const Text('Group SMS')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                const Text(
                  'One message to many people. Messages go out one at a time, '
                  'about a minute apart, inside working hours for the person '
                  'receiving them — a burst of identical texts is what gets a '
                  'number blocked.',
                  style: TextStyle(fontSize: 13, color: Color(0xFF64748B)),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _numbers,
                  maxLines: 5,
                  keyboardType: TextInputType.multiline,
                  onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(
                    labelText: 'Recipients',
                    helperText: 'One per line: 5551234567, Priya',
                    border: const OutlineInputBorder(),
                    counterText: '$recipients / $_maxContacts',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _message,
                  maxLines: 4,
                  maxLength: _maxChars,
                  textCapitalization: TextCapitalization.sentences,
                  onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(
                    labelText: 'Message',
                    helperText: '{{name}} becomes the person’s name',
                    border: const OutlineInputBorder(),
                    counterText: '$used / $_maxChars',
                  ),
                ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text(_error!,
                        style: const TextStyle(color: Color(0xFFDC2626))),
                  ),
                FilledButton.icon(
                  onPressed: _sending || recipients == 0 || used == 0 ? null : _send,
                  icon: const Icon(Icons.send),
                  label: Text(_sending
                      ? 'Starting…'
                      : 'Send to $recipients ${recipients == 1 ? 'person' : 'people'}'),
                ),
                const SizedBox(height: 24),
                const Text('Recent batches',
                    style: TextStyle(fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                if (_batches.isEmpty)
                  const Text('Nothing sent yet.',
                      style: TextStyle(color: Color(0xFF94A3B8)))
                else
                  for (final b in _batches)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(
                        b.message,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      subtitle: Text(
                        '${b.sent}/${b.total} sent'
                        '${b.failed > 0 ? ' · ${b.failed} failed' : ''}'
                        ' · ${b.status}',
                      ),
                      trailing: b.status == 'scheduled' || b.status == 'sending'
                          ? TextButton(
                              onPressed: () => _cancel(b),
                              child: const Text('Cancel'),
                            )
                          : null,
                    ),
              ],
            ),
    );
  }
}
