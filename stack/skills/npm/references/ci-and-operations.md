# npm in CI and operations - speed, update bots, the wider toolbox

Loaded from the `npm` skill when wiring CI installs, configuring update bots, chasing bloat, or choosing package-manager/monorepo tooling.

## CI install speed

- **GitHub Actions**: `actions/setup-node` with `node-version-file: '.nvmrc'` and `cache: 'npm'` (keyed on the lockfile) - a warm `npm ci` runs in ~10s. Pin the action to a full commit SHA, never a moving major tag - the tag is mutable, and the action runs with the workflow's token.
- **Azure DevOps**: the Cache task keyed on the lockfile. **GitLab**: `cache:key:files: [package-lock.json]`.
- Cache keys include platform + Node version + lockfile hash. Split lint/type-check/test into parallel jobs, fail fast.
- **Docker**: copy only `package.json` + `package-lock.json`, then `npm ci --ignore-scripts` (or `--omit=dev` for the runtime image), then copy sources - preserves the layer cache.
- Install flags: `npm ci --no-audit --no-fund --prefer-offline --ignore-scripts`; `progress=false`/`CI=true` for quiet logs; audit runs as its own gate, never inline.
- Offline/air-gapped: `npm cache verify`, `--prefer-offline`, or a private proxy as the source of truth.

## Update bots without the noise

- **Renovate** (more configurable, best monorepo support): base on `config:best-practices` (3-day npm cooldown built in), group non-major devDependency updates, auto-merge patch/minor for trusted dev deps only behind a green suite, schedule off-hours.
- **Dependabot** (zero-config, GitHub-native): enable cooldown (`default-days` + per-semver overrides), group updates, cap open PRs.
- Both: security updates bypass the cooldown; never auto-merge majors.

## Bloat and duplication

`npm ls --all` for the tree; source-map-explorer / webpack-bundle-analyzer (or the esbuild/Vite analogs) for bundle weight; `npm dedupe` or a unifying override for duplicate transitive versions; prefer ESM dependencies for tree-shaking; keep devDependencies out of production installs and images.

## Package managers in 2026 - honest state

| Manager | State | Reach for it when |
|---|---|---|
| npm 11.x | universal default, ships with Node, gap largely closed | legacy, maximum compatibility, no pain points |
| pnpm 10/11 | de facto default for new projects/monorepos: content-addressable store, strict resolution (no phantom deps), cooldown on by default in pnpm 11, lifecycle scripts opt-in | monorepo pain, disk/CI cost, phantom-dependency correctness |
| Yarn v1 | maintenance mode - no new projects | never for new work |
| Yarn Berry v4 | fast PnP, but toolchain-compat complexity | only if the whole stack supports PnP |
| Bun 1.3 | fastest installs (vendor-cited 10-30x cold; treat as approximate), residual Node-compat edges | raw solo-project speed |

The rule that outranks the choice: **one package manager per repo, pinned via `packageManager`** - mixed lockfiles are the real hazard. Corepack is not bundled from Node 25+ (`packageManager` is still respected): install the manager explicitly via a setup step, Volta, or the base image.

## Monorepo tooling

npm workspaces suffice for a handful of packages sharing a lockfile - they have no task orchestration, caching, or affected-graph analysis, and a real monorepo on bare workspaces with manual dependency tracking is technical debt. Default: **pnpm workspaces + Turborepo** (one config file, remote caching). Graduate to **Nx** for affected-graph CI, code generation, boundary enforcement, or polyglot repos (first-party .NET/Maven plugins exist - relevant for a C# shop). Roughly: past ~100 packages or affected-graph needs, Nx. Switching costs are real - pick one, standardize, don't migrate mid-flight.

## Node targeting

Node 24 is Active LTS - target it for new work; Node 22 is Maintenance LTS (EOL Apr 2027). From Oct 2026 the release model changes: one major per year (every April), every release becomes LTS, plus an Alpha channel.
