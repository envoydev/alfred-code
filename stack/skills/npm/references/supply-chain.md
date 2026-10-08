# npm supply chain - what happened, what defends, what to layer

Loaded from the `npm` skill when hardening installs, evaluating scanners, setting up publishing auth, or answering 'is npm audit enough'.

## The worm campaigns and the lessons they proved

Three waves of a self-replicating npm worm (counts are vendor-reported - treat as approximate):

- **Shai-Hulud, Sep 2025** - 500+ packages, starting from `@ctrl/tinycolor`. A post-install script ran a secret scanner, exfiltrated npm/GitHub/cloud tokens to public repos, and used stolen npm tokens to republish the maintainer's other packages.
- **Shai-Hulud 2.0, Nov 2025** - ~796 packages across ~1,092 versions, 20M+ weekly downloads. Moved the payload to pre-install (wider execution), added a destructive home-directory-wipe fallback, self-replicated with no C2 server.
- **Mini Shai-Hulud, May 2026** - 170+ npm packages plus 2 PyPI packages across ~404 versions - the first cross-ecosystem campaign.

Lessons, each mapped to a defense:

1. **Install-time script execution is the blast radius** -> `ignore-scripts=true` everywhere.
2. **Malicious versions die fast** (the Sep 2025 debug/chalk versions were pulled in ~2.5h, Shai-Hulud 2.0 in ~12h, the Mar 2026 axios versions in ~3h) -> a multi-day cooldown filters nearly all of them.
3. **CI secrets in the install environment are the crown jewels** -> OIDC, scoped short-lived credentials, no tokens in env when installing.
4. **Stolen-token republishing is the propagation mechanism** -> provenance + staged publishing exist precisely for this.

## The cooldown, per tool

| Tool | Setting | Unit / default |
|---|---|---|
| npm >= 11.10.0 | `min-release-age` in .npmrc | days; recommend 7 |
| pnpm >= 11 | `minimumReleaseAge` | minutes; default 1440 (24h) |
| Yarn Berry | `npmMinimalAgeGate` | minutes |
| Bun | `minimumReleaseAge` | seconds |
| Renovate | `config:best-practices` -> `security:minimumReleaseAgeNpm` | 3-day npm minimum |
| Dependabot | cooldown `default-days` (+ per-semver overrides) | days |

The package-manager cooldown enforces at install time, the bot cooldown at PR-open time - you need both. Security updates should bypass the bot cooldown; pair cooldowns with alerting so real patches still reach you.

## npm audit - honest assessment, and the layering

`npm audit` reports known CVEs from the GitHub Advisory Database only. It cannot see novel malware, typosquats, obfuscated payloads, or compromised-maintainer republishes - exactly the worm class. Its false-positive rate is high (community-measured: ~80% across all severities, ~40-50% at critical-only; one famous Create React App analysis found 99%+) because it applies worst-case CVSS with no reachability. Stance: keep it as a critical/high gate (`npm audit --omit=dev --audit-level=high`, no suppression), run `npm audit signatures` after `npm ci`, and layer:

- **Socket.dev** - behavioral analysis before install; the strongest layer for the attack class audit misses (novel malware, typosquats, install-script abuse).
- **Snyk / Mend** - proprietary DB + reachability (which vulnerable functions you actually call), license policy, audit trails; commercial - add when compliance needs them.
- **OSV-Scanner** - federated advisory DB, low false positives, free.
- **Renovate or Dependabot** - automated update PRs with cooldowns (see the table).

If audit noise drowns signal, add reachability analysis rather than lowering the gate.

## Publishing auth - current state

- All npm classic tokens were permanently revoked (Dec 9, 2025) - they cannot be recreated or recovered.
- `npm login` issues a short session token (hours, not months); 2FA is enforced for publishing; granular write tokens cap at 90 days with 2FA by default.
- **OIDC trusted publishing is the CI path** (GitHub Actions, GitLab CI/CD): no stored token, provenance generated automatically. Configure per package (bulk configuration via `npm trust`, npm >= 11.10.0).
- **Provenance** (Sigstore): the CI OIDC identity gets a short-lived certificate, the attestation lands in a public transparency log, npmjs.com shows the badge, consumers verify with `npm audit signatures`. Without OIDC, pass `--provenance` explicitly.
- **Staged publishing** (npm >= 11.15.0): the tarball waits in a stage queue until a human approves with a 2FA challenge - proof-of-presence even for non-interactive CI publishes; trusted publishers can be locked stage-only so a bare `npm publish` is rejected.

## Dependency confusion and typosquats

Dependency confusion: an attacker publishes your private unscoped name to public npm with a higher version and wins resolution. Defenses, strongest first:

1. Scope all internal code (`@yourorg/pkg`) - unscoped private names are the vulnerability.
2. Map the scope to the private registry in `.npmrc`.
3. Reserve the org scope on public npm.
4. Committed lockfile (integrity hashes catch a swap).
5. For critical build servers: egress-firewall to a single private proxy so nothing resolves from public npm directly.

Typosquats (`expresss`, `loadsh`): cooldown + behavioral scanning + reviewing every new dependency by hand.

## Private proxy registry

One controlled point all installs flow through - Verdaccio (self-hosted), Azure Artifacts, GitHub Packages, Artifactory (enterprise). Buys: caching/offline resilience, confusion protection via scope mapping, one chokepoint for scanning + cooldown policy. Run it in pure proxy mode so upstream signatures pass through unchanged and still verify against the upstream key.

## SBOM and the EU CRA

`npm sbom` emits CycloneDX or SPDX (needs node_modules, or `--package-lock-only`); `@cyclonedx/cyclonedx-npm` is the most accurate npm generator, `cdxgen` covers many ecosystems including .NET. EU Cyber Resilience Act timeline: vulnerability/incident reporting duties from Sep 11, 2026 (24h early warning, 72h full notification); full conformity incl. machine-readable SBOM and CE marking from Dec 11, 2027. The catch: the 24-hour reporting duty makes SBOM-driven component visibility a practical Sep-2026 requirement, not a 2027 one. Commercial delivery to EU clients is in scope (the open-source exemption does not cover it). Build the SBOM from what ships (`--omit=dev` view), not from declared dependencies; confirm exact format expectations with the client's compliance side - harmonized CRA standards were still settling as of mid-2026.
