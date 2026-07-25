import 'package:sip_ua/sip_ua.dart';

/// States surfaced to the UI for an in-app SIP (Asterisk) call.
enum AsteriskCallUiState { registering, connecting, ringing, active, ended, error }

typedef AsteriskStateCallback = void Function(AsteriskCallUiState state, String? detail);

/// Built-in softphone for UAE users. Registers the user's own SIP account
/// (from GET /calls/asterisk/config) against the self-hosted Asterisk over an
/// encrypted WebSocket — plain SIP is blocked by UAE ISPs — and places calls
/// with WebRTC audio. Registration is kept alive for the app session so
/// subsequent calls dial instantly.
class AsteriskCallService implements SipUaHelperListener {
  final SIPUAHelper _helper = SIPUAHelper();

  Call? _call;
  AsteriskStateCallback? _onState;
  String? _pendingDestination;
  bool _started = false;

  bool get registered => _helper.registered;

  Future<void> startCall({
    required String wssUrl,
    required String sipDomain,
    required String sipUsername,
    required String sipPassword,
    required String displayName,
    required String destination,
    required AsteriskStateCallback onState,
  }) async {
    _onState = onState;
    _pendingDestination = destination;

    if (_helper.registered) {
      _dialPending();
      return;
    }

    onState(AsteriskCallUiState.registering, null);
    if (_started) return; // registration in flight; _dialPending fires on success

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
