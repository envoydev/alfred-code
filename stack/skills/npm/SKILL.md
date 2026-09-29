---
name: npm
description: "Use when working on package.json, package-lock.json or .npmrc, npm install/ci/publish, dependency updates or audits. Not for TypeScript style or CI authoring."
---

# npm - professional consuming, securing, publishing

npm's dominant risk is the supply chain: self-replicating worm campaigns (Shai-Hulud and successors, 2025-2026) spread through install-time scripts and stolen publish tokens across hundreds of packages. The defenses below are cheap and mechanical - treat them as the baseline, not as hardening for later. History, numbers, and the full tooling landscape: `references/supply-chain.md`.

## When to use

Use for consuming and publishing packages: package.json / package-lock.json / .npmrc work, npm install/ci/publish questions, dependency updates or vulnerability reports, supply-chain concerns, 'set up npm for this repo'.

Covers lockfile and npm ci discipline, the supply-chain baseline (ignore-scripts, min-release-age, allow-git, OIDC publishing), honest npm-audit gating, peer-conflict resolution, and ESM-first publishing.

Not for language-level TypeScript style or a framework's own conventions - those are their own skills where the project has them - or for authoring CI pipelines beyond npm's own steps, which is the pipeline-authoring skill's ground.

## Non-negotiables (any repo that has a package.json)

- **Commit `package-lock.json`; install with `npm ci` in every non-interactive context** - CI, Docker, reproducible local resets. `npm ci` installs strictly from the lockfile and fails on package.json drift; `npm install` is only for intentionally changing dependencies. Lockfile merge conflict: resolve package.json, regenerate with `npm install` (or `--package-lock-only`) - never hand-edit, never delete-and-regenerate blindly (that discards the pinned integrity hashes).
- **Project `.npmrc` baseline** (committed, non-secret):

  ```ini
  ignore-scripts=true
  min-release-age=7
  allow-git=none
  engine-strict=true
  ```

  Why each line: lifecycle scripts are the worm execution vector; malicious versions are usually pulled within hours, so a 7-day cooldown filters nearly all of them (needs npm >= 11.10.0); a git dependency can ship its own `.npmrc` that swaps the git binary path - code execution even with scripts ignored - so git/file/remote sources are shut off (npm >= 11.10.0; the v12 default). `ignore-scripts` still runs your own `npm start`/`test` scripts.

  Before the `ignore-scripts` line lands, list every dependency that carries an install script - the lockfile marks each one `"hasInstallScript": true`, a `binding.gyp` build included, which `npm query ':attr(scripts, [postinstall])'` misses (measured on npm 11.6.1):

  ```bash
  node -e 'for (const [k, v] of Object.entries(require("./package-lock.json").packages)) if (v.hasInstallScript) console.log(k)'
  ```

  Vet each one, then run the vetted ones explicitly after every install: `npm rebuild <name> --ignore-scripts=false` (a bare `npm rebuild` under the committed `ignore-scripts=true` runs nothing and still exits 0 - measured on the same npm). Record that command as a project script - `npm run` still runs the script it names - so CI runs the same list after `npm ci`. Close on the project's build and test run with their result lines quoted, never on the config echo alone. A repo that already has an `.npmrc` gets the baseline lines through ONE AskUserQuestion - merge them in (Recommended) or leave the file - never an overwrite.

  Verify the baseline landed - `npm config get ignore-scripts min-release-age allow-git engine-strict` prints one key-prefixed line per key and must show `ignore-scripts=true`, `min-release-age=7`, `allow-git=none`, `engine-strict=true` with no `npm warn Unknown project config` line above them. That warning means npm is older than the setting and the line is being ignored, not applied - npm still echoes the raw value from `.npmrc`, so the value alone proves nothing (measured on npm 11.6.1).
- **`dependencies` vs `devDependencies` discipline.** Build/test-only tooling (typescript, CLIs, linters, bundlers, test libs) goes in devDependencies; production images install with `npm ci --omit=dev`. Misclassification bloats the attack surface, the image, and the SBOM.
- **Pin Node**: `.nvmrc` + `engines.node`; CI reads `node-version-file: '.nvmrc'` with `cache: 'npm'` so dev and CI match exactly.
- **Scope internal packages** (`@yourorg/...`), map the scope to the private registry in `.npmrc` (`@yourorg:registry=...`), and reserve the scope on public npm - closes dependency confusion. Never commit auth tokens; CI injects `${NODE_AUTH_TOKEN}` or, better, uses OIDC and has no token at all.
- **One package manager per repo**, pinned via the `packageManager` field - mixed lockfiles are the real hazard. Corepack is not bundled from Node 25+ - install the manager explicitly (mechanics in `references/ci-and-operations.md`).
- **CI install + audit as separate steps**: `npm ci --no-audit --no-fund --prefer-offline --ignore-scripts`, then a dedicated gate - `npm audit --omit=dev --audit-level=high` with no `|| true`, plus `npm audit signatures` (verifies registry signatures and provenance for the installed tree). Never `npm audit fix --force` in automation - it silently takes breaking majors. npm audit sees only known CVEs with a high false-positive rate; the worm class needs a behavioral scanner on top - the layering is in `references/supply-chain.md`.

## Everyday dependency rules

- **Semver intent**: apps keep caret ranges in package.json and get reproducibility from the lockfile + `npm ci` - do not exact-pin package.json (it fights tooling and buries transitive drift). Exact pins only for a known-fragile package; tilde when you distrust a package's minors. The cooldown is the supply-chain lever, not pinning.
- **`overrides`** forces a transitive version (vulnerable indirect dep before the parent updates). Temporary by definition - document every override with its reason and remove it when upstream ships. A misspelled override key is silently ignored; verify with `npm ls <pkg>`. Changing code, not versions, is patch-package's job.
- **`--legacy-peer-deps` is a smell, not a fix** - it suppresses the peer check and can leave an unsupported combination installed. Fix order: align versions (upgrade the lagging package; check `npm info <pkg> peerDependencies`), then a targeted override, then wait for the compatible release. If unavoidable (Angular's tight peer ranges make it endemic; even `ng update` sometimes needs it): scope it to the single install and write down why. Never `legacy-peer-deps=true` globally.
- **Dead dependencies are found by a tool, not by eye**: `npx knip --dependencies` lists what package.json declares and no code imports, plus the reverse - an import package.json never lists, a transitive dependency you lean on by accident. `--production` scans only shipped code (tests, configs and devDependencies left out), so a package only tests use shows up there as an unused `dependencies` entry to move. A package referenced only from a tool's config (a lint plugin, a test preset) needs knip's plugin for that tool or an `ignoreDependencies` entry, never a delete on sight; `--fix` edits package.json, so read the report first. `depcheck` is archived and its own README points to knip - keep it only where a repo already runs it.
- **Scripts hygiene**: `FOO=bar` fails on Windows - use cross-env; use npm-run-all (`run-s`/`run-p`) over brittle `&&` chains; keep pre/post hooks shallow and predictable; prefer Node-based scripts for a mixed-OS team.

## Publishing (libraries)

The full authoring guide - exports maps, ESM-only vs dual, versioning, release automation - is `references/publishing.md`. The floor that applies to any publish:

- **`files` allowlist over `.npmignore`** - allowlists fail safe. Trap: `.npmignore` fully replaces `.gitignore` when both exist (not cumulative) - a common secret leak. Verify the exact tarball with `npm pack --dry-run` before every ship.
- **Scoped public packages need `"publishConfig": { "access": "public" }`** - scoped defaults to restricted.
- **Publish from CI via OIDC trusted publishing** - long-lived npm tokens are gone (classic tokens permanently revoked Dec 2025); OIDC generates provenance automatically, and staged publishing adds a human 2FA approval gate against stolen-credential republishing.

## CI, updates, and the wider toolbox

Cache keys per CI provider, Docker layering, Renovate/Dependabot cooldown + noise-reduction config, bundle/dedupe analysis, and the honest npm-vs-pnpm-vs-bun / monorepo-tooling state: `references/ci-and-operations.md`. Update bots need their own cooldown too - the package-manager cooldown fires at install time, the bot's at PR-open time. A security fix younger than the window is held back by `min-release-age` as well: `npm audit fix` keeps the vulnerable version, warns and exits non-zero. Exempt that one package with `min-release-age-exclude[]=<name>` rather than lowering the window for the whole tree.
