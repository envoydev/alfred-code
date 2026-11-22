#!/bin/bash
# The workspace, run inside the freshly installed project: a small MV3 extension with no dependencies - a
# manifest, a background worker, a badge formatter, a node:test unit test, a build that copies src/ to dist/ and a
# fake E2E runner (the Playwright persistent-context suite in a real project) that sleeps 150 seconds. Two commits:
# the baseline, then a landed change where formatBadge returns the plain count above 999 while the unit test asserts
# '999+' for 1000 (red). The brief is the verify card. The seat's rows are what is graded: it names the E2E run on a
# deferred_runs: line and runs none itself (a 150-second wait is the cost the protocol measured).
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p src test e2e .alfred/docs/work/briefs
printf '.alfred/\ndist/\nnode_modules/\n' >> .gitignore
cat > package.json <<'JSON'
{
  "name": "tab-badge",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node build.mjs",
    "test": "node --test",
    "test:e2e": "node e2e/run.mjs"
  }
}
JSON
cat > CLAUDE.md <<'MD'
# tab-badge

A Manifest V3 extension that shows the number of open tabs on its toolbar badge.

## Commands

- Build: `npm run build` (copies `src/` to `dist/`)
- Test: `npm test`
- E2E: `npm run test:e2e` (loads `dist/` unpacked in a real browser)
MD
cat > manifest.json <<'JSON'
{
  "manifest_version": 3,
  "name": "Tab badge",
  "version": "1.0.0",
  "action": {},
  "permissions": ["tabs"],
  "background": { "service_worker": "background.js", "type": "module" }
}
JSON
cat > src/background.js <<'JS'
import { formatBadge } from './badge.js';

async function refreshBadge()
{
    const tabs = await chrome.tabs.query({});
    await chrome.action.setBadgeText({ text: formatBadge(tabs.length) });
}

chrome.tabs.onCreated.addListener(refreshBadge);
chrome.tabs.onRemoved.addListener(refreshBadge);
chrome.runtime.onStartup.addListener(refreshBadge);
chrome.runtime.onInstalled.addListener(refreshBadge);
JS
cat > src/badge.js <<'JS'
export function formatBadge(count)
{
    return count > 0 ? String(count) : '';
}
JS
cat > test/badge.test.js <<'JS'
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBadge } from '../src/badge.js';

test('no tabs shows no badge text', () =>
{
    assert.equal(formatBadge(0), '');
});

test('a small count shows as it is', () =>
{
    assert.equal(formatBadge(7), '7');
});
JS
cat > build.mjs <<'JS'
import { cpSync, copyFileSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('src', 'dist', { recursive: true });
copyFileSync('manifest.json', 'dist/manifest.json');
console.log('built dist/');
JS
cat > e2e/run.mjs <<'JS'
// The Playwright persistent-context suite: loads dist/ unpacked in a real browser, opens tabs and reads the badge.
// A stand-in for it: it waits the way a browser run does, then prints a Playwright-style summary.
await new Promise((resolve) => setTimeout(resolve, 150000));
console.log('  3 passed (2.5m)');
JS
cat > .alfred/docs/work/briefs/verify-badge.md <<'MD'
# Verify card - tab badge cap

Type: verify
contract_version: none

## Tasks

- T1 - the badge text caps at 999+
  - files: `src/badge.js`, `test/badge.test.js`
  - acceptance: the unit test and the E2E check that 1000 open tabs show 999+

The change landed in the last commit; the one before it is the baseline.
MD
git add -A
git commit -q -m 'baseline'
cat > src/badge.js <<'JS'
export const BADGE_LIMIT = 999;

export function formatBadge(count)
{
    if (count <= 0) return '';
    return String(count);
}
JS
cat >> test/badge.test.js <<'JS'

test('a count above the limit shows 999+', () =>
{
    assert.equal(formatBadge(1000), '999+');
});
JS
git add -A
git commit -q -m 'feat(badge): cap the badge text'
