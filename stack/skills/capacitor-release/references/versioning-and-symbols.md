# Versioning and symbol upload

`SKILL.md` keeps the two invariants: one version source, and symbols gated on the uploaded build number. This file holds the sinks and the mechanics.

## Versioning - one source, four sinks, kept in sync
Two numbers, and they mean different things on every platform - keep them straight and keep them synced:
- **Marketing version** (the human-facing `1.4.0`): iOS `MARKETING_VERSION` / `CFBundleShortVersionString`, Android `versionName`, web `package.json` `version`.
- **Build number** (the monotonic integer the stores order by, must increase every upload): iOS `CFBundleVersion`, Android `versionCode`.
- The failure this section prevents is drift: a marketing version that disagrees across iOS, Android, and web, or a build number a store rejects as already-used. Bump from one source of truth in the release script - hand-editing the pbxproj and `build.gradle` separately is how they desync. A small CLI (capver, capacitor-set-version) or a Fastlane lane that writes all sinks from the `package.json` version keeps them in lockstep; the build number is the thing CI auto-increments per upload.

## Crash + symbol upload is a release step
- iOS: upload the **dSYM** for every store/TestFlight build so crash reports symbolicate - automate it in the CI lane (Sentry's sentry-cli, Crashlytics upload-symbols, or Fastlane) rather than pulling it from App Store Connect by hand after a crash arrives. An unsymbolicated production crash is a wasted release.
- Web layer: upload the **sourcemaps** for the same build to your error tracker so an OTA-shipped JS error maps back to real source - then keep the maps out of the shipped bundle.
- Treat both as part of the release, gated on the same build number, not an afterthought.
