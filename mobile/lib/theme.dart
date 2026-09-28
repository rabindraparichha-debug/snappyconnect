import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// SnappyConnect's visual language, in one place.
///
/// The app is used all day, often one-handed between calls, so this leans on
/// a calm surface, one accent colour, generous touch targets and type that
/// stays readable at arm's length — rather than decoration for its own sake.
class AppTheme {
  /// The brand indigo. Used for anything actionable, and nothing else, so
  /// "blue means you can tap it" holds everywhere.
  static const brand = Color(0xFF4152E4);
  static const brandDark = Color(0xFF3540C9);

  static const success = Color(0xFF059669);
  static const danger = Color(0xFFDC2626);
  static const warning = Color(0xFFB45309);
  static const whatsapp = Color(0xFF25D366);

  // Neutral ramp — slate, so greys never look muddy next to the indigo.
  static const ink = Color(0xFF0F172A);
  static const muted = Color(0xFF64748B);
  static const hairline = Color(0xFFE2E8F0);
  static const canvas = Color(0xFFF6F7FB);

  static const _radius = 14.0;

  static ThemeData light() => _build(Brightness.light);
  static ThemeData dark() => _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) {
    final isDark = brightness == Brightness.dark;
    final scheme = ColorScheme.fromSeed(
      seedColor: brand,
      brightness: brightness,
    ).copyWith(
      primary: isDark ? const Color(0xFF8B96FF) : brand,
      error: danger,
      surface: isDark ? const Color(0xFF111726) : Colors.white,
    );
    final surface = scheme.surface;
    final onSurfaceMuted = isDark ? const Color(0xFF94A3B8) : muted;
    final border = isDark ? const Color(0xFF232B3E) : hairline;

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: isDark ? const Color(0xFF0B0F1A) : canvas,
      splashFactory: InkSparkle.splashFactory,

      // Type: one family, tight headings, comfortable body. Sizes are a step
      // up from Flutter's defaults — recruiters read these in car parks.
      textTheme: TextTheme(
        headlineSmall: TextStyle(
          fontSize: 22,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.4,
          color: isDark ? Colors.white : ink,
        ),
        titleMedium: TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w600,
          color: isDark ? Colors.white : ink,
        ),
        bodyMedium: TextStyle(
          fontSize: 15,
          height: 1.35,
          color: isDark ? const Color(0xFFCBD5E1) : const Color(0xFF334155),
        ),
        bodySmall: TextStyle(fontSize: 13, color: onSurfaceMuted),
        labelLarge: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
      ),

      appBarTheme: AppBarTheme(
        backgroundColor: isDark ? const Color(0xFF0B0F1A) : canvas,
        foregroundColor: isDark ? Colors.white : ink,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        systemOverlayStyle:
            isDark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark,
        titleTextStyle: TextStyle(
          fontSize: 22,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.4,
          color: isDark ? Colors.white : ink,
        ),
      ),

      cardTheme: CardThemeData(
        color: surface,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(_radius),
          side: BorderSide(color: border),
        ),
      ),

      listTileTheme: ListTileThemeData(
        iconColor: onSurfaceMuted,
        titleTextStyle: TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w600,
          color: isDark ? Colors.white : ink,
        ),
        subtitleTextStyle: TextStyle(fontSize: 13, color: onSurfaceMuted),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      ),

      dividerTheme: DividerThemeData(color: border, space: 1, thickness: 1),

      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: brand,
          foregroundColor: Colors.white,
          // 52pt high: comfortably tappable with a thumb, mid-call.
          minimumSize: const Size(0, 52),
          padding: const EdgeInsets.symmetric(horizontal: 20),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(_radius),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(0, 48),
          foregroundColor: isDark ? Colors.white : ink,
          side: BorderSide(color: border),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(_radius),
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: isDark ? const Color(0xFF8B96FF) : brand,
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
        ),
      ),

      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surface,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        hintStyle: TextStyle(color: onSurfaceMuted),
        labelStyle: TextStyle(color: onSurfaceMuted),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(_radius),
          borderSide: BorderSide(color: border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(_radius),
          borderSide: BorderSide(color: border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(_radius),
          borderSide: const BorderSide(color: brand, width: 1.6),
        ),
      ),

      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: surface,
        indicatorColor: brand.withValues(alpha: isDark ? 0.28 : 0.12),
        elevation: 0,
        height: 68,
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => TextStyle(
            fontSize: 12,
            fontWeight: states.contains(WidgetState.selected)
                ? FontWeight.w600
                : FontWeight.w500,
            color: states.contains(WidgetState.selected)
                ? (isDark ? Colors.white : brandDark)
                : onSurfaceMuted,
          ),
        ),
      ),

      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: ink,
        contentTextStyle: const TextStyle(color: Colors.white, fontSize: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),

      dialogTheme: DialogThemeData(
        backgroundColor: surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: surface,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: isDark ? const Color(0xFF1A2133) : Colors.white,
        side: BorderSide(color: border),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    );
  }
}
