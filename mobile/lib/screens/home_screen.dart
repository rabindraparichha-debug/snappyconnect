import 'package:flutter/material.dart';

import '../dial_intent.dart';
import '../services/update_service.dart';
import 'dialer_screen.dart';
import 'messages_screen.dart';
import 'history_screen.dart';
import 'profile_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with WidgetsBindingObserver {
  int _index = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    DialIntent.pending.addListener(_onDialIntent);
    WidgetsBinding.instance.addPostFrameCallback(
      (_) => UpdateService.checkAndPrompt(context),
    );
  }

  void _onDialIntent() {
    if (DialIntent.pending.value != null && mounted) {
      setState(() => _index = 0);
    }
  }

  @override
  void dispose() {
    DialIntent.pending.removeListener(_onDialIntent);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Catch releases published while the app sat in the recents list.
    if (state == AppLifecycleState.resumed && mounted) {
      UpdateService.checkAndPrompt(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _index,
        children: const [DialerScreen(), MessagesScreen(), HistoryScreen(), ProfileScreen()],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (index) => setState(() => _index = index),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.dialpad), label: 'Dialer'),
          NavigationDestination(icon: Icon(Icons.forum_outlined), label: 'Messages'),
          NavigationDestination(icon: Icon(Icons.history), label: 'History'),
          NavigationDestination(icon: Icon(Icons.person_outline), label: 'Profile'),
        ],
      ),
    );
  }
}
