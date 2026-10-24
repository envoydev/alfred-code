<!-- planted: none -->
# upgrade-plan-strong

## TASK

Upgrade the project from Node 18 to Node 22.

## DRAFT

playbooks: read - Package majors (either stack); The runtime-break catalog

Located usage: package.json `"test": "node --test"`; test/orderService.test.js uses `node:test` and `node:assert`; src/ uses `require` only (CommonJS), no native addons, no dependencies in package.json.

## Stage 1 - Node 18 to 20

- Edits (hand): an `engines` entry `"node": ">=20"` in package.json; a `.nvmrc` with `20`.
- Breaking changes the located usage reaches: none found - the Node 20 changelog (https://github.com/nodejs/node/blob/main/doc/changelogs/CHANGELOG_V20.md, its 'Notable changes' for 20.0.0) lists no change to `node:test`'s `test()` or `node:assert`'s `strictEqual` / `throws` as this project calls them.
- Verification: `npm test` under Node 20 - 2 pass, 0 fail.
- Rollback point: the commit before stage 1 (tag it `pre-node-20`); revert to it and reinstall Node 18.

## Stage 2 - Node 20 to 22

- Edits (hand): `engines` to `">=22"`; `.nvmrc` to `22`.
- Breaking changes the located usage reaches: `node --test` with no arguments finds its files by glob patterns from Node 21 on, instead of walking a `test` folder (CHANGELOG_V21.md, 21.0.0 notable changes - unverified until re-fetched); test/orderService.test.js matches both rules, so no edit, and the stage's run proves it found the file.
- Verification: `npm test` under Node 22 - 2 pass, 0 fail, and the run lists test/orderService.test.js.
- Rollback point: the stage 1 commit (tag it `node-20`).

No engine-applied edits - nothing here has a codemod; every edit above is a hand edit.

Open question for you: does production take Node from the host's package manager or from a container image? The stage edits pin the project, not the host - the host's Node is yours to move.
