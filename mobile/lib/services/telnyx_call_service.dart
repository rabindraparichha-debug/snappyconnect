import 'dart:async';

import 'package:telnyx_webrtc/telnyx_webrtc.dart';
import 'package:telnyx_webrtc/model/connection_status.dart';
import 'package:telnyx_webrtc/model/push_notification.dart';
import 'package:telnyx_webrtc/utils/logging/log_level.dart';

import 'push_service.dart';

/// States surfaced to the UI for a Telnyx WebRTC call.
enum TelnyxCallUiState { connecting, ringing, active, ended, error }

typedef TelnyxStateCallback = void Function(TelnyxCallUiState state, String? detail);

/// Wraps the Telnyx WebRTC SDK. The client stays registered the whole time
/// the app is open (kept alive by CallServiceKeeper's foreground service), so
/// incoming calls ring the phone — not just calls the recruiter starts.
/// SIP tokens are minted by the backend (POST /calls/telnyx/token) and expire,
/// so every (re)connect mints a fresh one.
class TelnyxCallService {
  TelnyxClient? _client;
  Call? _call;
  bool _clientReady = false;
  bool _disposed = false;
  Completer<void>? _connecting;
  Timer? _reconnectTimer;
  Timer? _healthTimer;
  int _retries = 0;

  Future<Map<String, dynamic>> Function()? _mintToken;
  void Function(String fromNumber)? _onIncoming;
  TelnyxStateCallback? _onCallState;

  IncomingInviteParams? _pendingInvite;
  String _callerName = 'SnappyConnect';
  String _callerNumber = '';

  bool muted = false;
  bool held = false;
  bool get inCall => _call != null;

  /// Register with Telnyx and stay registered so incoming calls ring.
  /// Reconnects automatically (with a fresh token) whenever the socket drops.
  Future<void> listen({
    required Future<Map<String, dynamic>> Function() mintToken,
    required void Function(String fromNumber) onIncomingCall,
    String callerName = 'SnappyConnect',
  }) {
    _mintToken = mintToken;
    _onIncoming = onIncomingCall;
    _callerName = callerName;
    _startHealthChecks();
    return _connect();
  }

  /// True only when the SDK agrees the socket is actually up. The local
  /// `_clientReady` flag alone is not trustworthy: a socket that dies quietly
  /// (phone dozing, Wi-Fi/LTE handover) never fires an error, leaving the flag
  /// stuck true while Telnyx sees nobody registered.
  bool get isLive {
    final client = _client;
    if (client == null || !_clientReady) return false;
    try {
      return client.isConnected();
    } catch (_) {
      return false;
    }
  }

  /// Cheap liveness check; reconnects if the registration has gone stale.
  /// Safe to call often — on a timer, on app resume, before dialling.
  Future<void> ensureConnected() async {
    if (_disposed || _mintToken == null) return;
    // Never rebuild the client mid-call: reconnecting tears down the socket
    // carrying the audio, which drops the call the recruiter is on. A live
    // call is itself proof the connection works.
    if (_call != null) return;
    if (isLive) return;
    _clientReady = false;
    await _connect().catchError((_) {});
  }

  /// Tear the old client down before building a new one. Skipping this leaves
  /// the previous socket registered on the same SIP credential, and Telnyx
  /// then races the two sessions for an incoming call — the caller hears
  /// ringing while a dead session wins and drops it.
  void _teardownClient() {
    // Defence in depth: whatever the caller believes, disconnecting while a
    // call is up kills that call's audio path.
    if (_call != null) return;
    final old = _client;
    _client = null;
    _clientReady = false;
    if (old == null) return;
    try {
      // Detach: these are non-nullable, so silence them with no-ops or the
      // dying client's events would still drive this service's state.
      old.onSocketErrorReceived = (_) {};
      old.onSocketMessageReceived = (_) {};
      old.onConnectionStateChanged = null;
    } catch (_) {}
    try {
      old.disconnect();
    } catch (_) {}
  }

  /// Socket/state handlers, shared by a normal connect and a push-triggered
  /// one. [completer] is null for the push path, where the SDK owns connect.
  void _attachClientHandlers(TelnyxClient client, Completer<void>? completer) {
    client.onSocketErrorReceived = (error) {
      _clientReady = false;
      if (completer != null && !completer.isCompleted) {
        completer.completeError(Exception(error.errorMessage));
      }
      _onCallState?.call(TelnyxCallUiState.error, error.errorMessage);
      _scheduleReconnect();
    };

    // A quiet drop surfaces here rather than as an error, so this is what
    // catches the "app looked online but never rang" case.
    client.onConnectionStateChanged = (status) {
      if (status == ConnectionStatus.clientReady) {
        _clientReady = true;
        _retries = 0;
      } else if (status == ConnectionStatus.disconnected) {
        _clientReady = false;
        if (!_disposed) _scheduleReconnect();
      }
    };

    client.onSocketMessageReceived = (TelnyxMessage message) {
      switch (message.socketMethod) {
        case SocketMethod.clientReady:
          _clientReady = true;
          if (completer != null && !completer.isCompleted) completer.complete();
        case SocketMethod.invite:
          final invite = message.message.inviteParams;
          if (invite == null) return;
          if (_call != null) {
            // Already on a call: decline so the caller isn't left hanging.
            final id = invite.callID;
            if (id != null) client.rejectCall(id);
            return;
          }
          _pendingInvite = invite;
          _onIncoming?.call(invite.callerIdNumber ?? 'Unknown');
        default:
          break;
      }
    };
  }

  Future<void> _connect() async {
    if (_disposed || _mintToken == null) return;
    if (isLive) return;
    final pending = _connecting;
    if (pending != null) return pending.future;
    final completer = Completer<void>();
    _connecting = completer;

    try {
      _teardownClient();
      final tokenData = await _mintToken!();
      _callerNumber = (tokenData['fromNumber'] as String?) ?? _callerNumber;

      final client = TelnyxClient();
      _client = client;
      _attachClientHandlers(client, completer);

      // Telnyx only delivers inbound calls to sessions signed in with the
      // connection's SIP username/password — token sessions get SIP 480.
      final sipUser = tokenData['login'] as String?;
      final sipPassword = tokenData['password'] as String?;
      if (sipUser != null && sipPassword != null) {
        client.connectWithCredential(
          CredentialConfig(
            sipUser: sipUser,
            sipPassword: sipPassword,
            sipCallerIDName: _callerName,
            sipCallerIDNumber: _callerNumber,
            // Lets Telnyx wake the app with a VoIP push instead of needing a
            // live socket. Null on Android until FCM is wired up.
            notificationToken: await PushService.deviceToken(),
            logLevel: LogLevel.none,
            debug: false,
          ),
        );
      } else {
        client.connectWithToken(
          TokenConfig(
            sipToken: tokenData['token'] as String,
            sipCallerIDName: _callerName,
            sipCallerIDNumber: _callerNumber,
            logLevel: LogLevel.none,
            debug: false,
          ),
        );
      }

      await completer.future.timeout(const Duration(seconds: 20));
    } catch (e) {
      if (!completer.isCompleted) completer.completeError(e);
      _clientReady = false;
      _scheduleReconnect();
      rethrow;
    } finally {
      _connecting = null;
    }
  }

  void _scheduleReconnect() {
    if (_disposed || _mintToken == null) return;
    _reconnectTimer?.cancel();
    // Back off on repeated failures so a dead network doesn't spin the radio,
    // but stay quick for the common case of a brief blip.
    const steps = [2, 5, 10, 20, 30, 60];
    final secs = steps[_retries.clamp(0, steps.length - 1)];
    if (_retries < steps.length) _retries++;
    _reconnectTimer = Timer(Duration(seconds: secs), () {
      _connect().catchError((_) {});
    });
  }

  /// Heartbeat: proves the socket is still alive rather than assuming it.
  /// Without this a silent drop leaves the recruiter unreachable until they
  /// happen to restart the app.
  void _startHealthChecks() {
    _healthTimer?.cancel();
    _healthTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (_disposed) return;
      if (_call != null) return; // never disturb a live call
      if (!isLive) ensureConnected();
    });
  }

  void _attachCall(Call call, TelnyxStateCallback onState) {
    _call = call;
    muted = false;
    held = false;
    _onCallState = onState;
    call.callHandler.onCallStateChanged = (CallState state) {
      switch (state) {
        case CallState.connecting:
        case CallState.newCall:
          onState(TelnyxCallUiState.connecting, null);
        case CallState.ringing:
          onState(TelnyxCallUiState.ringing, null);
        case CallState.active:
          onState(TelnyxCallUiState.active, null);
        case CallState.done:
        case CallState.dropped:
          _call = null;
          muted = false;
          held = false;
          onState(TelnyxCallUiState.ended, null);
        default:
          break;
      }
    };
  }

  /// Answer (or decline) a call that arrived as a VoIP push while the app was
  /// asleep or killed.
  ///
  /// The SDK connects internally here, so this deliberately does not call
  /// [_connect] — doing both races two sessions onto the same credential,
  /// which is what made inbound calls fail intermittently before.
  Future<void> handlePush(
    Map<dynamic, dynamic> metadata, {
    required Future<Map<String, dynamic>> Function() mintToken,
    required TelnyxStateCallback onState,
    String callerName = 'SnappyConnect',
    bool answer = false,
    bool decline = false,
  }) async {
    if (_disposed) return;
    _mintToken ??= mintToken;
    _callerName = callerName;

    final Map<String, dynamic> creds;
    try {
      creds = await mintToken();
    } catch (e) {
      onState(TelnyxCallUiState.error, 'Could not reach the calling service: $e');
      return;
    }
    final sipUser = creds['login'] as String?;
    final sipPassword = creds['password'] as String?;
    if (sipUser == null || sipPassword == null) {
      onState(TelnyxCallUiState.error, 'Calling service is not configured for push.');
      return;
    }
    _callerNumber = (creds['fromNumber'] as String?) ?? _callerNumber;

    // A push means the previous socket is gone; start from a clean client.
    _teardownClient();
    final client = TelnyxClient();
    _client = client;
    _attachClientHandlers(client, null);

    final meta = PushMetaData.fromJson(metadata)
      ..isAnswer = answer
      ..isDecline = decline;

    _onCallState = onState;
    client.handlePushNotification(
      meta,
      CredentialConfig(
        sipUser: sipUser,
        sipPassword: sipPassword,
        sipCallerIDName: _callerName,
        sipCallerIDNumber: _callerNumber,
        notificationToken: await PushService.deviceToken(),
        logLevel: LogLevel.none,
        debug: false,
      ),
      null,
    );
  }

  Future<void> startCall({
    required String callerName,
    required String destination,
    required TelnyxStateCallback onState,
    Future<Map<String, dynamic>> Function()? mintToken,
  }) async {
    _mintToken ??= mintToken;
    _callerName = callerName;
    _startHealthChecks();
    try {
      // Re-registers first if the socket died since the last call, which is
      // what used to make outbound dialling work only some of the time.
      await ensureConnected();
    } catch (e) {
      onState(TelnyxCallUiState.error, 'Could not reach the calling service: $e');
      return;
    }
    final client = _client;
    if (client == null || !_clientReady) {
      onState(TelnyxCallUiState.error, 'Not connected to the calling service yet.');
      return;
    }
    final call =
        client.newInvite(callerName, _callerNumber, destination, 'snappyconnect');
    _attachCall(call, onState);
  }

  /// Answer the invite most recently surfaced via [listen]'s onIncomingCall.
  void answerIncoming({required TelnyxStateCallback onState}) {
    final invite = _pendingInvite;
    final client = _client;
    if (invite == null || client == null) {
      onState(TelnyxCallUiState.error, 'The call is no longer available.');
      return;
    }
    _pendingInvite = null;
    final call = client.acceptCall(invite, _callerName, _callerNumber, 'snappyconnect');
    _attachCall(call, onState);
    onState(TelnyxCallUiState.connecting, null);
  }

  void declineIncoming() {
    final id = _pendingInvite?.callID;
    _pendingInvite = null;
    if (id != null) _client?.rejectCall(id);
  }

  void toggleMute() {
    if (_call == null) return;
    _call!.onMuteUnmutePressed();
    muted = !muted;
  }

  void toggleHold() {
    if (_call == null) return;
    _call!.onHoldUnholdPressed();
    held = !held;
  }

  void dtmf(String tone) => _call?.dtmf(tone);

  void hangup() {
    _call?.endCall();
  }

  void dispose() {
    _disposed = true;
    _reconnectTimer?.cancel();
    _healthTimer?.cancel();
    // Clear the call first: teardown deliberately refuses to run mid-call, and
    // on sign-out we do want the socket closed regardless.
    _call = null;
    _teardownClient();
  }
}
