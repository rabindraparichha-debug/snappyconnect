import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:record/record.dart';

import '../api/api_client.dart';

class VoiceRequestItem {
  VoiceRequestItem.fromJson(Map<String, dynamic> json)
      : id = json['id'] as String,
        name = json['name'] as String? ?? 'My voice',
        status = json['status'] as String? ?? 'pending',
        note = json['note'] as String?,
        createdAt = DateTime.tryParse(json['createdAt'] as String? ?? '')?.toLocal();

  final String id;
  final String name;
  final String status;
  final String? note;
  final DateTime? createdAt;
}

/// Record a sample of your own voice and submit it for cloning. An admin
/// approves it before the clone is created — a voice may only be cloned with
/// its owner's consent, and each clone costs money.
class VoiceCloneScreen extends StatefulWidget {
  const VoiceCloneScreen({super.key});

  @override
  State<VoiceCloneScreen> createState() => _VoiceCloneScreenState();
}

class _VoiceCloneScreenState extends State<VoiceCloneScreen> {
  final AudioRecorder _recorder = AudioRecorder();
  final AudioPlayer _player = AudioPlayer();
  final TextEditingController _nameController = TextEditingController();

  bool _recording = false;
  bool _submitting = false;
  String? _samplePath;
  int _seconds = 0;
  Timer? _timer;
  List<VoiceRequestItem> _requests = [];
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _timer?.cancel();
    _recorder.dispose();
    _player.dispose();
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final data = await ApiClient.instance.get('/voice-requests') as List<dynamic>;
      if (!mounted) return;
      setState(() => _requests = data
          .map((e) => VoiceRequestItem.fromJson(e as Map<String, dynamic>))
          .toList());
    } catch (_) {
      // The list is secondary; recording still works without it.
    }
  }

  Future<void> _toggleRecording() async {
    if (_recording) {
      final path = await _recorder.stop();
      _timer?.cancel();
      if (mounted) {
        setState(() {
          _recording = false;
          _samplePath = path;
        });
      }
      return;
    }

    final mic = await Permission.microphone.request();
    if (!mic.isGranted) {
      setState(() => _error = 'Microphone permission is required to record.');
      return;
    }
    final dir = await getTemporaryDirectory();
    final path = '${dir.path}/voice-sample-${DateTime.now().millisecondsSinceEpoch}.m4a';
    await _recorder.start(const RecordConfig(), path: path);
    _seconds = 0;
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) async {
      if (!mounted) return;
      setState(() => _seconds++);
      // 30 seconds is plenty for a clone, and stopping on its own saves the
      // recruiter from uploading two minutes of silence.
      if (_seconds >= 30) await _toggleRecording();
    });
    setState(() {
      _recording = true;
      _error = null;
      _samplePath = null;
    });
  }

  Future<void> _playBack() async {
    final path = _samplePath;
    if (path == null) return;
    try {
      await _player.setFilePath(path);
      await _player.play();
    } catch (err) {
      setState(() => _error = 'Could not play that back: $err');
    }
  }

  Future<void> _submit() async {
    final path = _samplePath;
    if (path == null) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ApiClient.instance.uploadFile(
        '/voice-requests',
        path,
        fields: {
          'name': _nameController.text.trim().isEmpty
              ? 'My voice'
              : _nameController.text.trim(),
        },
      );
      await File(path).delete().catchError((_) => File(path));
      if (mounted) {
        setState(() {
          _samplePath = null;
          _nameController.clear();
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Sent for approval.')),
        );
      }
      await _load();
    } catch (err) {
      if (mounted) setState(() => _error = '$err');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  String _statusLabel(VoiceRequestItem r) => switch (r.status) {
        'approved' => 'Approved — ready to use',
        'rejected' => r.note ?? 'Not approved',
        _ => 'Waiting for approval',
      };

  Color _statusColor(String status) => switch (status) {
        'approved' => const Color(0xFF059669),
        'rejected' => const Color(0xFFE11D48),
        _ => const Color(0xFFB45309),
      };

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('My AI voice')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text(
            'Record 15–30 seconds of natural speech somewhere quiet. An admin '
            'approves it before the voice is created. Only record yourself, or '
            'someone who has agreed to it.',
            style: TextStyle(fontSize: 13, color: Color(0xFF64748B)),
          ),
          const SizedBox(height: 20),
          Center(
            child: Column(
              children: [
                IconButton.filled(
                  iconSize: 44,
                  padding: const EdgeInsets.all(20),
                  style: IconButton.styleFrom(
                    backgroundColor:
                        _recording ? const Color(0xFFE11D48) : const Color(0xFF3540C9),
                  ),
                  onPressed: _submitting ? null : _toggleRecording,
                  icon: Icon(_recording ? Icons.stop : Icons.mic),
                ),
                const SizedBox(height: 10),
                Text(
                  _recording
                      ? 'Recording… ${_seconds}s (stops at 30)'
                      : _samplePath != null
                          ? 'Sample ready'
                          : 'Tap to record',
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ],
            ),
          ),
          if (_samplePath != null) ...[
            const SizedBox(height: 16),
            TextField(
              controller: _nameController,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: 'Voice name',
                hintText: 'e.g. My voice',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                OutlinedButton.icon(
                  onPressed: _submitting ? null : _playBack,
                  icon: const Icon(Icons.play_arrow, size: 18),
                  label: const Text('Hear it'),
                ),
                const SizedBox(width: 10),
                OutlinedButton.icon(
                  onPressed: _submitting ? null : _toggleRecording,
                  icon: const Icon(Icons.refresh, size: 18),
                  label: const Text('Record again'),
                ),
                const Spacer(),
                FilledButton(
                  onPressed: _submitting ? null : _submit,
                  child: Text(_submitting ? 'Sending…' : 'Submit'),
                ),
              ],
            ),
          ],
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: Color(0xFFE11D48))),
          ],
          const SizedBox(height: 28),
          const Text('My submissions',
              style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          if (_requests.isEmpty)
            const Text('Nothing submitted yet.',
                style: TextStyle(color: Color(0xFF94A3B8)))
          else
            for (final r in _requests)
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(r.name),
                subtitle: Text(
                  _statusLabel(r),
                  style: TextStyle(color: _statusColor(r.status)),
                ),
                trailing: IconButton(
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () async {
                    try {
                      await ApiClient.instance.delete('/voice-requests/${r.id}');
                      await _load();
                    } catch (err) {
                      if (mounted) setState(() => _error = '$err');
                    }
                  },
                ),
              ),
        ],
      ),
    );
  }
}
