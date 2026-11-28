'use strict';
// The 3.19.6 G1 seed line (a push the user did not ask for still waits) was reworded after that release. An install that
// took the 3.19.6 seed holds its G1 text, so restoreLocked must read it as an earlier seed and update it, never as a user
// edit. Each test starts from the old state and ends in the new one.
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const docs = require('./install/docs.js');
const selection = require('./install/selection.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'install-git-seed-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const PREFS = '.alfred/docs/preferences';
const FILE = `${PREFS}/GIT-PREFERENCES.md`;
const SEED_3196 = () => fs.readFileSync(path.join(__dirname, 'install', 'git-seed-3.19.6.md'), 'utf8').replace(/__TODAY__/g, '2026-11-26');
const CURRENT = () => fs.readFileSync(path.join(__dirname, '..', 'stack', 'skills', 'capture-preferences', 'references', 'git-seed.md'), 'utf8');
const NEW_CLAUSE = /unless the user's typed words in this exchange asked for that push or publish, a go-ahead to it included/;

let seq = 0;
function project(body)
{
    const root = path.join(TMP, `p-${seq++}`);
    fs.mkdirSync(path.join(root, PREFS), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.writeFileSync(path.join(root, FILE), body);
    return root;
}
const run = (root, log = () => {}) => docs.migrateDocsDomains({ projectRoot: root, docsPath: '.alfred/docs', rules: selection.generatedRules(root), instructions: selection.instructionFiles(root), log });
const read = (root) => fs.readFileSync(path.join(root, FILE), 'utf8');
const g1Rule = (text) => /^## G1 [^\n]*\n(?:[^\n]*\n)*?- Rule: ([^\n]*)/m.exec(text)[1];

test('the 3.19.6 seed file is the text the release shipped, with the old G1 line and no push clause', () =>
{
    const old = SEED_3196();
    assert.doesNotMatch(old, NEW_CLAUSE);
    assert.match(old, /a push or publish still waits for the user\./);
    assert.match(CURRENT(), NEW_CLAUSE, 'the current seed carries the new clause');
});

test('an update over the 3.19.6 G1 entry writes the new line and names it updated, not restored', () =>
{
    const root = project(SEED_3196());
    const logs = [];
    const out = run(root, (m) => logs.push(m));
    assert.match(g1Rule(read(root)), NEW_CLAUSE);
    assert.match(out.preferences.git, /updated consent/);
    assert.doesNotMatch(out.preferences.git, /restored/);
    assert.ok(logs.some((m) => /updated the locked 'consent' entry \(G1\) to this release's text/.test(m)), logs.join(' | '));
    assert.ok(!logs.some((m) => /restored the locked|!!/.test(m)), logs.join(' | '));
});

test('an edited G1 entry is restored as an edited locked entry is today, with the edit named', () =>
{
    const edited = SEED_3196().replace('Do NOT commit or push until', 'My own words: wait to commit or push until');
    assert.notStrictEqual(edited, SEED_3196());
    const root = project(edited);
    const logs = [];
    const out = run(root, (m) => logs.push(m));
    assert.match(out.preferences.git, /restored consent/);
    assert.doesNotMatch(out.preferences.git, /updated consent/);
    assert.match(g1Rule(read(root)), NEW_CLAUSE);
    assert.ok(logs.some((m) => /restored the locked 'consent' entry \(G1\) from the seed; it read: Rule: My own words: wait to commit/.test(m)), logs.join(' | '));
});

test('a second update over the 3.19.6 doc changes nothing', () =>
{
    const root = project(SEED_3196());
    run(root);
    const first = read(root);
    const logs = [];
    assert.strictEqual(run(root, (m) => logs.push(m)).preferences.git, 'present');
    assert.strictEqual(read(root), first);
    assert.ok(!logs.some((m) => /updated|restored/.test(m)), logs.join(' | '));
});
