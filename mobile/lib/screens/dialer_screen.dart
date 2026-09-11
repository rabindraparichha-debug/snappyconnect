import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:permission_handler/permission_handler.dart';

import 'package:flutter_webrtc/flutter_webrtc.dart' show Helper;

import '../api/api_client.dart';
import '../dial_intent.dart';
import '../models.dart';
import '../region.dart';
import '../services/asterisk_call_service.dart';
import '../services/call_service_keeper.dart';
import 'ai_calls_screen.dart';
import 'incoming_call_screen.dart';
import '../services/native_dialer_service.dart';
import '../services/push_service.dart';
import '../services/telnyx_call_service.dart';

class DialerScreen extends StatefulWidget {
  const DialerScreen({super.key, this.debugStartInCall = false});

  /// Test-only: renders the in-call layout so the "everything on one screen,
  /// no scrolling" requirement can be asserted without a live call.
  @visibleForTesting
  final bool debugStartInCall;

  @override
  State<DialerScreen> createState() => _DialerScreenState();
}

class _DialerScreenState extends State<DialerScreen> with WidgetsBindingObserver {
  final _numberController = TextEditingController();
  final _nativeDialer = NativeDialerService();
  final _telnyx = TelnyxCallService();
  final _asterisk = AsteriskCallService();

  User? get _user => ApiClient.instance.currentUser;

  String _status = '';
  bool _busy = false;
  bool _inTelnyxCall = false;
  bool _muted = false;
  bool _held = false;
  bool _speakerOn = false;
  DateTime? _telnyxAnsweredAt;
  DateTime? _telnyxDialedAt;
  int _elapsed = 0;
  Timer? _elapsedTimer;

  // Native-dialer bookkeeping: the request we are currently completing.
  CallRequest? _activeRequest;
  DateTime? _dialedAt;

  // Set while an inbound (return) call is in progress, so it is logged as such.
  String? _inboundNumber;

  /// Region the next call goes out on. Auto-follows the typed number's dial
  /// code, but the user can override it with the chips.
  String? _region;
  bool _regionPinned = false;

  // Polling for click-to-call requests coming from the web / extension.
  Timer? _pollTimer;
  StreamSubscription<dynamic>? _pushSub;
  final Set<String> _seenRequests = {};

  @override
  void initState() {
    super.initState();
    _inTelnyxCall = widget.debugStartInCall;
    if (widget.debugStartInCall) _status = 'In call';
    WidgetsBinding.instance.addObserver(this);
    if ((_user?.allowedRegions ?? const []).contains(Regions.india)) {
      _pollTimer = Timer.periodic(const Duration(seconds: 5), (_) => _pollPendingRequests());
    }
    final allowed = _user?.allowedRegions ?? const [];
    _region = allowed.isNotEmpty ? allowed.first : null;
    if (allowed.contains(Regions.uae)) {
      // Register right away so return calls from candidates ring this device.
      _connectAsterisk();
    }
    if (allowed.contains(Regions.usa)) {
      // Same for the Telnyx line: stay registered so US calls ring the phone.
      _connectTelnyxListener();
      _listenForPushedCalls();
    }
    _numberController.addListener(_autoSelectRegion);
    DialIntent.pending.addListener(_onDialIntent);
  }

  /// A number handed over from History or Messages ("call this person").
  void _onDialIntent() {
    final number = DialIntent.pending.value;
    if (number == null || !mounted) return;
    _numberController.text = number;
  }

  Future<void> _connectTelnyxListener() async {
    try {
      await _telnyx.listen(
        mintToken: () async =>
            await ApiClient.instance.post('/calls/telnyx/token') as Map<String, dynamic>,
        onIncomingCall: _onTelnyxIncoming,
        callerName: _user?.name ?? 'SnappyConnect',
      );
      await CallServiceKeeper.start(line: 'USA line');
      if (mounted && _status.isEmpty) setState(() => _status = 'Ready for calls');
    } catch (_) {
      // Not fatal: the service retries, and outbound dialing reconnects too.
    }
  }

  /// A call that arrived as a push shows the OS call screen before Dart is
  /// involved, so answering there — not in our own UI — is what has to reach
  /// Telnyx. Without this the native screen appears and answering does nothing.
  void _listenForPushedCalls() {
    _pushSub?.cancel();
    _pushSub = PushService.listen(
      onIncoming: (_) {
        // CallKit is already showing the call; nothing to do until the
        // recruiter answers or declines.
      },
      onAccept: (metadata) => _answerPushedCall(metadata, answer: true),
      onDecline: (metadata) => _answerPushedCall(metadata, answer: false),
      onEnded: () {
        if (mounted && _inTelnyxCall) setState(() => _inTelnyxCall = false);
      },
    );
  }

  Future<void> _answerPushedCall(
    Map<dynamic, dynamic> metadata, {
    required bool answer,
  }) async {
    _inboundNumber = (metadata['caller_number'] as String?) ?? _inboundNumber;
    if (answer && mounted) {
      _telnyxDialedAt = DateTime.now();
      _telnyxAnsweredAt = null;
      setState(() {
        _inTelnyxCall = true;
        _status = 'Connecting…';
      });
    }
    await _telnyx.handlePush(
      metadata,
      mintToken: () async =>
          await ApiClient.instance.post('/calls/telnyx/token') as Map<String, dynamic>,
      onState: _makeTelnyxStateHandler(_inboundNumber ?? 'Unknown', inbound: true),
      callerName: _user?.name ?? 'SnappyConnect',
      answer: answer,
      decline: !answer,
    );
    if (!answer) await PushService.endAllCalls();
  }

  Future<void> _onTelnyxIncoming(String fromNumber) async {
    if (!mounted) return;
    FlutterForegroundTask.launchApp();
    if (!mounted) return;
    final accept = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) =>
            IncomingCallScreen(fromNumber: fromNumber, lineLabel: 'USA line'),
      ),
    );

    if (accept == true) {
      _inboundNumber = fromNumber;
      _telnyxDialedAt = DateTime.now();
      _telnyxAnsweredAt = null;
      setState(() {
        _inTelnyxCall = true;
        _status = 'Connecting…';
      });
      _telnyx.answerIncoming(onState: _makeTelnyxStateHandler(fromNumber, inbound: true));
    } else {
      _telnyx.declineIncoming();
      try {
        await ApiClient.instance.post('/calls/log', body: {
          'phoneNumber': fromNumber,
          'direction': 'inbound',
          'status': 'missed',
          'durationSeconds': 0,
          'startedAt': DateTime.now().toUtc().toIso8601String(),
          'endedAt': DateTime.now().toUtc().toIso8601String(),
        });
      } catch (_) {}
    }
  }

  /// Follow the typed number's country code unless the user picked a region.
  void _autoSelectRegion() {
    if (_regionPinned) return;
    final guess = Regions.fromNumber(_numberController.text);
    final allowed = _user?.allowedRegions ?? const [];
    if (guess != null && guess != _region && allowed.contains(guess)) {
      setState(() => _region = guess);
    }
  }

  /// Keep a SIP registration alive so inbound (return) calls can ring here.
  Future<void> _connectAsterisk() async {
    try {
      final mic = await Permission.microphone.request();
      if (!mic.isGranted) return;
      await CallServiceKeeper.requestPermissions();
      final cfg = await ApiClient.instance.get('/calls/asterisk/config') as Map<String, dynamic>;
      await _asterisk.connect(
        wssUrl: cfg['wssUrl'] as String,
        sipDomain: cfg['sipDomain'] as String,
        sipUsername: cfg['sipUsername'] as String,
        sipPassword: cfg['sipPassword'] as String,
        displayName: (cfg['displayName'] as String?) ?? 'SnappyConnect',
        onState: _onAsteriskState,
        onIncoming: _onIncomingCall,
      );
      await CallServiceKeeper.start(
        line: (cfg['sipUsername'] as String?) ?? 'SIP',
      );
      if (mounted) setState(() => _status = 'Ready for calls');
    } catch (_) {
      // Not fatal: outbound dialing will retry the connection.
    }
  }

  Future<void> _onIncomingCall(dynamic call, String fromNumber) async {
    if (!mounted) return;
    // Bring the app forward if it is in the background, then ring full-screen.
    FlutterForegroundTask.launchApp();
    if (!mounted) return;
    final accept = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => IncomingCallScreen(fromNumber: fromNumber),
      ),
    );

    if (accept == true) {
      _inboundNumber = fromNumber;
      _telnyxDialedAt = DateTime.now();
      _telnyxAnsweredAt = null;
      setState(() {
        _inTelnyxCall = true;
        _status = 'Connecting…';
      });
      _asterisk.answer(call);
    } else {
      _asterisk.decline(call);
    }
  }

  void _onAsteriskState(AsteriskCallUiState state, String? detail) {
    if (!mounted) return;
    final number = _inboundNumber ?? _numberController.text.trim();
    switch (state) {
      case AsteriskCallUiState.registering:
        setState(() => _status = 'Connecting to call server…');
      case AsteriskCallUiState.connecting:
        setState(() => _status = 'Connecting…');
      case AsteriskCallUiState.ringing:
        setState(() => _status = 'Ringing…');
      case AsteriskCallUiState.active:
        _telnyxAnsweredAt ??= DateTime.now();
        _elapsedTimer?.cancel();
        _elapsedTimer = Timer.periodic(const Duration(seconds: 1), (_) {
          if (mounted && _telnyxAnsweredAt != null) {
            setState(() => _elapsed = DateTime.now().difference(_telnyxAnsweredAt!).inSeconds);
          }
        });
        setState(() {
          _inTelnyxCall = true;
          _status = 'In call';
        });
      case AsteriskCallUiState.ended:
        _finishVoipCall(number, inbound: _inboundNumber != null);
        _inboundNumber = null;
      case AsteriskCallUiState.error:
        if (_telnyxAnsweredAt != null) {
          _finishVoipCall(number, inbound: _inboundNumber != null);
          _inboundNumber = null;
        } else {
          setState(() {
            _inTelnyxCall = false;
            _status = detail ?? 'Call error';
          });
        }
    }
  }

  @override
  void dispose() {
    DialIntent.pending.removeListener(_onDialIntent);
    WidgetsBinding.instance.removeObserver(this);
    _pollTimer?.cancel();
    _elapsedTimer?.cancel();
    _pushSub?.cancel();
    _telnyx.dispose();
    _asterisk.dispose();
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
      switch (_region) {
        case Regions.india:
          await _callViaNativeDialer(number);
        case Regions.usa:
          await _callViaTelnyx(number);
        case Regions.uae:
          if (_user?.provider == 'grandstream') {
            final result = await ApiClient.instance.post('/calls/initiate',
                body: {'phoneNumber': number, 'source': 'mobile', 'region': _region});
            setState(() => _status = (result as Map<String, dynamic>)['message'] as String);
          } else {
            await _callViaAsterisk(number);
          }
        default:
          setState(() => _status = 'No calling region assigned — ask your administrator.');
      }
    } catch (err) {
      setState(() => _status = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _callViaNativeDialer(String number) async {
    // Register the request so the call appears in SnappyConnect history.
    final result = await ApiClient.instance.post('/calls/initiate',
        body: {'phoneNumber': number, 'source': 'mobile', 'region': Regions.india});
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
    if (state == AppLifecycleState.resumed) {
      // Android freezes sockets while the app is backgrounded, so the
      // registration is often dead on return. Re-check immediately rather
      // than waiting for the next heartbeat.
      if (_region != Regions.uae) _telnyx.ensureConnected();
      if (_activeRequest != null) _completeNativeCall();
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

  /// Telnyx only accepts full international numbers: "646 555 4468" must go
  /// out as "+16465554468" or the call is rejected the moment it starts.
  static String _toUsE164(String raw) {
    final digits = raw.replaceAll(RegExp(r'[^\d+]'), '');
    if (digits.startsWith('+')) return digits;
    if (digits.length == 10) return '+1$digits';
    if (digits.length == 11 && digits.startsWith('1')) return '+$digits';
    return '+$digits';
  }

  /// Shared UI handler for Telnyx calls (outbound and answered inbound).
  TelnyxStateCallback _makeTelnyxStateHandler(String number, {bool inbound = false}) {
    return (state, detail) {
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
          if (inbound) {
            _finishVoipCall(number, inbound: true);
            _inboundNumber = null;
          } else {
            _finishTelnyxCall(number);
          }
        case TelnyxCallUiState.error:
          if (_telnyxAnsweredAt != null) {
            // A drop mid-call still gets logged with its duration.
            if (inbound) {
              _finishVoipCall(number, inbound: true);
              _inboundNumber = null;
            } else {
              _finishTelnyxCall(number);
            }
          } else if (_inTelnyxCall) {
            setState(() {
              _inTelnyxCall = false;
              _status = detail ?? 'Call error';
            });
            _resetCallControls();
          }
      }
    };
  }

  Future<void> _callViaTelnyx(String rawNumber) async {
    final number = _toUsE164(rawNumber);
    final mic = await Permission.microphone.request();
    if (!mic.isGranted) {
      setState(() => _status = 'Microphone permission is required for VoIP calls.');
      return;
    }

    _telnyxDialedAt = DateTime.now();
    _telnyxAnsweredAt = null;
    setState(() {
      _inTelnyxCall = true;
      _status = 'Connecting…';
    });

    await _telnyx.startCall(
      callerName: _user?.name ?? 'SnappyConnect',
      destination: number,
      mintToken: () async =>
          await ApiClient.instance.post('/calls/telnyx/token') as Map<String, dynamic>,
      onState: _makeTelnyxStateHandler(number),
    );
  }

  // ---------- In-call controls ----------

  void _toggleMute() {
    if (_region == Regions.uae) {
      _asterisk.toggleMute();
      setState(() => _muted = _asterisk.muted);
    } else {
      _telnyx.toggleMute();
      setState(() => _muted = _telnyx.muted);
    }
  }

  void _toggleHold() {
    if (_region == Regions.uae) {
      _asterisk.toggleHold();
      setState(() => _held = _asterisk.held);
    } else {
      _telnyx.toggleHold();
      setState(() => _held = _telnyx.held);
    }
  }

  void _sendDtmf(String tone) {
    if (_region == Regions.uae) {
      _asterisk.dtmf(tone);
    } else {
      _telnyx.dtmf(tone);
    }
  }

  static String _formatDuration(int seconds) {
    final m = seconds ~/ 60;
    final s = seconds % 60;
    return '$m:${s.toString().padLeft(2, '0')}';
  }

  Future<void> _toggleSpeaker() async {
    final next = !_speakerOn;
    try {
      await Helper.setSpeakerphoneOn(next);
      setState(() => _speakerOn = next);
    } catch (_) {
      // Some devices refuse before audio starts; the button just stays put.
    }
  }

  void _resetCallControls() {
    _muted = false;
    _held = false;
    if (_speakerOn) {
      _speakerOn = false;
      Helper.setSpeakerphoneOn(false).catchError((_) {});
    }
  }

  /// UAE calls only: hand the caller to a teammate's extension, the
  /// conference room, or any number (SIP REFER — Asterisk does the rest).
  Future<void> _transferCall() async {
    final controller = TextEditingController();
    final target = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Transfer call'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: controller,
              autofocus: true,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                labelText: 'Extension or number',
                hintText: '2001',
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              '2001–2025 ring teammates. 6999 is the team conference room — '
              'transfer the caller there, then dial 6999 yourself for a '
              'three-way call.',
              style: TextStyle(fontSize: 12, color: Color(0xFF64748B)),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Transfer'),
          ),
        ],
      ),
    );
    if (target == null || target.isEmpty) return;
    _asterisk.transfer(target);
    if (mounted) setState(() => _status = 'Transferring to $target…');
  }

  // ---------- AI calling (USA) ----------

  /// Full international format for whichever region is selected.
  String _toE164ForRegion(String raw) {
    final digits = raw.replaceAll(RegExp(r'[^\d+]'), '');
    if (digits.startsWith('+')) return digits;
    if (_region == Regions.uae) {
      if (digits.startsWith('00971')) return '+${digits.substring(2)}';
      if (digits.startsWith('971')) return '+$digits';
      if (digits.startsWith('0')) return '+971${digits.substring(1)}';
      return '+971$digits';
    }
    return _toUsE164(raw);
  }

  Future<void> _startAiCall() async {
    final raw = _numberController.text.trim();
    if (raw.isEmpty) {
      setState(() => _status = 'Type the number the AI should call.');
      return;
    }
    final number = _toE164ForRegion(raw);
    final goalController = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('AI call $number'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'The AI agent makes the call and reports the result to your '
              'call history. You can listen in or take over from the AI Calls '
              'page on the dashboard.',
              style: TextStyle(fontSize: 13),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: goalController,
              maxLines: 2,
              decoration: const InputDecoration(
                labelText: 'What should it achieve? (optional)',
                hintText: 'e.g. Confirm interview availability this week',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton.icon(
            onPressed: () => Navigator.pop(ctx, true),
            icon: const Icon(Icons.smart_toy_outlined),
            label: const Text('Start AI call'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    setState(() => _busy = true);
    try {
      await ApiClient.instance.post('/ai-calls', body: {
        'phoneNumber': number,
        if (goalController.text.trim().isNotEmpty)
          'goalPrompt': goalController.text.trim(),
      });
      if (mounted) {
        setState(() =>
            _status = 'AI agent is calling $number — tap the robot icon (top right) to listen in.');
      }
    } catch (err) {
      if (mounted) setState(() => _status = 'AI call failed: $err');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // ---------- Asterisk (in-app SIP over encrypted WebSocket, UAE) ----------

  Future<void> _callViaAsterisk(String number) async {
    final mic = await Permission.microphone.request();
    if (!mic.isGranted) {
      setState(() => _status = 'Microphone permission is required for VoIP calls.');
      return;
    }

    final cfg = await ApiClient.instance.get('/calls/asterisk/config') as Map<String, dynamic>;
    _telnyxDialedAt = DateTime.now();
    _telnyxAnsweredAt = null;
    setState(() {
      _inTelnyxCall = true;
      _status = 'Connecting…';
    });

    await _asterisk.startCall(
      wssUrl: cfg['wssUrl'] as String,
      sipDomain: cfg['sipDomain'] as String,
      sipUsername: cfg['sipUsername'] as String,
      sipPassword: cfg['sipPassword'] as String,
      displayName: (cfg['displayName'] as String?) ?? 'SnappyConnect',
      destination: number,
      onState: _onAsteriskState,
    );
  }

  Future<void> _finishVoipCall(String number, {bool inbound = false}) async {
    _elapsedTimer?.cancel();
    _resetCallControls();
    final answered = _telnyxAnsweredAt != null;
    final duration =
        answered ? DateTime.now().difference(_telnyxAnsweredAt!).inSeconds : 0;
    setState(() {
      _inTelnyxCall = false;
      _elapsed = 0;
      _status = answered ? 'Call ended (${duration}s)' : 'Call ended — not answered';
    });

    try {
      await ApiClient.instance.post('/calls/log', body: {
        'phoneNumber': number,
        'direction': inbound ? 'inbound' : 'outbound',
        'status': answered ? 'completed' : (inbound ? 'missed' : 'no_answer'),
        'durationSeconds': duration,
        'startedAt': _telnyxDialedAt?.toUtc().toIso8601String(),
        'endedAt': DateTime.now().toUtc().toIso8601String(),
      });
    } catch (_) {
      // History sync failure shouldn't break the UI.
    }
  }

  Future<void> _finishTelnyxCall(String number) async {
    _elapsedTimer?.cancel();
    _resetCallControls();
    final answered = _telnyxAnsweredAt != null;
    final duration =
        answered ? DateTime.now().difference(_telnyxAnsweredAt!).inSeconds : 0;
    setState(() {
      _inTelnyxCall = false;
      _elapsed = 0;
      _status = answered ? 'Call ended (${duration}s)' : 'Call ended — not answered';
    });

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
    final regions = _user?.allowedRegions ?? const <String>[];

    final hasAi = regions.contains(Regions.usa) || regions.contains(Regions.uae);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Dialer'),
        actions: [
          if (hasAi)
            IconButton(
              tooltip: 'Live AI calls — listen or take over',
              icon: const Icon(Icons.smart_toy_outlined),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const AiCallsScreen()),
              ),
            ),
        ],
      ),
      // The dialer sits inside HomeScreen's navigation bar, so the action row
      // must be pinned rather than pushed by content: an overflowing Column
      // used to clip "Hang up" off-screen, leaving no way to end a call.
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(20, 20, 20, 8),
                child: Column(
                  children: [
                    // Region picker is irrelevant mid-call and the space is
                    // needed to keep every control on one screen.
                    if (!_inTelnyxCall) ...[
                      if (regions.length > 1)
                        Wrap(
                          spacing: 8,
                          children: [
                            for (final region in regions)
                              ChoiceChip(
                                label: Text(Regions.label(region)),
                                selected: _region == region,
                                onSelected: (_) => setState(() {
                                  _region = region;
                                  _regionPinned = true;
                                }),
                              ),
                          ],
                        )
                      else
                        Chip(
                          avatar: const Icon(Icons.sim_card_outlined, size: 18),
                          label: Text(
                              regions.isEmpty ? providerLabel : Regions.label(regions.first)),
                        ),
                      const SizedBox(height: 12),
                    ],
                    TextField(
                      controller: _numberController,
                      keyboardType: TextInputType.phone,
                      textAlign: TextAlign.center,
                      readOnly: _inTelnyxCall,
                      style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w600),
                      decoration: InputDecoration(
                        isDense: _inTelnyxCall,
                        hintText: Regions.exampleNumber(_region),
                      ),
                    ),
                    SizedBox(height: _inTelnyxCall ? 8 : 12),
                    if (_status.isNotEmpty)
                      Container(
                        width: double.infinity,
                        padding: EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: _inTelnyxCall ? 8 : 12,
                        ),
                        decoration: BoxDecoration(
                          color: const Color(0xFFEEF2FF),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Text(
                          _inTelnyxCall && _elapsed > 0
                              ? '$_status · ${_formatDuration(_elapsed)}'
                              : _status,
                          textAlign: TextAlign.center,
                          style: const TextStyle(color: Color(0xFF3540C9)),
                        ),
                      ),
                    SizedBox(height: _inTelnyxCall ? 6 : 12),
                    // Mid-call the keypad sends DTMF instead of editing the
                    // number, so recruiters can drive an IVR menu.
                    _Keypad(
                      enabled: true,
                      compact: _inTelnyxCall,
                      onKey: (key) {
                        if (_inTelnyxCall) {
                          _sendDtmf(key);
                        } else {
                          _numberController.text += key;
                        }
                      },
                      onBackspace: () {
                        if (_inTelnyxCall) return;
                        final text = _numberController.text;
                        if (text.isNotEmpty) {
                          _numberController.text =
                              text.substring(0, text.length - 1);
                        }
                      },
                    ),
                    if (_inTelnyxCall) ...[
                      const SizedBox(height: 8),
                      Wrap(
                        alignment: WrapAlignment.center,
                        spacing: 18,
                        runSpacing: 10,
                        children: [
                          _InCallButton(
                            icon: _muted ? Icons.mic_off : Icons.mic,
                            label: _muted ? 'Unmute' : 'Mute',
                            active: _muted,
                            onTap: _toggleMute,
                          ),
                          _InCallButton(
                            icon: _speakerOn ? Icons.volume_up : Icons.volume_down,
                            label: 'Speaker',
                            active: _speakerOn,
                            onTap: _toggleSpeaker,
                          ),
                          _InCallButton(
                            icon: _held ? Icons.play_arrow : Icons.pause,
                            label: _held ? 'Resume' : 'Hold',
                            active: _held,
                            onTap: _toggleHold,
                          ),
                          if (_region == Regions.uae)
                            _InCallButton(
                              icon: Icons.phone_forwarded,
                              label: 'Transfer',
                              active: false,
                              onTap: _transferCall,
                            ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ),
            // Pinned: always reachable, whatever the screen height.
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 12),
              child: SizedBox(
                width: double.infinity,
                height: 54,
                child: _inTelnyxCall
                    ? FilledButton.icon(
                        style: FilledButton.styleFrom(backgroundColor: const Color(0xFFE11D48)),
                        onPressed: () =>
                            _region == Regions.uae ? _asterisk.hangup() : _telnyx.hangup(),
                        icon: const Icon(Icons.call_end),
                        label: Text(
                          _elapsed > 0 ? 'Hang up · ${_formatDuration(_elapsed)}' : 'Hang up',
                        ),
                      )
                    : Row(
                        children: [
                          Expanded(
                            child: FilledButton.icon(
                              style: FilledButton.styleFrom(
                                  backgroundColor: const Color(0xFF059669)),
                              onPressed: _busy ? null : _call,
                              icon: const Icon(Icons.call),
                              label: Text(_busy ? 'Calling…' : 'Call'),
                            ),
                          ),
                          if (_region == Regions.usa || _region == Regions.uae) ...[
                            const SizedBox(width: 10),
                            SizedBox(
                              width: 110,
                              child: OutlinedButton.icon(
                                onPressed: _busy ? null : _startAiCall,
                                icon: const Icon(Icons.smart_toy_outlined, size: 18),
                                label: const Text('AI Call'),
                              ),
                            ),
                          ],
                        ],
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InCallButton extends StatelessWidget {
  const _InCallButton({
    required this.icon,
    required this.label,
    required this.active,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Material(
          color: active ? const Color(0xFF3540C9) : const Color(0xFFE2E8F0),
          shape: const CircleBorder(),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: onTap,
            child: SizedBox(
              width: 56,
              height: 56,
              child: Icon(icon,
                  color: active ? Colors.white : const Color(0xFF334155)),
            ),
          ),
        ),
        const SizedBox(height: 4),
        Text(label,
            style: const TextStyle(fontSize: 11, color: Color(0xFF64748B))),
      ],
    );
  }
}

class _Keypad extends StatelessWidget {
  const _Keypad({
    required this.onKey,
    required this.onBackspace,
    this.enabled = true,
    this.compact = false,
  });

  final void Function(String) onKey;
  final VoidCallback onBackspace;
  final bool enabled;

  /// Mid-call the keys send DTMF and every control has to share one screen,
  /// so the pad tightens up and drops the (meaningless) backspace.
  final bool compact;

  static const _keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (var row = 0; row < 4; row++)
          Padding(
            padding: EdgeInsets.symmetric(vertical: compact ? 3 : 4),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (var col = 0; col < 3; col++)
                  Padding(
                    padding: EdgeInsets.symmetric(horizontal: compact ? 6 : 8),
                    child: _key(_keys[row * 3 + col]),
                  ),
              ],
            ),
          ),
        if (!compact)
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

  /// Holding "0" types "+" instead, the way native dialers do — needed for
  /// international numbers (+91…, +971…).
  Widget _key(String value) {
    final isZero = value == '0';
    return SizedBox(
      width: compact ? 66 : 72,
      height: compact ? 46 : 56,
      child: Material(
        color: Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: const BorderSide(color: Color(0xFFE2E8F0)),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: enabled ? () => onKey(value) : null,
          onLongPress: enabled && isZero ? () => onKey('+') : null,
          child: Stack(
            children: [
              Center(
                child: Text(
                  value,
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
                ),
              ),
              if (isZero)
                const Positioned(
                  top: 6,
                  right: 8,
                  child: Text(
                    '+',
                    style: TextStyle(fontSize: 11, color: Color(0xFF94A3B8)),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
