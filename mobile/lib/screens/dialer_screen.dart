import 'dart:async';

import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

import '../api/api_client.dart';
import '../models.dart';
import '../services/native_dialer_service.dart';
import '../services/telnyx_call_service.dart';

class DialerScreen extends StatefulWidget {
  const DialerScreen({super.key});

  @override
  State<DialerScreen> createState() => _DialerScreenState();
}

class _DialerScreenState extends State<DialerScreen> with WidgetsBindingObserver {
  final _numberController = TextEditingController();
  final _nativeDialer = NativeDialerService();
  final _telnyx = TelnyxCallService();

  User? get _user => ApiClient.instance.currentUser;

  String _status = '';
  bool _busy = false;
  bool _inTelnyxCall = false;
  DateTime? _telnyxAnsweredAt;
  DateTime? _telnyxDialedAt;
  int _elapsed = 0;
  Timer? _elapsedTimer;

  // Native-dialer bookkeeping: the request we are currently completing.
  CallRequest? _activeRequest;
  DateTime? _dialedAt;

  // Polling for click-to-call requests coming from the web / extension.
  Timer? _pollTimer;
  final Set<String> _seenRequests = {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    if (_user?.provider == 'native_dialer') {
      _pollTimer = Timer.periodic(const Duration(seconds: 5), (_) => _pollPendingRequests());
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _pollTimer?.cancel();
    _elapsedTimer?.cancel();
    _telnyx.dispose();
    super.dispose();
  }

  // ---------- Incoming click-to-call requests (browser -> mobile) ----------

  Future<void> _pollPendingRequests() async {
    if (_activeRequest != null || !mounted) return;
    try {
      final data = await ApiClient.instance.get('/calls/requests/pending') as List<dynamic>;
      if (data.isEmpty) return;
      final request = CallRequest.fromJson(data.first as Map<String, dynamic>);
      if (_seenRequests.contains(request.id)) return;
      _seenRequests.add(request.id);
      if (!mounted) return;

      final accepted = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Call request'),
          content: Text('Call ${request.phoneNumber}? (requested from your browser)'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Dismiss'),
            ),
            FilledButton.icon(
              onPressed: () => Navigator.pop(context, true),
              icon: const Icon(Icons.call),
              label: const Text('Call'),
            ),
          ],
        ),
      );

      if (accepted == true) {
        await _dialNativeRequest(request);
      } else {
        await ApiClient.instance.post('/calls/requests/${request.id}/cancel');
      }
    } catch (_) {
      // Polling errors are transient; try again on the next tick.
    }
  }

  // ---------- Outbound calls ----------

  Future<void> _call() async {
    final number = _numberController.text.trim();
    if (number.isEmpty || _busy) return;
    setState(() {
      _busy = true;
      _status = '';
    });

    try {
      switch (_user?.provider) {
        case 'native_dialer':
          await _callViaNativeDialer(number);
        case 'telnyx':
          await _callViaTelnyx(number);
        case 'grandstream':
          final result = await ApiClient.instance
              .post('/calls/initiate', body: {'phoneNumber': number, 'source': 'mobile'});
          setState(() => _status = (result as Map<String, dynamic>)['message'] as String);
        default:
          setState(() => _status = 'No calling provider assigned — ask your administrator.');
      }
    } catch (err) {
      setState(() => _status = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _callViaNativeDialer(String number) async {
    // Register the request so the call appears in SnappyConnect history.
    final result = await ApiClient.instance
        .post('/calls/initiate', body: {'phoneNumber': number, 'source': 'mobile'});
    final requestId = (result as Map<String, dynamic>)['requestId'] as String;
    _seenRequests.add(requestId);
    await ApiClient.instance.post('/calls/requests/$requestId/ack');
    _activeRequest = CallRequest(id: requestId, phoneNumber: number, createdAt: DateTime.now());
    _dialedAt = DateTime.now();
    setState(() => _status = 'Opening dialer…');
    await _nativeDialer.openDialer(number);
  }

  Future<void> _dialNativeRequest(CallRequest request) async {
    await ApiClient.instance.post('/calls/requests/${request.id}/ack');
    _activeRequest = request;
    _dialedAt = DateTime.now();
    await _nativeDialer.openDialer(request.phoneNumber);
  }

  /// When the app comes back after a native call, sync the outcome.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _activeRequest != null) {
      _completeNativeCall();
    }
  }

  Future<void> _completeNativeCall() async {
    final request = _activeRequest!;
    final dialedAt = _dialedAt ?? DateTime.now();
    _activeRequest = null;

    // Give the OS a moment to write the call log entry.
    await Future.delayed(const Duration(seconds: 2));
    final deviceResult = await _nativeDialer.lookupLastCall(request.phoneNumber, dialedAt);

    int duration = deviceResult?.durationSeconds ?? 0;
    bool answered = deviceResult?.answered ?? false;

    if (deviceResult == null && mounted) {
      // iOS (or denied permission): ask the user.
      final manual = await _askOutcome(request.phoneNumber);
      if (manual == null) {
        await ApiClient.instance.post('/calls/requests/${request.id}/cancel');
        return;
      }
      duration = manual.$1;
      answered = manual.$2;
    }

    try {
      await ApiClient.instance.post('/calls/requests/${request.id}/complete', body: {
        'status': answered ? 'completed' : 'no_answer',
        'durationSeconds': duration,
        'startedAt': dialedAt.toUtc().toIso8601String(),
      });
      if (mounted) {
        setState(() => _status = answered
            ? 'Call synced (${duration}s).'
            : 'Call logged as not answered.');
      }
    } catch (err) {
      if (mounted) setState(() => _status = 'Sync failed: $err');
    }
  }

  Future<(int, bool)?> _askOutcome(String number) {
    final durationController = TextEditingController();
    return showModalBottomSheet<(int, bool)>(
      context: context,
      isScrollControlled: true,
      builder: (context) => Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 20,
          bottom: MediaQuery.of(context).viewInsets.bottom + 20,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('How did the call to $number go?',
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
            const SizedBox(height: 16),
            TextField(
              controller: durationController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Duration (seconds)'),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.pop(context, (0, false)),
                    child: const Text('Not answered'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton(
                    onPressed: () => Navigator.pop(
                      context,
                      (int.tryParse(durationController.text) ?? 0, true),
                    ),
                    child: const Text('Answered'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  // ---------- Telnyx (WebRTC over the user's data connection) ----------

  Future<void> _callViaTelnyx(String number) async {
    final mic = await Permission.microphone.request();
    if (!mic.isGranted) {
      setState(() => _status = 'Microphone permission is required for VoIP calls.');
      return;
    }

    final tokenData =
        await ApiClient.instance.post('/calls/telnyx/token') as Map<String, dynamic>;
    _telnyxDialedAt = DateTime.now();
    _telnyxAnsweredAt = null;
    setState(() {
      _inTelnyxCall = true;
      _status = 'Connecting…';
    });

    await _telnyx.startCall(
      sipToken: tokenData['token'] as String,
      callerName: _user?.name ?? 'SnappyConnect',
      callerNumber: _user?.mobileNumber ?? '',
      destination: number,
      onState: (state, detail) {
        if (!mounted) return;
        switch (state) {
          case TelnyxCallUiState.connecting:
            setState(() => _status = 'Connecting…');
          case TelnyxCallUiState.ringing:
            setState(() => _status = 'Ringing…');
          case TelnyxCallUiState.active:
            _telnyxAnsweredAt ??= DateTime.now();
            _elapsedTimer?.cancel();
            _elapsedTimer = Timer.periodic(const Duration(seconds: 1), (_) {
              if (mounted && _telnyxAnsweredAt != null) {
                setState(() =>
                    _elapsed = DateTime.now().difference(_telnyxAnsweredAt!).inSeconds);
              }
            });
            setState(() => _status = 'In call');
          case TelnyxCallUiState.ended:
            _finishTelnyxCall(number);
          case TelnyxCallUiState.error:
            setState(() {
              _inTelnyxCall = false;
              _status = detail ?? 'Call error';
            });
            _telnyx.dispose();
        }
      },
    );
  }

  Future<void> _finishTelnyxCall(String number) async {
    _elapsedTimer?.cancel();
    final answered = _telnyxAnsweredAt != null;
    final duration =
        answered ? DateTime.now().difference(_telnyxAnsweredAt!).inSeconds : 0;
    setState(() {
      _inTelnyxCall = false;
      _elapsed = 0;
      _status = answered ? 'Call ended (${duration}s)' : 'Call ended — not answered';
    });
    _telnyx.dispose();

    try {
      await ApiClient.instance.post('/calls/log', body: {
        'phoneNumber': number,
        'direction': 'outbound',
        'status': answered ? 'completed' : 'no_answer',
        'durationSeconds': duration,
        'startedAt': _telnyxDialedAt?.toUtc().toIso8601String(),
        'endedAt': DateTime.now().toUtc().toIso8601String(),
      });
    } catch (_) {
      // Telnyx webhooks are the fallback source of truth.
    }
  }

  // ---------- UI ----------

  @override
  Widget build(BuildContext context) {
    final providerLabel = _user?.providerLabel ?? 'Unassigned';

    return Scaffold(
      appBar: AppBar(title: const Text('Dialer')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            children: [
              Chip(
                avatar: const Icon(Icons.sim_card_outlined, size: 18),
                label: Text(providerLabel),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _numberController,
                keyboardType: TextInputType.phone,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w600),
                decoration: const InputDecoration(hintText: '+91 98765 43210'),
              ),
              const SizedBox(height: 12),
              if (_status.isNotEmpty)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFFEEF2FF),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    _inTelnyxCall && _elapsed > 0 ? '$_status · ${_elapsed}s' : _status,
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Color(0xFF3540C9)),
                  ),
                ),
              const Spacer(),
              _Keypad(
                enabled: !_inTelnyxCall,
                onKey: (key) => _numberController.text += key,
                onBackspace: () {
                  final text = _numberController.text;
                  if (text.isNotEmpty) {
                    _numberController.text = text.substring(0, text.length - 1);
                  }
                },
              ),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                height: 54,
                child: _inTelnyxCall
                    ? FilledButton.icon(
                        style: FilledButton.styleFrom(backgroundColor: const Color(0xFFE11D48)),
                        onPressed: () => _telnyx.hangup(),
                        icon: const Icon(Icons.call_end),
                        label: const Text('Hang up'),
                      )
                    : FilledButton.icon(
                        style: FilledButton.styleFrom(backgroundColor: const Color(0xFF059669)),
                        onPressed: _busy ? null : _call,
                        icon: const Icon(Icons.call),
                        label: Text(_busy ? 'Calling…' : 'Call'),
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Keypad extends StatelessWidget {
  const _Keypad({required this.onKey, required this.onBackspace, this.enabled = true});

  final void Function(String) onKey;
  final VoidCallback onBackspace;
  final bool enabled;

  static const _keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (var row = 0; row < 4; row++)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (var col = 0; col < 3; col++)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    child: _key(_keys[row * 3 + col]),
                  ),
              ],
            ),
          ),
        Align(
          alignment: Alignment.centerRight,
          child: IconButton(
            onPressed: enabled ? onBackspace : null,
            icon: const Icon(Icons.backspace_outlined),
          ),
        ),
      ],
    );
  }

  Widget _key(String value) {
    return SizedBox(
      width: 72,
      height: 56,
      child: Material(
        color: Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: const BorderSide(color: Color(0xFFE2E8F0)),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: enabled ? () => onKey(value) : null,
          child: Center(
            child: Text(
              value,
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
            ),
          ),
        ),
      ),
    );
  }
}
