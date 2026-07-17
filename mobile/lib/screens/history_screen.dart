import 'dart:io';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../api/api_client.dart';
import '../models.dart';
import '../services/native_dialer_service.dart';

class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key});

  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  List<CallLogItem> _calls = [];
  bool _loading = true;
  String? _error;
  bool _syncing = false;

  bool get _canSyncDeviceLog =>
      Platform.isAndroid && ApiClient.instance.currentUser?.provider == 'native_dialer';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await ApiClient.instance.get('/calls', query: {'limit': '50'})
          as Map<String, dynamic>;
      setState(() {
        _calls = (data['items'] as List<dynamic>)
            .map((item) => CallLogItem.fromJson(item as Map<String, dynamic>))
            .toList();
        _error = null;
        _loading = false;
      });
    } catch (err) {
      setState(() {
        _error = err.toString();
        _loading = false;
      });
    }
  }

  Future<void> _syncDeviceCalls() async {
    setState(() => _syncing = true);
    try {
      final service = NativeDialerService();
      final imported = await service.syncRecentCalls();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Synced $imported call(s) from this device.')),
      );
      await _load();
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Sync failed: $err')));
      }
    } finally {
      if (mounted) setState(() => _syncing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Call History'),
        actions: [
          if (_canSyncDeviceLog)
            IconButton(
              tooltip: 'Sync device call log',
              onPressed: _syncing ? null : _syncDeviceCalls,
              icon: _syncing
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.sync),
            ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? ListView(
                    children: [
                      Padding(
                        padding: const EdgeInsets.all(24),
                        child: Text(_error!, textAlign: TextAlign.center),
                      ),
                    ],
                  )
                : _calls.isEmpty
                    ? ListView(
                        children: const [
                          Padding(
                            padding: EdgeInsets.all(48),
                            child: Column(
                              children: [
                                Icon(Icons.call_outlined, size: 48, color: Color(0xFF94A3B8)),
                                SizedBox(height: 12),
                                Text('No calls yet',
                                    textAlign: TextAlign.center,
                                    style: TextStyle(color: Color(0xFF64748B))),
                              ],
                            ),
                          ),
                        ],
                      )
                    : ListView.separated(
                        itemCount: _calls.length,
                        separatorBuilder: (context, index) => const Divider(height: 1),
                        itemBuilder: (context, index) => _CallTile(call: _calls[index]),
                      ),
      ),
    );
  }
}

class _CallTile extends StatelessWidget {
  const _CallTile({required this.call});

  final CallLogItem call;

  @override
  Widget build(BuildContext context) {
    final answered = call.status == 'completed' || call.status == 'answered';
    final missed = call.status == 'missed' || call.status == 'no_answer';
    final icon = call.direction == 'inbound'
        ? (missed ? Icons.call_missed : Icons.call_received)
        : Icons.call_made;
    final color = missed
        ? const Color(0xFFE11D48)
        : answered
            ? const Color(0xFF059669)
            : const Color(0xFF64748B);

    final when = call.startedAt != null
        ? DateFormat('d MMM, HH:mm').format(call.startedAt!.toLocal())
        : '—';
    final duration = call.durationSeconds > 0
        ? '${call.durationSeconds ~/ 60}m ${call.durationSeconds % 60}s'
        : '';

    return ListTile(
      leading: CircleAvatar(
        backgroundColor: color.withValues(alpha: 0.1),
        child: Icon(icon, color: color, size: 20),
      ),
      title: Text(call.phoneNumber, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text('$when · ${call.status.replaceAll('_', ' ')}'),
      trailing: Text(duration, style: const TextStyle(color: Color(0xFF64748B))),
    );
  }
}
