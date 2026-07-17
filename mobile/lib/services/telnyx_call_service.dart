import 'package:telnyx_webrtc/telnyx_webrtc.dart';
import 'package:telnyx_webrtc/utils/logging/log_level.dart';

/// States surfaced to the UI for a Telnyx WebRTC call.
enum TelnyxCallUiState { connecting, ringing, active, ended, error }

typedef TelnyxStateCallback = void Function(TelnyxCallUiState state, String? detail);

/// Wraps the Telnyx WebRTC SDK for simple outbound calls. The SIP token is
/// minted by the SnappyConnect backend (POST /calls/telnyx/token).
class TelnyxCallService {
  TelnyxClient? _client;
  Call? _call;

  Future<void> startCall({
    required String sipToken,
    required String callerName,
    required String callerNumber,
    required String destination,
    required TelnyxStateCallback onState,
  }) async {
    dispose();
    final client = TelnyxClient();
    _client = client;

    client.onSocketErrorReceived = (error) {
      onState(TelnyxCallUiState.error, error.errorMessage);
    };

    client.onSocketMessageReceived = (TelnyxMessage message) {
      if (message.socketMethod == SocketMethod.clientReady) {
        final call = client.newInvite(callerName, callerNumber, destination, 'snappyconnect');
        _call = call;
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
              onState(TelnyxCallUiState.ended, null);
            default:
              break;
          }
        };
      }
    };

    onState(TelnyxCallUiState.connecting, null);
    client.connectWithToken(
      TokenConfig(
        sipToken: sipToken,
        sipCallerIDName: callerName,
        sipCallerIDNumber: callerNumber,
        logLevel: LogLevel.none,
        debug: false,
      ),
    );
  }

  void hangup() {
    _call?.endCall();
  }

  void dispose() {
    try {
      _client?.disconnect();
    } catch (_) {}
    _client = null;
    _call = null;
  }
}
