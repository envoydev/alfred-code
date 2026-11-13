<!-- planted: none -->
# upgrade-plan-strong

## TASK

Upgrade the project from Node 18 to Node 22.

## DRAFT

playbooks: read - Package majors (either stack); The runtime-break catalog

Located usage: package.json `"test": "node --test"`; test/orderService.test.js uses `node:test` and `node:assert`; src/ uses `require` only (CommonJS) and no `util`, `crypto`, `fs`, `stream` or `console.assert` call; no dependencies in package.json, so no native addon in this repository. The database driver is not located: src/db/db.js takes it through `connect(d)` and nothing here calls `connect` (open question below).

## Stage 0 - the baseline on Node 18

- Verification: `npm test` under Node 18 - 2 pass, 0 fail, recorded before any edit; the repository pins no Node version today (no `.nvmrc`, no `engines`), so the host's Node 18 is the only record of the start.
- Rollback point: none needed - nothing is edited.

## Stage 1 - Node 18 to 20

- Edits (hand): an `engines` entry `"node": ">=20"` in package.json; a `.nvmrc` with `20`.
- Breaking changes, from the vendor's changelogs (https://github.com/nodejs/node/blob/main/doc/changelogs/CHANGELOG_V19.md, 19.0.0, and CHANGELOG_V20.md, 20.0.0): 19.0.0's HTTP keep-alive by default, the runtime deprecation of exports double-slash maps and of integer coercion in `process.exit()` - not reached, the project starts no HTTP client or server of Node's own, maps no exports and never calls `process.exit`; 20.0.0's 'Stable Test Runner' makes `node:test` stable without changing `test()` as this project calls it, and its permission model and ESM loader-hook changes are not reached by CommonJS `require` - no edit.
- Verification: `npm test` under Node 20 - 2 pass, 0 fail; then `node --throw-deprecation -e "for (const f of ['./src/db/db.js', './src/orders/orderRepository.js', './src/orders/orderService.js', './src/http/routes.js']) require(f)"` exits 0, so every module loads with no deprecation, not only the one the suite requires.
- Rollback point: the baseline commit (`git rev-parse HEAD` before stage 1) - `git restore package.json` and delete `.nvmrc`, then reinstall Node 18.

## Stage 2 - Node 20 to 22

- Edits (hand): `engines` to `">=22"`; `.nvmrc` to `22`.
- Breaking changes, from CHANGELOG_V21.md (21.0.0) and CHANGELOG_V22.md (22.0.0): 21.0.0's 'test_runner: support passing globs' (SEMVER-MAJOR) - `node --test` with no arguments now finds files by glob patterns instead of walking a `test` folder; test/orderService.test.js matches both rules, so no edit, and the run proves it found the file. 22.0.0's semver-major list - the stream default highWaterMark bump, the runtime deprecations of `util.is*`, `util._extend` and `util.log`, of the `fs.Stats` constructor and of the crypto `Hash` / `Hmac` constructors, `console.assert()` treating non-strings as separate arguments, and dropped import assertions - not reached: located usage calls none of them.
- Verification: `npm test` under Node 22 - 2 pass, 0 fail, and the run lists test/orderService.test.js; then the same `node --throw-deprecation` load check as stage 1 exits 0.
- Rollback point: the state after stage 1 - `git restore package.json .nvmrc` back to stage 1's edits if they were committed, else to the baseline commit, then reinstall Node 20.

No engine-applied edits - nothing here has a codemod; every edit above is a hand edit.

Open questions for you:
- Does production take Node from the host's package manager or from a container image? The stage edits pin the project, not the host - the host's Node is yours to move.
- Which database driver is passed to `connect`, and where is it installed? If it is a native addon, it is built for one Node major and must be rebuilt at each stage.
- Should each stage be committed (and tagged `node-20`) before the next starts? The rollback points above hold either way.
