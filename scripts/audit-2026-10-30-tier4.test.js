'use strict';
// Audit 2026-10-30, Tier 4 candidates: each test pins one A/B-only candidate's text. The A/B that decides whether it
// helps runs later; a red A/B reverts that id's commit alone, together with its test here.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('SKS-03: typescript-conventions sends a plain *.test.ts / *.spec.ts edit to the test skill, described not named', () =>
{
    const rule = read('stack', 'rules', 'typescript-conventions.md');
    const flat = rule.replace(/\s+/g, ' ');
    assert.ok(flat.includes('Writing or changing a `*.test.ts` / `*.spec.ts` outside Angular loads the skill covering plain TS/JS tests in the same action, before the first test edit lands, where installed.'), flat);
    assert.doesNotMatch(rule, /ts-js-testing/, 'not guaranteed beside the rule, so described (lint 25/26)');
    assert.match(read('docs', 'alfred-code.html'), /\["typescript-conventions", "[^"]*", "[^"]*\*\.test\.ts[^"]*"\]/, 'the inventory row says so');
});
