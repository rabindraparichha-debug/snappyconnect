import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';

import '../api/api_client.dart';
import '../dial_intent.dart';

class VoicemailMessage {
  VoicemailMessage.fromJson(Map<String, dynamic> json)
      : id = json['id'] as String,
        fromNumber = json['fromNumber'] as String? ?? 'Unknown',
        recordingUrl = json['recordingUrl'] as String?,
        durationSeconds = (json['durationSeconds'] as num?)?.toInt() ?? 0,
        read = json['read'] == true,
        createdAt =
            DateTime.tryParse(json['createdAt'] as String? ?? '')?.toLocal();

  final String id;
  final String fromNumber;
  final String? recordingUrl;
  final int durationSeconds;
  bool read;
  final DateTime? createdAt;
}

/// Messages left when a call went unanswered: listen, mark read, delete, or
/// call the person straight back.
class VoicemailScreen extends StatefulWidget {
  const VoicemailScreen({super.key});

  @override
  State<VoicemailScreen> createState() => _VoicemailScreenState();
}

class _VoicemailScreenState extends State<VoicemailScreen> {
  List<VoicemailMessage> _items = [];
  bool _loading = true;
  String? _error;
  String? _playingId;
  final AudioPlayer _player = AudioPlayer();

  @override
  void initState() {
    super.initState();
    _load();
    _player.playerStateStream.listen((state) {
      if (state.processingState == ProcessingState.completed && mounted) {
        setState(() => _playingId = null);
      }
    });
  }

  @override
  void dispose() {
    _player.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final data = await ApiClient.instance.get('/voicemails') as List<dynamic>;
      if (!mounted) return;
      setState(() {
        _items = data
            .map((e) => VoicemailMessage.fromJson(e as Map<String, dynamic>))
            .toList();
        _loading = false;
        _error = null;
      });
    } catch (err) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Could not load voicemail: $err';
        });
      }
    }
  }

  Future<void> _togglePlay(VoicemailMessage item) async {
    if (_playingId == item.id) {
      await _player.pause();
      if (mounted) setState(() => _playingId = null);
      return;
    }
    final url = item.recordingUrl;
    if (url == null) return;
    try {
      // Recordings sit behind auth, so the player carries the token itself.
      final absolute = url.startsWith('http')
          ? url
          : '${ApiClient.instance.baseUrl.replaceFirst(RegExp(r'/api/v1$'), '')}$url';
      await _player.setAudioSource(
        AudioSource.uri(Uri.parse(absolute), headers: ApiClient.instance.authHeaders),
      );
      await _player.play();
      if (mounted) setState(() => _playingId = item.id);
      // Hearing it is what "read" means; no second tap required.
      if (!item.read) await _setRead(item, true);
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Could not play: $err')));
      }
    }
  }

  Future<void> _setRead(VoicemailMessage item, bool read) async {
    try {
      await ApiClient.instance
          .patch('/voicemails/${item.id}/read', body: {'read': read});
      if (mounted) setState(() => item.read = read);
    } catch (_) {
      // The badge is cosmetic; never interrupt listening over it.
    }
  }

  Future<void> _delete(VoicemailMessage item) async {
    final sure = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete this message?'),
        content: Text(
          'The recording from ${item.fromNumber} is deleted for good, '
          'including the audio.',
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: const Color(0xFFE11D48)),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (sure != true) return;
    try {
      await ApiClient.instance.delete('/voicemails/${item.id}');
      if (_playingId == item.id) await _player.stop();
      if (mounted) {
        setState(() {
          _items.removeWhere((v) => v.id == item.id);
          _playingId = _playingId == item.id ? null : _playingId;
        });
      }
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Could not delete: $err')));
      }
    }
  }

  String _when(DateTime? at) {
    if (at == null) return '';
    final diff = DateTime.now().difference(at);
    if (diff.inMinutes < 1) return 'just now';
    if (diff.inHours < 1) return '${diff.inMinutes}m ago';
    if (diff.inDays < 1) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return '${at.day}/${at.month}/${at.year}';
  }

  @override
  Widget build(BuildContext context) {
    final unread = _items.where((v) => !v.read).length;
    return Scaffold(
      appBar: AppBar(
        title: Text(unread > 0 ? 'Voicemail ($unread new)' : 'Voicemail'),
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _items.isEmpty
                ? ListView(
                    children: [
                      const SizedBox(height: 120),
                      Icon(Icons.voicemail_outlined,
                          size: 48, color: Colors.grey.shade400),
                      const SizedBox(height: 12),
                      Center(
                        child: Text(
                          _error ??
                              'No voicemail.\nMessages left by callers appear here.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Colors.grey.shade600),
                        ),
                      ),
                    ],
                  )
                : ListView.separated(
                    itemCount: _items.length,
                    separatorBuilder: (_, _) => const Divider(height: 1),
                    itemBuilder: (context, i) {
                      final item = _items[i];
                      final playing = _playingId == item.id;
                      return ListTile(
                        leading: IconButton(
                          icon: Icon(
                            playing ? Icons.pause_circle : Icons.play_circle,
                            size: 38,
                            color: const Color(0xFF3540C9),
                          ),
                          onPressed: () => _togglePlay(item),
                        ),
                        title: Row(
                          children: [
                            if (!item.read)
                              Container(
                                width: 8,
                                height: 8,
                                margin: const EdgeInsets.only(right: 6),
                                decoration: const BoxDecoration(
                                    color: Color(0xFF3540C9),
                                    shape: BoxShape.circle),
                              ),
                            Expanded(
                              child: Text(
                                item.fromNumber,
                                style: TextStyle(
                                  fontWeight: item.read
                                      ? FontWeight.w500
                                      : FontWeight.w700,
                                ),
                              ),
                            ),
                          ],
                        ),
                        subtitle: Text(
                          '${_when(item.createdAt)} · ${item.durationSeconds}s',
                        ),
                        trailing: PopupMenuButton<String>(
                          onSelected: (value) {
                            switch (value) {
                              case 'call':
                                DialIntent.pending.value = item.fromNumber;
                              case 'read':
                                _setRead(item, !item.read);
                              case 'delete':
                                _delete(item);
                            }
                          },
                          itemBuilder: (_) => [
                            const PopupMenuItem(
                                value: 'call', child: Text('Call back')),
                            PopupMenuItem(
                              value: 'read',
                              child:
                                  Text(item.read ? 'Mark unread' : 'Mark read'),
                            ),
                            const PopupMenuItem(
                                value: 'delete', child: Text('Delete')),
                          ],
                        ),
                      );
                    },
                  ),
      ),
    );
  }
}
