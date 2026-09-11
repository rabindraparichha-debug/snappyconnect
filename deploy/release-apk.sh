#!/usr/bin/env bash
# Build the Android APK and publish it, updating /downloads/version.json so
# installed apps offer the in-app one-tap update on next launch.
#
# Usage: ./deploy/release-apk.sh ["release notes shown in the update dialog"]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VPS="root@145.223.18.237"
KEY="$HOME/.ssh/snappyconnect_vps"
NOTES="${1:-Bug fixes and improvements.}"

VERSION="$(grep '^version:' "$REPO_ROOT/mobile/pubspec.yaml" | sed 's/version: *//; s/+.*//')"
echo "==> Building SnappyConnect $VERSION"
(cd "$REPO_ROOT/mobile" && flutter build apk --release)

APK="$REPO_ROOT/mobile/build/app/outputs/flutter-apk/app-release.apk"
SUM="$(shasum -a 256 "$APK" | cut -d' ' -f1)"

echo "==> Uploading (sha256 $SUM)"
ssh -n -i "$KEY" "$VPS" "cp -f /opt/snappyconnect/downloads/snappyconnect.apk /opt/snappyconnect/downloads/snappyconnect-prev.apk 2>/dev/null || true"
scp -i "$KEY" "$APK" "$VPS:/opt/snappyconnect/downloads/snappyconnect.apk"

# Written locally and scp'd — `ssh -n` heredocs silently send nothing.
TMPJSON="$(mktemp)"
cat > "$TMPJSON" <<JSON
{
  "android": {
    "version": "$VERSION",
    "url": "https://call.snappyhires.com/downloads/snappyconnect.apk",
    "sha256": "$SUM",
    "notes": "$NOTES"
  }
}
JSON
scp -i "$KEY" "$TMPJSON" "$VPS:/opt/snappyconnect/downloads/version.json"
rm -f "$TMPJSON"

REMOTE_SUM="$(ssh -n -i "$KEY" "$VPS" "sha256sum /opt/snappyconnect/downloads/snappyconnect.apk" | cut -d' ' -f1)"
[ "$SUM" = "$REMOTE_SUM" ] || { echo "CHECKSUM MISMATCH after upload"; exit 1; }
echo "==> Published $VERSION — installed apps will prompt to update on next launch."
