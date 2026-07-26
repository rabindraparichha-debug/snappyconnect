import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_ringtone_player/flutter_ringtone_player.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

/// Full-screen incoming call UI — rings, vibrates and wakes the screen, so a
/// returning candidate is not missed while the app is in the background.
/// Pops with `true` (answer) or `false` (decline).
class IncomingCallScreen extends StatefulWidget {
  const IncomingCallScreen({super.key, required this.fromNumber});

  final String fromNumber;

  @override
  State<IncomingCallScreen> createState() => _IncomingCallScreenState();
}

class _IncomingCallScreenState extends State<IncomingCallScreen> {
  @override
  void initState() {
    super.initState();
    WakelockPlus.enable();
    _startRinging();
  }

  Future<void> _startRinging() async {
    try {
      FlutterRingtonePlayer().playRingtone(looping: true, asAlarm: false);
    } catch (_) {
      // A missing system ringtone should never block the call UI.
    }
    HapticFeedback.heavyImpact();
  }

  Future<void> _stopRinging() async {
    try {
      FlutterRingtonePlayer().stop();
    } catch (_) {}
    await WakelockPlus.disable();
  }

  @override
  void dispose() {
    _stopRinging();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      child: Scaffold(
        backgroundColor: const Color(0xFF0F172A),
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(
              children: [
                const Spacer(),
                const Text(
                  'Incoming call',
                  style: TextStyle(color: Color(0xFF94A3B8), fontSize: 16),
                ),
                const SizedBox(height: 10),
                Text(
                  widget.fromNumber,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 30,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'SnappyConnect · UAE line',
                  style: TextStyle(color: Color(0xFF64748B), fontSize: 13),
                ),
                const Spacer(),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    _CallAction(
                      color: const Color(0xFFE11D48),
                      icon: Icons.call_end,
                      label: 'Decline',
                      onTap: () => Navigator.of(context).pop(false),
                    ),
                    _CallAction(
                      color: const Color(0xFF059669),
                      icon: Icons.call,
                      label: 'Answer',
                      onTap: () => Navigator.of(context).pop(true),
                    ),
                  ],
                ),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _CallAction extends StatelessWidget {
  const _CallAction({
    required this.color,
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final Color color;
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        GestureDetector(
          onTap: onTap,
          child: Container(
            width: 74,
            height: 74,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            child: Icon(icon, color: Colors.white, size: 32),
          ),
        ),
        const SizedBox(height: 10),
        Text(label, style: const TextStyle(color: Colors.white, fontSize: 14)),
      ],
    );
  }
}
