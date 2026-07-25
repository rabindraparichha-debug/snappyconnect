import 'package:sip_ua/sip_ua.dart';

/// States surfaced to the UI for an in-app SIP (Asterisk) call.
enum AsteriskCallUiState { registering, connecting, ringing, active, ended, error }

typedef AsteriskStateCallback = void Function(AsteriskCallUiState state, String? detail);

/// An inbound call waiting to be answered (a candidate calling the SIM back).
typedef AsteriskIncomingCallback = void Function(Call call, String fromNumber);

/// Built-in softphone for UAE users. Registers the user's own SIP account
/// (from GET /calls/asterisk/config) against the self-hosted Asterisk over an
/// encrypted WebSocket — plain SIP is blocked by UAE ISPs — and places calls
/// with WebRTC audio. Registration is kept alive for the app session so
/// subsequent calls dial instantly.
class AsteriskCallService implements SipUaHelperListener {
  final SIPUAHelper _helper = SIPUAHelper();

  Call? _call;
  AsteriskStateCallback? _onState;
  AsteriskIncomingCallback? _onIncoming;
  String? _pendingDestination;
  bool _started = false;

  bool get registered => _helper.registered;

  /// Register without dialing so the user can receive return calls. Safe to
  /// call repeatedly — registration is reused for the app session.
  Future<void> connect({
    required String wssUrl,
    required String sipDomain,
    required String sipUsername,
    required String sipPassword,
    required String displayName,
    required AsteriskStateCallback onState,
    required AsteriskIncomingCallback onIncoming,
  }) async {
    _onState = onState;
    _onIncoming = onIncoming;
    if (_started || _helper.registered) return;
    await _start(
      wssUrl: wssUrl,
      sipDomain: sipDomain,
      sipUsername: sipUsername,
      sipPassword: sipPassword,
      displayName: displayName,
    );
  }

  /// Answer a ringing inbound call.
  void answer(Call call) {
    _call = call;
    call.answer(_helper.buildCallOptions(true));
  }

  /// Reject a ringing inbound call so it keeps ringing the rest of the team.
  void decline(Call call) {
    try {
      call.hangup({'status_code': 486});
    } catch (_) {}
  }

  Future<void> startCall({
    required String wssUrl,
    required String sipDomain,
    required String sipUsername,
    required String sipPassword,
    required String displayName,
    required String destination,
    required AsteriskStateCallback onState,
    AsteriskIncomingCallback? onIncoming,
  }) async {
    _onState = onState;
    if (onIncoming != null) _onIncoming = onIncoming;
    _pendingDestination = destination;

    if (_helper.registered) {
      _dialPending();
      return;
    }

    onState(AsteriskCallUiState.registering, null);
    if (_started) return; // registration in flight; _dialPending fires on success

    await _start(
      wssUrl: wssUrl,
      sipDomain: sipDomain,
      sipUsername: sipUsername,
      sipPassword: sipPassword,
      displayName: displayName,
    );
  }

  Future<void> _start({
    required String wssUrl,
    required String sipDomain,
    required String sipUsername,
    required String sipPassword,
    required String displayName,
  }) async {
    final settings = UaSettings()
      ..webSocketUrl = wssUrl
      ..transportType = TransportType.WS
      ..uri = 'sip:$sipUsername@$sipDomain'
      ..registrarServer = sipDomain
      ..authorizationUser = sipUsername
      ..password = sipPassword
      ..displayName = displayName
      ..userAgent = 'SnappyConnect Mobile'
      ..register = true
      ..dtmfMode = DtmfMode.RFC2833;
    settings.webSocketSettings.allowBadCertificate = true;

    _helper.addSipUaHelperListener(this);
    await _helper.start(settings);
    _started = true;
  }

  void _dialPending() {
    final destination = _pendingDestination;
    if (destination == null) return;
    _pendingDestination = null;
    _onState?.call(AsteriskCallUiState.connecting, null);
    _helper.call(destination, voiceOnly: true);
  }

  void hangup() {
    try {
      _call?.hangup();
    } catch (_) {}
  }

  void dispose() {
    try {
      _helper.stop();
    } catch (_) {}
    _helper.removeSipUaHelperListener(this);
    _call = null;
    _started = false;
  }

  // ---------- SipUaHelperListener ----------

  @override
  void registrationStateChanged(RegistrationState state) {
    switch (state.state) {
      case RegistrationStateEnum.REGISTERED:
        _dialPending();
      case RegistrationStateEnum.REGISTRATION_FAILED:
        _onState?.call(
          AsteriskCallUiState.error,
          'SIP registration failed: ${state.cause?.cause ?? 'unknown'}',
        );
      default:
        break;
    }
  }

  @override
  void callStateChanged(Call call, CallState state) {
    // Inbound call arriving (candidate returning a call to the shared SIM):
    // surface it to the UI instead of treating it as our own outbound call.
    if (state.state == CallStateEnum.CALL_INITIATION && call.direction == Direction.incoming) {
      _onIncoming?.call(call, call.remote_identity ?? 'Unknown');
      return;
    }
    _call = call;
    switch (state.state) {
      case CallStateEnum.CONNECTING:
      case CallStateEnum.CALL_INITIATION:
        _onState?.call(AsteriskCallUiState.connecting, null);
      case CallStateEnum.PROGRESS:
        _onState?.call(AsteriskCallUiState.ringing, null);
      case CallStateEnum.ACCEPTED:
      case CallStateEnum.CONFIRMED:
        _onState?.call(AsteriskCallUiState.active, null);
      case CallStateEnum.ENDED:
        _call = null;
        _onState?.call(AsteriskCallUiState.ended, null);
      case CallStateEnum.FAILED:
        _call = null;
        _onState?.call(AsteriskCallUiState.error, state.cause?.cause ?? 'Call failed');
      default:
        break;
    }
  }

  @override
  void transportStateChanged(TransportState state) {
    if (state.state == TransportStateEnum.DISCONNECTED && _call != null) {
      _call = null;
      _onState?.call(AsteriskCallUiState.error, 'Connection to the call server was lost.');
    }
  }

  @override
  void onNewMessage(SIPMessageRequest msg) {}

  @override
  void onNewNotify(Notify notify) {}

  @override
  void onNewReinvite(ReInvite event) {}
}
