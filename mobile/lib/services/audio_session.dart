// LiveKit marks its audio-session API experimental. We use it deliberately:
// it is the only way to configure the session once LiveKit has taken over
// audio management, and the alternative is calls with no microphone.
// ignore_for_file: experimental_member_use

import 'package:livekit_client/livekit_client.dart';

/// Owns the phone's audio session for calls.
///
/// Why this exists: loading the LiveKit plugin disables flutter_webrtc's own
/// native audio management (LiveKit says so in its docs, and does it at plugin
/// registration). The Telnyx SDK relies on that mechanism, so on iOS its calls
/// got no audio session at all — the microphone was never captured and the
/// other side heard silence, while LiveKit's own publishing worked fine.
///
/// So the app configures the session itself, using LiveKit's manual mode,
/// which applies the configuration immediately and verbatim.
class CallAudioSession {
  static bool _active = false;

  /// Two-way call audio for a **Telnyx** call.
  ///
  /// Manual mode applies the configuration immediately and verbatim, which is
  /// what gets the microphone captured — LiveKit having taken audio
  /// management away from flutter_webrtc, nothing else does it.
  static Future<void> begin({bool speaker = false}) async {
    try {
      await AudioManager.instance
          .setAudioSessionOptions(const AudioSessionOptions.communication());
      await AudioManager.instance.setSpeakerOutputPreferred(speaker, force: true);
      _active = true;
    } catch (_) {
      // Never block a call on audio routing; the call may still work.
    }
  }

  /// Audio for a **LiveKit** room (listening to an AI call, or taking over).
  ///
  /// LiveKit's own rooms need it managing the session itself: manual mode —
  /// which Telnyx calls require — stops it opening the audio path, which is
  /// what left supervision silent while Take over worked.
  static Future<void> beginRoom({bool speaker = true}) async {
    try {
      await AudioManager.instance
          .setAudioSessionManagementMode(AudioSessionManagementMode.automatic);
      _active = false;
      await AudioManager.instance.setSpeakerOutputPreferred(speaker, force: true);
    } catch (_) {
      /* noop */
    }
  }

  /// Change the route mid-call without tearing the session down.
  static Future<void> setSpeaker(bool speaker) async {
    try {
      await AudioManager.instance.setSpeakerOutputPreferred(speaker, force: true);
    } catch (_) {
      /* noop */
    }
  }

  /// Hand the audio session back when the call is over, so music and other
  /// apps are not left muted.
  static Future<void> end() async {
    // Hand management back to LiveKit either way, so the next room join works.
    try {
      await AudioManager.instance
          .setAudioSessionManagementMode(AudioSessionManagementMode.automatic);
    } catch (_) {
      /* noop */
    }
    if (!_active) return;
    _active = false;
    try {
      await AudioManager.instance.deactivateAudioSession();
    } catch (_) {
      /* noop */
    }
  }
}
