<!-- planted: missing a rollback point - neither stage names where to return to -->
# upgrade-plan-no-rollback

## TASK

Upgrade the project from Node 18 to Node 22.

## DRAFT

playbooks: read - Package majors (either stack); The runtime-break catalog

Located usage: package.json `"test": "node --test"`; test/orderService.test.js uses `node:test` and `node:assert`; src/ uses CommonJS `require` only, no dependencies.

## Stage 1 - Node 18 to 20

- Edits (hand): `engines` `"node": ">=20"` in package.json; a `.nvmrc` with `20`.
- Breaking changes the located usage reaches: none found in the Node 20 changelog (https://github.com/nodejs/node/blob/main/doc/changelogs/CHANGELOG_V20.md).
- Verification: `npm test` under Node 20 - 2 pass.

## Stage 2 - Node 20 to 22

- Edits (hand): `engines` to `">=22"`; `.nvmrc` to `22`.
- Breaking changes the located usage reaches: `node --test` with no arguments finds files by glob patterns from Node 21 on (CHANGELOG_V21.md - unverified until re-fetched); test/orderService.test.js matches both, no edit.
- Verification: `npm test` under Node 22 - 2 pass, and the run lists test/orderService.test.js.

No engine-applied edits; every edit is a hand edit.

Open question for you: does production take Node from the host or from a container image?
