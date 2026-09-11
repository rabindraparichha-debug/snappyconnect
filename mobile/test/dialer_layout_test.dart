import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:snappyconnect_mobile/screens/dialer_screen.dart';

/// Regression guard for the clipped action bar.
///
/// DialerScreen lives inside HomeScreen's navigation bar. It used to lay its
/// content out in a plain Column, which silently clipped the bottom row on
/// shorter screens — taking "Hang up" with it and leaving no way to end a
/// call. A widget test fails on RenderFlex overflow, so pumping the screen at
/// cramped sizes proves the layout still fits.
void main() {
  Future<void> pumpAt(
    WidgetTester tester,
    Size size, {
    bool inCall = false,
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: DialerScreen(debugStartInCall: inCall),
          bottomNavigationBar: const SizedBox(height: 80),
        ),
      ),
    );
    await tester.pump();
  }

  testWidgets('lays out without overflow on a small phone', (tester) async {
    await pumpAt(tester, const Size(320, 480));
    expect(tester.takeException(), isNull);
  });

  testWidgets('lays out without overflow on a typical phone', (tester) async {
    await pumpAt(tester, const Size(411, 731));
    expect(tester.takeException(), isNull);
  });

  testWidgets('keeps the primary action reachable', (tester) async {
    await pumpAt(tester, const Size(320, 480));
    expect(tester.takeException(), isNull);
    // The action bar is pinned outside the scroll view, so it is present and
    // on-screen no matter how little vertical room there is.
    final call = find.widgetWithText(FilledButton, 'Call');
    expect(call, findsOneWidget);
    final box = tester.getRect(call);
    expect(box.bottom, lessThanOrEqualTo(480));
    expect(box.height, greaterThan(0));
  });

  // The in-call view must fit on one screen: nobody should have to scroll to
  // reach Mute, Hold or the keypad while someone is on the line.
  testWidgets('in-call view fits without scrolling', (tester) async {
    await pumpAt(tester, const Size(360, 640), inCall: true);
    expect(tester.takeException(), isNull);

    expect(find.text('Mute'), findsOneWidget);
    expect(find.text('Speaker'), findsOneWidget);
    expect(find.text('Hold'), findsOneWidget);
    expect(find.textContaining('Hang up'), findsOneWidget);

    // Nothing is scrolled out of view.
    final position = tester.state<ScrollableState>(find.byType(Scrollable).first).position;
    expect(position.maxScrollExtent, 0);

    // And the hang-up control sits fully on screen.
    final hangUp = tester.getRect(find.widgetWithText(FilledButton, 'Hang up'));
    expect(hangUp.bottom, lessThanOrEqualTo(640));
  });
}
