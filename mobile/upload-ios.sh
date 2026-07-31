#!/bin/bash
# Build, sign and upload the iOS app to App Store Connect / TestFlight.
#
#   ./mobile/upload-ios.sh
#
# Signing and upload both authenticate with the App Store Connect API key in
# ~/private_keys (Admin role — needed for cloud signing), so no Xcode sign-in
# or password prompt is involved.
set -euo pipefail

KEY_ID=QT8457XX73
ISSUER_ID=e9e3fcb3-60d6-47e0-893a-1cb4f9549e4d
TEAM_ID=NQFNKQU793
MOBILE_DIR="$(cd "$(dirname "$0")" && pwd)"

cd "$MOBILE_DIR"

echo "==> 1/3 Building release archive"
flutter build ipa --release --no-codesign > /dev/null || true
xcodebuild -workspace ios/Runner.xcworkspace -scheme Runner -configuration Release \
  -archivePath build/ios/archive/Runner.xcarchive archive \
  -allowProvisioningUpdates \
  -authenticationKeyPath ~/private_keys/AuthKey_$KEY_ID.p8 \
  -authenticationKeyID $KEY_ID -authenticationKeyIssuerID $ISSUER_ID

echo "==> 2/3 Exporting signed IPA"
cat > /tmp/ExportOptions.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>uploadSymbols</key><true/>
  <key>signingStyle</key><string>automatic</string>
</dict>
</plist>
EOF
rm -rf build/ios/ipa
xcodebuild -exportArchive -archivePath build/ios/archive/Runner.xcarchive \
  -exportOptionsPlist /tmp/ExportOptions.plist -exportPath build/ios/ipa \
  -allowProvisioningUpdates \
  -authenticationKeyPath ~/private_keys/AuthKey_$KEY_ID.p8 \
  -authenticationKeyID $KEY_ID -authenticationKeyIssuerID $ISSUER_ID

echo "==> 3/3 Uploading to App Store Connect"
xcrun altool --upload-app -f build/ios/ipa/*.ipa -t ios \
  --apiKey $KEY_ID --apiIssuer $ISSUER_ID

echo
echo "Uploaded. The build appears under TestFlight after ~10-15 min of Apple processing."
