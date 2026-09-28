import 'package:flutter/material.dart';

import 'api/api_client.dart';
import 'theme.dart';
import 'theme_controller.dart';
import 'services/push_service.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await ApiClient.instance.init();
  // Registers for call pushes where configured; a no-op otherwise, so the
  // app still runs unchanged before Firebase/APNs credentials exist.
  await PushService.init();
  await ThemeController.load();
  runApp(const SnappyConnectApp());
}

const brandColor = Color(0xFF4152E4);

class SnappyConnectApp extends StatelessWidget {
  const SnappyConnectApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<ThemeMode>(
      valueListenable: ThemeController.mode,
      builder: (context, themeMode, _) => MaterialApp(
      title: 'SnappyConnect',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      // Follow the phone: recruiters on late shifts keep their phones dark.
      themeMode: themeMode,
      home: ApiClient.instance.isLoggedIn ? const HomeScreen() : const LoginScreen(),
      ),
    );
  }
}
