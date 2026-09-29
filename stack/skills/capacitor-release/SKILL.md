---
name: capacitor-release
description: "Load when cutting a release, wiring signing or building release CI for an Ionic or Capacitor app - .ipa, .aab, TestFlight, Play, OTA. Not for feature work."
---

# Capacitor release pipeline

This skill owns the last mile: turning a feature-complete Ionic/Capacitor app into a signed artifact in TestFlight or a Play testing track, and deciding what ships over-the-air versus through a fresh store binary. The app itself - UI, lifecycle, permissions, plugin wrapping - is `ionic`; per-plugin install/config is fetched live (the documentation server / the plugin README); this file picks up where the build is done. Floored at Capacitor 6, current on 8 - prefer the 8 path and treat anything newer as optional. Native Swift / Kotlin source edits are out of scope: this skill configures the native projects (signing, versions, symbols), it does not write platform code - that boundary stays with the platform tooling, not the agent.

## When to use

Load when cutting a release, wiring signing, or building the release CI for an Ionic / Capacitor app. Release-pipeline conventions - the gap from a feature-complete build to a signed store submission: native artifacts (.ipa, .aab), iOS and Android signing, TestFlight and Play submission, OTA updates, version sync, and the Fastlane / Actions CI shape. Targets Capacitor 6+ (8 current). Every build or upload step runs only under the approval this skill asks for first.

Do NOT load for in-app feature work with no release or signing concern.

## Step 0 - ask before the first irreversible byte

Every section below either writes a signed artifact or pushes one out, and an upload cannot be taken back: a build number is consumed, a testing track gets a binary, an OTA channel serves it to installed devices. So the FIRST action of this skill, before `cap sync` and before any lane runs, is one AskUserQuestion with these options:

- **Dry run only (recommended)** - print the exact commands, the resolved versions and the target track; run nothing.
- **Build the artifact, no upload** - run the web build, `cap sync` and the native build; stop before `pilot`, `supply` or any OTA publish.
- **Build and upload to a testing track** - the full lane against the track the answer names. Promotion to production is the user's own act, never this skill's.

Carry the answer into the output contract below. One approval covers one target: a different track, a first publish to an OTA channel, or a production promotion is a new ask. Where the harness has no AskUserQuestion tool, present the same three options as plain text and wait for the pick before the first command.

## The artifact - sync then build
- The web build comes first, then the bridge copy, then the native build. Never build native off a stale `www/`: run `npm run build` -> `npx cap sync` (copies web assets and updates native deps) -> the native build. `cap sync` is the step that makes the native shell match the code you just shipped.
- Prefer `npx cap build ios` / `npx cap build android` (stable, not experimental in 6+) for a one-shot signed artifact: iOS produces an `.ipa`, Android an `.aab` (default) or `.apk`. It wraps the platform tools so local and CI agree on flags.
- In CI, or when you need archive control, drive the platform tools directly: `xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release archive` then `-exportArchive` for the `.ipa`; `./gradlew bundleRelease` for the `.aab` (`assembleRelease` only when a raw `.apk` is genuinely needed). Ship the `.aab` to Play, not the `.apk` - Play requires the bundle and serves device-optimized splits from it.
- Match the iOS archive target to the dependency manager: Capacitor 8 defaults new iOS projects to Swift Package Manager, which has no CocoaPods `.xcworkspace` - hence the `-project ios/App/App.xcodeproj` above. A CocoaPods project (older, or `cap add ios --packagemanager CocoaPods`) archives its workspace instead (`-workspace ios/App/App.xcworkspace`); `npx cap build ios` resolves the right target either way, and `npx cap migrate` applies the mechanical changes on a version bump.

## Signing and store submission - the invariants
The mechanics - certificate + provisioning-profile setup, App Store Connect API keys and Fastlane match, keystore flags and apksigner, the TestFlight / Play track ladder - live in `references/signing.md`; load it when actually wiring signing or a submission. What holds regardless:
- iOS signs with a distribution **certificate** + App Store provisioning profile; in CI authenticate with an **App Store Connect API key** (a `.p8`), never a hand-copied developer cert - the API key removes the 2FA prompt that breaks an unattended pipeline.
- Android uses Play App Signing, and the two keys must differ: the **upload key** you hold and sign the `.aab` with, and the **app-signing key** Google holds and re-signs the served APKs with. That split is the key-loss story - a leaked upload key gets reset by Google without touching your app identity. Never check a keystore or its passwords into the repo - they are CI secrets (see below).
- A release proves itself in a testing track - TestFlight / a Play testing track - before any production promotion; both stores promote the same build without rebuilding.

## OTA / live updates - the native-binary boundary
This is the load-bearing rule of the whole pipeline: **a live update ships the web layer only**. HTML, CSS, JavaScript, and bundled web assets can go over-the-air with no store review. Anything that touches the native binary - adding or upgrading a Capacitor plugin, changing a native dependency, editing native config or native code - requires a fresh store submission. Push web-layer fixes over-the-air for speed; cut a native release when, and only when, the binary actually changed.
- Use the capawesome live-update plugin (`@capawesome/capacitor-live-update`). Ionic Appflow's live updates are sunsetting (end of 2027), so do not start new work on it - capawesome is the recommended path, with the official live-update mechanism as the alternative.
- Gate OTA bundles to the native versions they are compatible with. An OTA bundle built against a newer plugin set must not land on an older binary that lacks it - a web bundle expecting a native capability the installed binary does not have is a white-screen in production. Bind each live-update channel to a native version range.
- Serve the live-update channel over HTTPS with a signed or checksum-verified bundle, so a substituted bundle cannot land - this is the control `ionic-security` audits on the OTA seam.
- Run both layers together: a live-update channel for rapid web iteration, plus an app-update check that nudges users to the store when a native release is required.
- Publishing an OTA bundle IS a release: it reaches installed devices with no review in between, so it runs only under a step-0 answer that authorized an upload, and a first publish to a channel is asked again.

## Versioning - one source, four sinks, kept in sync
Two numbers, and they mean different things on every platform - keep them straight and keep them synced:
- **Marketing version** (the human-facing `1.4.0`): iOS `MARKETING_VERSION` / `CFBundleShortVersionString`, Android `versionName`, web `package.json` `version`.
- **Build number** (the monotonic integer the stores order by, must increase every upload): iOS `CFBundleVersion`, Android `versionCode`.
- The failure this section prevents is drift: a marketing version that disagrees across iOS, Android, and web, or a build number a store rejects as already-used. Bump from one source of truth in the release script - hand-editing the pbxproj and `build.gradle` separately is how they desync. A small CLI (capver, capacitor-set-version) or a Fastlane lane that writes all sinks from the `package.json` version keeps them in lockstep; the build number is the thing CI auto-increments per upload.

## CI/CD shape
- Recommend **Fastlane** as the release engine even when GitHub Actions is the trigger: its `match` (signing), `gym`/`build_app` (archive), `pilot`/`deliver` (App Store), and `supply` (Play) lanes encode the steps once and run identically on a laptop and a runner. A bare Actions workflow ends up re-implementing the same steps in YAML - let Fastlane own the release logic and let Actions own the trigger and the secrets. The lane shape:

```ruby
# fastlane/Fastfile - secrets arrive via ENV from the CI runner, never from the repo
platform :ios do
  lane :release do
    app_store_connect_api_key(key_id: ENV['ASC_KEY_ID'],
      issuer_id: ENV['ASC_ISSUER_ID'], key_content: ENV['ASC_KEY_P8'])
    match(type: 'appstore', readonly: true)
    build_app(project: 'ios/App/App.xcodeproj', scheme: 'App')
    # a CocoaPods project archives its workspace: build_app(workspace: 'ios/App/App.xcworkspace', scheme: 'App')
    pilot   # -> TestFlight, not production
  end
end

platform :android do
  lane :release do
    gradle(task: 'bundle', build_type: 'Release')
    supply(track: 'internal')   # -> Play internal track first
  end
end
```
- Running a lane is an upload, laptop or runner alike: `pilot` publishes to TestFlight and `supply` to a Play track. Run either only under the step-0 answer that authorized it, and never a production track from here.
- Secrets are injected, never committed: the App Store Connect API `.p8` (base64 in a secret), the Android upload keystore (base64) plus its passwords, the match passphrase / repo token. Decode into the runner at job start, use, and let the ephemeral runner discard them. A keystore, a `.p8`, or a signing password in the repo is a release-blocking leak.
- Build the matrix off the boundary above: a web-only change runs a lint/test/OTA-publish lane; a native change runs the full archive-sign-upload lane. Don't cut a store binary for a CSS fix.

## Crash + symbol upload is a release step
- iOS: upload the **dSYM** for every store/TestFlight build so crash reports symbolicate - automate it in the CI lane (Sentry's sentry-cli, Crashlytics upload-symbols, or Fastlane) rather than pulling it from App Store Connect by hand after a crash arrives. An unsymbolicated production crash is a wasted release.
- Web layer: upload the **sourcemaps** for the same build to your error tracker so an OTA-shipped JS error maps back to real source - then keep the maps out of the shipped bundle.
- Treat both as part of the release, gated on the same build number, not an afterthought - a symbol file that does not match the uploaded build is useless.

## Output contract - what a release run reports

Report in this order: the mode picked at step 0; the marketing version and build number written to every sink; the artifact path and the command that produced it with its result line; and, when an upload ran, the store's own confirmation (the TestFlight build state, or the Play track plus the version code it accepted) and the dSYM / sourcemap upload result. A release claimed without the store's own line is UNVERIFIED - quote the line, never the claim.

