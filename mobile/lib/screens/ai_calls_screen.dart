import 'dart:async';

import 'package:flutter/material.dart';
import 'package:livekit_client/livekit_client.dart';
import 'package:permission_handler/permission_handler.dart';

import '../api/api_client.dart';

class LiveAiCall {
  LiveAiCall.fromJson(Map<String, dynamic> json)
      : platformCallId = json['platformCallId'] as String,
        phone = json['phone'] as String? ?? '',
        contactName = json['contactName'] as String?,
        seconds = (json['seconds'] as num?)?.toInt() ?? 0,
        takenOver = json['takenOver'] == true;

  final String platformCallId;
  final String phone;
  final String? contactName;
  final int seconds;
  final bool takenOver;
}

/// The AI agent's live calls: listen in silently, or take over and talk.
/// Mirrors the dashboard's AI Calls console (same backend, same LiveKit room).
class AiCallsScreen extends StatefulWidget {
  const AiCallsScreen({super.key});

  @override
  State<AiCallsScreen> createState() => _AiCallsScreenState();
}

class _AiCallsScreenState extends State<AiCallsScreen> {
  List<LiveAiCall> _calls = [];
  bool _loading = true;
  Timer? _pollTimer;

  Room? _room;
  String? _joinedId;
  bool _live = false; // publishing our mic (after takeover)
  String _status = '';

  @override
  void initState() {
    super.initState();
    _load();
    _pollTimer = Timer.periodic(const Duration(seconds: 5), (_) => _load());
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _leave(silent: true);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final data = await ApiClient.instance.get('/ai-calls/active') as List<dynamic>;
      if (!mounted) return;
      setState(() {
        _calls = data
            .map((item) => LiveAiCall.fromJson(item as Map<String, dynamic>))
            .toList();
        _loading = false;
      });
      // The call we joined has ended — clean up the room.
      if (_joinedId != null && !_calls.any((c) => c.platformCallId == _joinedId)) {
        _leave(silent: true);
        if (mounted) setState(() => _status = 'That call has ended.');
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _join(LiveAiCall call, {required bool publish}) async {
    if (publish) {
      final mic = await Permission.microphone.request();
      if (!mic.isGranted) {
        setState(() => _status = 'Microphone permission is required to speak.');
        return;
      }
    }
    setState(() => _status = publish ? 'Going live…' : 'Connecting…');
    try {
      final token = await ApiClient.instance.post(
        '/ai-calls/${call.platformCallId}/listen-token',
        body: {'publish': publish},
      ) as Map<String, dynamic>;

      await _room?.disconnect();
      final room = Room();
      _room = room;
      await room.connect(token['url'] as String, token['token'] as String);
      if (publish) {
        await room.localParticipant?.setMicrophoneEnabled(true);
      }
      if (!mounted) return;
      setState(() {
        _joinedId = call.platformCallId;
        _live = publish;
        _status = publish
            ? '🔴 You are LIVE — the candidate can hear you.'
            : '🎧 Listening — no one can hear you.';
      });
    } catch (err) {
      if (mounted) setState(() => _status = 'Could not join: $err');
    }
  }

  Future<void> _takeOver(LiveAiCall call) async {
    final sure = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Take over from the AI?'),
        content: const Text(
            'The AI stops talking immediately and the candidate hears you instead.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true), child: const Text('Take over')),
        ],
      ),
    );
    if (sure != true) return;
    try {
      await ApiClient.instance.post('/ai-calls/${call.platformCallId}/takeover');
      await _join(call, publish: true);
      _load();
    } catch (err) {
      if (mounted) setState(() => _status = 'Takeover failed: $err');
    }
  }

  Future<void> _leave({bool silent = false}) async {
    try {
      await _room?.disconnect();
    } catch (_) {}
    _room = null;
    if (!silent && mounted) {
      setState(() {
        _joinedId = null;
        _live = false;
        _status = '';
      });
    } else {
      _joinedId = null;
      _live = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('AI Calls — live')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  if (_status.isNotEmpty)
                    Container(
                      margin: const EdgeInsets.only(bottom: 12),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: _live ? const Color(0xFFFFF1F2) : const Color(0xFFEEF2FF),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Text(_status,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                              color: _live
                                  ? const Color(0xFFBE123C)
                                  : const Color(0xFF3540C9))),
                    ),
                  if (_calls.isEmpty)
                    const Padding(
                      padding: EdgeInsets.all(40),
                      child: Column(
                        children: [
                          Icon(Icons.smart_toy_outlined,
                              size: 48, color: Color(0xFF94A3B8)),
                          SizedBox(height: 12),
                          Text(
                            'No AI calls in progress.\nStart one from the dialer with the AI Call button.',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: Color(0xFF64748B)),
                          ),
                        ],
                      ),
                    ),
                  for (final call in _calls) _buildCallCard(call),
                ],
              ),
      ),
    );
  }

  Widget _buildCallCard(LiveAiCall call) {
    final joined = _joinedId == call.platformCallId;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.smart_toy, color: Color(0xFF3540C9)),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(call.contactName ?? call.phone,
                          style: const TextStyle(fontWeight: FontWeight.w700)),
                      Text(
                        '${call.phone} · ${call.seconds ~/ 60}m ${call.seconds % 60}s'
                        '${call.takenOver ? ' · taken over' : ''}',
                        style:
                            const TextStyle(fontSize: 12, color: Color(0xFF64748B)),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                if (!joined) ...[
                  OutlinedButton.icon(
                    onPressed: () => _join(call, publish: false),
                    icon: const Icon(Icons.headphones, size: 18),
                    label: const Text('Listen'),
                  ),
                  const SizedBox(width: 10),
                  if (!call.takenOver)
                    FilledButton.icon(
                      style: FilledButton.styleFrom(
                          backgroundColor: const Color(0xFFE11D48)),
                      onPressed: () => _takeOver(call),
                      icon: const Icon(Icons.record_voice_over, size: 18),
                      label: const Text('Take over'),
                    ),
                ] else
                  OutlinedButton.icon(
                    onPressed: _leave,
                    icon: const Icon(Icons.logout, size: 18),
                    label: Text(_live ? 'Leave call' : 'Stop listening'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
