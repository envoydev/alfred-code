'use strict';
// scripts/install/release-notes.js - the update-history sections an update owes THIS install, by the stamp's version
// (audit 2026-10-20 C15: the whole release history rode every update's body, for installs long past it).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { compareVersions, sectionsOf, owed } = require('./install/release-notes.js');

const SCRIPT = path.join(__dirname, 'install', 'release-notes.js');
const HISTORY = path.join(__dirname, '..', 'setup-plugin', 'references', 'update-history.md');
const MD = ['# notes', '', 'intro text', '', '## in 2.0.0 - a', 'body a', '', '## after 2.1.0 - b', 'body b', '',
    '## in 2.2.0 - c', 'body c', '', '## table - names', '| was | now |', ''].join('\n');
const dirs = [];
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'release-notes-')); dirs.push(d); return d; };
const titles = (list) => list.map((s) => s.text.split('\n')[0]);

test('compareVersions: numeric triples, a missing version reads as the oldest', () =>
{
    assert.equal(compareVersions('2.10.0', '2.9.9'), 1);
    assert.equal(compareVersions('2.4.0', '2.4.0'), 0);
    assert.equal(compareVersions('', '1.0.0'), -1);
    assert.equal(compareVersions('2.5.0-rc.1', '2.5.0'), 0, 'a pre-release suffix is ignored');
});

test('owed: `in` is owed below its version, `after` at or below it, the table only on ask, an unknown stamp owes every dated one', () =>
{
    const s = sectionsOf(MD);
    assert.deepEqual(s.map((x) => x.kind), ['in', 'after', 'in', 'table'], 'the intro before the first heading is no section');
    assert.deepEqual(titles(owed(s, '1.9.0')), ['## in 2.0.0 - a', '## after 2.1.0 - b', '## in 2.2.0 - c']);
    assert.deepEqual(titles(owed(s, '2.0.0')), ['## after 2.1.0 - b', '## in 2.2.0 - c'], 'at 2.0.0 the 2.0.0 section is past');
    assert.deepEqual(titles(owed(s, '2.1.0')), ['## after 2.1.0 - b', '## in 2.2.0 - c'], 'at 2.1.0 the after-2.1.0 section is still owed');
    assert.deepEqual(titles(owed(s, '2.1.1')), ['## in 2.2.0 - c']);
    assert.deepEqual(titles(owed(s, '2.2.0')), []);
    assert.deepEqual(titles(owed(s, '')), ['## in 2.0.0 - a', '## after 2.1.0 - b', '## in 2.2.0 - c'], 'a legacy install owes every dated section');
    assert.deepEqual(titles(owed(s, 'garbage')), titles(owed(s, '')));
    assert.deepEqual(titles(owed(s, '9.0.0', { table: true })), ['## table - names']);
});

test('the CLI reads the stamp\'s version, prints only what is owed, and says so when nothing is', () =>
{
    const dir = tmp();
    const file = path.join(dir, 'h.md');
    fs.writeFileSync(file, MD);
    const run = (...a) => execFileSync('node', [SCRIPT, '--file', file, ...a], { encoding: 'utf8' });
    fs.mkdirSync(path.join(dir, '.claude'));
    fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), 'version: 2.1.0\nsha: abc\n');
    const out = run('--root', dir);
    assert.match(out, /^release notes since 2\.1\.0: 2 section\(s\)/);
    assert.match(out, /body b/);
    assert.match(out, /body c/);
    assert.doesNotMatch(out, /body a|\| was \|/);
    assert.match(run('--since', '2.2.0'), /^release notes: none owed since 2\.2\.0/);
    fs.rmSync(path.join(dir, '.claude', 'alfred-code.stamp'));
    assert.match(run('--root', dir), /^release notes since no recorded version: 3 section\(s\)/, 'no stamp owes every dated section');
    assert.match(execFileSync('node', [SCRIPT, '--file', path.join(dir, 'missing.md'), '--since', '1.0.0'], { encoding: 'utf8' }),
        /^release notes: unreadable \(ENOENT\)/, 'an unreadable file is one line and exit 0');
});

test('the shipped history: every heading places, the newest release owes nothing, and an old install owes every dated one', () =>
{
    const s = sectionsOf(fs.readFileSync(HISTORY, 'utf8'));
    const dated = s.filter((x) => x.kind !== 'table');
    assert.ok(dated.length >= 5 && s.some((x) => x.kind === 'table'));
    assert.deepEqual(owed(s, '1.0.0').length, dated.length);
    assert.deepEqual(owed(s, '99.0.0'), []);
    const versions = dated.map((x) => x.version);
    assert.deepEqual([...versions].sort(compareVersions), versions, 'sections run oldest first');
});

test('a 2.10.0 install owes the modes section, and it names the four flags and the old ones', () =>
{
    const s = sectionsOf(fs.readFileSync(HISTORY, 'utf8'));
    const modes = owed(s, '2.10.0').find((x) => x.text.startsWith('## after 2.10.1 - modes: four flags that last the session'));
    assert.ok(modes, 'owed to a 2.10.0 install');
    for (const flag of ['--mode-auto-run-on', '--mode-auto-run-off', '--mode-output-scorer-on', '--mode-output-scorer-off', '--auto-mode', '/mode-auto-run'])
        assert.ok(modes.text.includes(flag), flag);
});

// Complexity stage 1 (the whole-branch review, Important 1): the update owes a 3.10.0 install the note that names what
// stopped being guarded - a user who relied on a removed gate learns it from the update, not from a missing denial.
test('a 3.10.0 install owes the stage 1 guard note, and it names every gate that left', () =>
{
    const s = sectionsOf(fs.readFileSync(HISTORY, 'utf8'));
    const note = owed(s, '3.10.0').find((x) => x.text.startsWith('## after 3.10.0 - '));
    assert.ok(note, 'owed to a 3.10.0 install');
    for (const word of ['launch_executable', 'browser_run_code_unsafe', 'browser_file_upload', 'ALFRED_CODE_FORGE_WATCH',
        'git add -N', 'commit-tree', 'reflog expire', 'ALFRED_CODE_HOOKS_OFF', 'minimal', 'DESKTOP-EXEC-ALLOW', 'CONFIG-EDIT-ALLOW', 'UNTRACKED-ALLOW'])
        assert.ok(note.text.includes(word), word);
    assert.deepEqual(owed(s, '3.10.1').filter((x) => x === note), [], 'a later install owes it no more');
});

// The fixed root (the user's ruling of 2026-11-11): an install owes the note that says where its data now lives, what
// the update moves, and that the two flags are ignored.
test('fixed root: the release note says the data root is always .alfred', () =>
{
    const s = sectionsOf(fs.readFileSync(HISTORY, 'utf8'));
    const note = owed(s, '3.10.0').find((x) => /^## after 3\.10\.0 - the data root is always \.alfred/.test(x.text));
    assert.ok(note, 'owed to a 3.10.0 install');
    assert.match(note.text, /data root is always `?\.alfred/);
    for (const word of ['--data-path', '--data-move', 'ALFRED_CODE_DATA_PATH', '!! data root:', 'Restart a session']) assert.ok(note.text.includes(word), word);
    assert.deepEqual(owed(s, '3.10.1').filter((x) => x === note), [], 'a later install owes it no more');
});

// The mode commands (the owner's request of 2026-11-12): an install owes the note that names the three commands, the
// two settings that last, and what a typed flag does now.
test('mode commands: the release note names the three commands and says the flags are gone', () =>
{
    const s = sectionsOf(fs.readFileSync(HISTORY, 'utf8'));
    const note = owed(s, '3.10.0').find((x) => x.text.startsWith('## after 3.10.0 - modes are commands'));
    assert.ok(note, 'owed to a 3.10.0 install');
    for (const word of ['/alfred-code:mode:auto-run', '/alfred-code:mode:scoring', '/alfred-code:mode:auto-compact', 'on|off', '--mode-auto-run-on',
        'attended', 'a retired off flag ends nothing', 'ALFRED_CODE_SCORING', 'ALFRED_CODE_AUTO_COMPACT', '/mode-auto-run <request>']) assert.ok(note.text.includes(word), word);
    // mode commands v2 stage 3: a mode stays on until its off, in the checkout's own settings.local.json; a 0 left from
    // before switches nothing; the key is no longer seeded; the session-start line is the first notice
    for (const word of ['new sessions included', '.claude/settings.local.json', 'no longer seeded', 'autoCompactEnabled',
        'switches nothing until', 'the session-start line', 'scoring on 80']) assert.ok(note.text.includes(word), word);
    assert.doesNotMatch(note.text, /A mode lasts the session|ends with the session/, 'a mode no longer ends with the session');
    assert.deepEqual(owed(s, '3.10.1').filter((x) => x === note), [], 'a later install owes it no more');
});

// Mode v2 stage 1 (3.11.0): the grader's names say scoring; the note names each new name beside its old one, and the
// skill and the seat by their new names only (the upgrade table is the old names' one home).
test('the scoring rename: the release note names each new name beside its old one', () =>
{
    const s = sectionsOf(fs.readFileSync(HISTORY, 'utf8'));
    const note = owed(s, '3.10.0').find((x) => x.text.startsWith('## after 3.10.0 - the grader\'s names say scoring'));
    assert.ok(note, 'owed to a 3.10.0 install');
    for (const word of ['/mode-output-scoring', 'output-scoring', '/alfred-code:update', '4.0.0']) assert.ok(note.text.includes(word), word);
    for (const k of ['', '_LEVEL', '_OUTPUTS', '_ROUNDS'])
        assert.match(note.text, new RegExp(`ALFRED_CODE_SCORER${k}\\b.*ALFRED_CODE_SCORING${k}\\b`), `ALFRED_CODE_SCORER${k} beside its new name`);
    for (const hook of ['guard-answer', 'guard-stop-contract']) assert.match(note.text, new RegExp(`${hook}:scorer\\b.*${hook}:scoring\\b`), hook);
    assert.doesNotMatch(note.text, /mode-output-scorer\b|output-scorer\b/, 'the old skill and seat names live in the upgrade table only');   // legacy
    assert.deepEqual(owed(s, '3.10.1').filter((x) => x === note), [], 'a later install owes it no more');
});
