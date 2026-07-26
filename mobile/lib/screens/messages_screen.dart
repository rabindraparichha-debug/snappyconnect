import 'dart:async';

import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../models.dart';
import '../region.dart';

/// Shared SMS inbox for the USA (Telnyx) number: read candidate replies and
/// send messages. Only shown to users with USA calling access.
class MessagesScreen extends StatefulWidget {
  const MessagesScreen({super.key});

  @override
  State<MessagesScreen> createState() => _MessagesScreenState();
}

class _MessagesScreenState extends State<MessagesScreen> {
  List<SmsThread>? _threads;
  String? _error;
  Timer? _pollTimer;

  User? get _user => ApiClient.instance.currentUser;

  @override
  void initState() {
    super.initState();
    _load();
    _pollTimer = Timer.periodic(const Duration(seconds: 20), (_) => _load());
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final data = await ApiClient.instance.get('/sms/threads') as List<dynamic>;
      if (!mounted) return;
      setState(() {
        _threads = data
            .map((t) => SmsThread.fromJson(t as Map<String, dynamic>))
            .toList();
        _error = null;
      });
    } catch (err) {
      if (mounted) setState(() => _error = err.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasSms = (_user?.allowedRegions ?? const []).contains(Regions.usa) ||
        _user?.role == 'admin';

    return Scaffold(
      appBar: AppBar(title: const Text('Messages')),
      floatingActionButton: hasSms
          ? FloatingActionButton(
              onPressed: _openCompose,
              child: const Icon(Icons.edit_outlined),
            )
          : null,
      body: !hasSms
          ? const _Centered(
              icon: Icons.sms_outlined,
              title: 'SMS not enabled',
              subtitle: 'Messaging runs on the USA line. Ask your administrator for access.',
            )
          : _threads == null
              ? const Center(child: CircularProgressIndicator())
              : _threads!.isEmpty
                  ? _Centered(
                      icon: Icons.forum_outlined,
                      title: 'No messages yet',
                      subtitle: _error ?? 'Tap the pencil to send your first message.',
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.separated(
                        itemCount: _threads!.length,
                        separatorBuilder: (_, _) => const Divider(height: 1),
                        itemBuilder: (context, i) {
                          final thread = _threads![i];
                          return ListTile(
                            leading: const CircleAvatar(child: Icon(Icons.person_outline)),
                            title: Text(thread.phoneNumber,
                                style: const TextStyle(fontWeight: FontWeight.w600)),
                            subtitle: Text(
                              '${thread.direction == 'outbound' ? 'You: ' : ''}${thread.lastMessage}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            trailing: Text(
                              _shortTime(thread.lastAt),
                              style: const TextStyle(fontSize: 11, color: Color(0xFF94A3B8)),
                            ),
                            onTap: () => _openThread(thread.phoneNumber),
                          );
                        },
                      ),
                    ),
    );
  }

  Future<void> _openThread(String number) async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => SmsThreadScreen(phoneNumber: number)),
    );
    await _load();
  }

  Future<void> _openCompose() async {
    final controller = TextEditingController();
    final number = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('New message'),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.phone,
          autofocus: true,
          decoration: const InputDecoration(hintText: '+1 555 000 1234'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Next'),
          ),
        ],
      ),
    );
    if (number != null && number.isNotEmpty && mounted) {
      await _openThread(number);
    }
  }

  static String _shortTime(DateTime when) {
    final now = DateTime.now();
    if (when.year == now.year && when.month == now.month && when.day == now.day) {
      return '${when.hour.toString().padLeft(2, '0')}:${when.minute.toString().padLeft(2, '0')}';
    }
    return '${when.day}/${when.month}';
  }
}

/// One conversation: message bubbles plus a send box.
class SmsThreadScreen extends StatefulWidget {
  const SmsThreadScreen({super.key, required this.phoneNumber});

  final String phoneNumber;

  @override
  State<SmsThreadScreen> createState() => _SmsThreadScreenState();
}

class _SmsThreadScreenState extends State<SmsThreadScreen> {
  final _controller = TextEditingController();
  final _scroll = ScrollController();
  List<SmsMessage> _messages = [];
  bool _loading = true;
  bool _sending = false;
  String? _error;
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    _load();
    _pollTimer = Timer.periodic(const Duration(seconds: 15), (_) => _load());
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _controller.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final data = await ApiClient.instance
          .get('/sms/threads/${Uri.encodeComponent(widget.phoneNumber)}') as List<dynamic>;
      if (!mounted) return;
      setState(() {
        _messages =
            data.map((m) => SmsMessage.fromJson(m as Map<String, dynamic>)).toList();
        _loading = false;
      });
      _scrollToEnd();
    } catch (err) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = err.toString();
        });
      }
    }
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.jumpTo(_scroll.position.maxScrollExtent);
      }
    });
  }

  Future<void> _send() async {
    final body = _controller.text.trim();
    if (body.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await ApiClient.instance.post('/sms/send',
          body: {'to': widget.phoneNumber, 'body': body});
      _controller.clear();
      await _load();
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(err.toString())));
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.phoneNumber)),
      body: Column(
        children: [
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _messages.isEmpty
                    ? _Centered(
                        icon: Icons.chat_bubble_outline,
                        title: 'No messages yet',
                        subtitle: _error ?? 'Send the first message below.',
                      )
                    : ListView.builder(
                        controller: _scroll,
                        padding: const EdgeInsets.all(12),
                        itemCount: _messages.length,
                        itemBuilder: (context, i) {
                          final m = _messages[i];
                          final mine = m.direction == 'outbound';
                          return Align(
                            alignment:
                                mine ? Alignment.centerRight : Alignment.centerLeft,
                            child: Container(
                              margin: const EdgeInsets.symmetric(vertical: 3),
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 14, vertical: 9),
                              constraints: BoxConstraints(
                                maxWidth:
                                    MediaQuery.of(context).size.width * 0.75,
                              ),
                              decoration: BoxDecoration(
                                color: mine
                                    ? const Color(0xFF4F46E5)
                                    : const Color(0xFFF1F5F9),
                                borderRadius: BorderRadius.circular(16),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    m.body,
                                    style: TextStyle(
                                      color: mine ? Colors.white : const Color(0xFF0F172A),
                                    ),
                                  ),
                                  const SizedBox(height: 3),
                                  Text(
                                    mine ? '${_time(m.createdAt)} · ${m.status}' : _time(m.createdAt),
                                    style: TextStyle(
                                      fontSize: 10,
                                      color: mine
                                          ? Colors.white70
                                          : const Color(0xFF94A3B8),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      minLines: 1,
                      maxLines: 4,
                      decoration: const InputDecoration(hintText: 'Type a message…'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    onPressed: _sending ? null : _send,
                    icon: _sending
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.send),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  static String _time(DateTime when) =>
      '${when.hour.toString().padLeft(2, '0')}:${when.minute.toString().padLeft(2, '0')}';
}

class _Centered extends StatelessWidget {
  const _Centered({required this.icon, required this.title, this.subtitle});

  final IconData icon;
  final String title;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 44, color: const Color(0xFFCBD5E1)),
            const SizedBox(height: 12),
            Text(title,
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
            if (subtitle != null) ...[
              const SizedBox(height: 6),
              Text(
                subtitle!,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 13, color: Color(0xFF64748B)),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
