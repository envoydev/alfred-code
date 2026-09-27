# Platform builds and version sinks

Read before driving `xcodebuild` or Gradle directly, and before changing how the version is bumped.

## Driving the platform tools

- In CI, or when you need archive control, drive the platform tools directly: `xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Release archive` then `-exportArchive` for the `.ipa`; `./gradlew bundleRelease` for the `.aab` (`assembleRelease` only when a raw `.apk` is genuinely needed). Ship the `.aab` to Play, not the `.apk` - Play requires the bundle and serves device-optimized splits from it.
- Match the iOS archive target to the dependency manager: Capacitor 8 defaults new iOS projects to Swift Package Manager, which has no CocoaPods `.xcworkspace` - archive it with `-project ios/App/App.xcodeproj`, not the `-workspace ...App.xcworkspace` above. A CocoaPods project (older, or `cap add ios --packagemanager CocoaPods`) keeps the workspace; `npx cap build ios` resolves the right target either way, and `npx cap migrate` applies the mechanical changes on a version bump.

## Versioning - one source, four sinks

- **Marketing version** (the human-facing `1.4.0`): iOS `MARKETING_VERSION` / `CFBundleShortVersionString`, Android `versionName`, web `package.json` `version`.
- **Build number** (the monotonic integer the stores order by, must increase every upload): iOS `CFBundleVersion`, Android `versionCode`.
- The failure this section prevents is drift: a marketing version that disagrees across iOS, Android, and web, or a build number a store rejects as already-used. Bump from one source of truth in the release script - hand-editing the pbxproj and `build.gradle` separately is how they desync. A small CLI (capver, capacitor-set-version) or a Fastlane lane that writes all sinks from the `package.json` version keeps them in lockstep; the build number is the thing CI auto-increments per upload.

## Crash and symbol upload
- iOS: upload the **dSYM** for every store/TestFlight build so crash reports symbolicate - automate it in the CI lane (Sentry's sentry-cli, Crashlytics upload-symbols, or Fastlane) rather than pulling it from App Store Connect by hand after a crash arrives. An unsymbolicated production crash is a wasted release.
- Web layer: upload the **sourcemaps** for the same build to your error tracker so an OTA-shipped JS error maps back to real source - then keep the maps out of the shipped bundle.
- Treat both as part of the release, gated on the same build number, not an afterthought - a symbol file that does not match the uploaded build is useless.
