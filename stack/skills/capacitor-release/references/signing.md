# Signing and store-submission mechanics (iOS + Android)

The invariants live in `SKILL.md` (upload key vs app-signing key, secrets injected never committed, testing-track soak before production). This file is the how.

## iOS code signing
- Two artifacts sign an iOS build: a distribution **certificate** (identifies you) and a **provisioning profile** (ties the cert + app id + entitlements). For App Store delivery the profile is an App Store distribution profile.
- Local: let Xcode manage it - automatic signing with your team selected. `cap build ios` defaults to automatic signing and the app-store-connect export method, which is what you want for a store build.
- CI: do not ship a developer certificate around. Authenticate with an **App Store Connect API key** (a `.p8` file plus its key id and issuer id) - it removes the 2FA prompt that breaks an unattended pipeline. Pair it with Fastlane match, which keeps the distribution cert + profile in an encrypted store and installs them into the CI keychain on demand, so every runner signs with the same managed identity instead of a hand-copied `.p12`.
- Switch to manual signing (`--xcode-signing-style manual` with an explicit certificate + profile) only when automatic cannot express the setup - a shared enterprise cert, a pinned profile. Reach for it as the exception, not the default.

## Android signing mechanics
- The upload key (see SKILL.md for why it must differ from the app-signing key Google holds) lives in a keystore (`.jks`/`.keystore`) you supply via `--keystorepath` / `--keystorepass` / `--keystorealias` / `--keystorealiaspass` (or the Gradle signing config).
- Sign with `apksigner` (set `--signing-type apksigner`); `jarsigner` is the legacy default and worth overriding.

## Store submission
- iOS goes through App Store Connect. Upload the `.ipa` (`xcrun altool`, Fastlane `pilot`/`deliver`, or Transporter), then distribute the build to **TestFlight** for internal or external testers before promoting to App Store review. Internal testers get builds immediately; external testers wait on a Beta App Review.
- Android goes through the Play Console, which has staged testing tracks - promote a build up the ladder rather than straight to users: **internal** (instant, small allowlist) -> **closed** (a named tester group) -> **open** (public opt-in beta) -> **production**. Upload the same `.aab` to a track; promote between tracks in the console without rebuilding.
- The asymmetry is deliberate: TestFlight and the Play internal track are where a release proves itself. Do not promote to production until the build has sat in a testing track.
