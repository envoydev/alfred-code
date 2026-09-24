'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'stamp-compare.js');

function makeDirs({ stamp, releaseSource, fixture })
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stampcmp-'));
    const snap = path.join(root, 'repo');
    fs.mkdirSync(snap, { recursive: true });
    if (releaseSource !== null) fs.writeFileSync(path.join(snap, 'RELEASE-SOURCE'), releaseSource);
    const stampFile = path.join(root, 'alfred-code.stamp');
    if (stamp !== null) fs.writeFileSync(stampFile, stamp);
    const fixtureFile = path.join(root, 'compare.json');
    if (fixture) fs.writeFileSync(fixtureFile, JSON.stringify(fixture));
    return { snap, stampFile, fixtureFile };
}

function run(args)
{
    try { return { out: execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' }), code: 0 }; }
    catch (e) { return { out: e.stdout, code: e.status }; }
}

const FIXTURE = { files: [
    { status: 'modified', filename: 'stack/skills/csharp/SKILL.md' },
    { status: 'removed', filename: 'stack/rules/web-conventions.md' },
    { status: 'renamed', filename: 'stack/agents/new-seat.md', previous_filename: 'stack/agents/old-seat.md' },
    { status: 'modified', filename: 'README.md' },                       // outside stack paths - filtered out
    { status: 'modified', filename: 'scripts/lint-skills.js' },          // outside stack paths - filtered out
] };

test('emits version delta + filtered status lines, renames carry the old path', () => {
    const { snap, stampFile, fixtureFile } = makeDirs({
        stamp: 'sha: aaa111\nversion: 0.2.17\n',
        releaseSource: 'sha: bbb222\nversion: 0.2.19\n',
        fixture: FIXTURE,
    });
    const { out, code } = run(['--snapshot', snap, '--stamp', stampFile, '--fixture', fixtureFile]);
    assert.strictEqual(code, 0);
    const lines = out.trim().split('\n');
    assert.strictEqual(lines[0], 'version: 0.2.17 -> 0.2.19');
    assert.strictEqual(lines[1], 'base: aaa111 head: bbb222');
    assert.deepStrictEqual(lines.slice(2), [
        'modified\tstack/skills/csharp/SKILL.md',
        'removed\tstack/rules/web-conventions.md',
        'renamed\tstack/agents/new-seat.md\t<- stack/agents/old-seat.md',
    ]);
});

test('no stamp -> version unknown, no-stamp line, exit 2 (refresh-only signal)', () => {
    const { snap, stampFile } = makeDirs({ stamp: null, releaseSource: 'sha: bbb222\nversion: 0.2.19\n' });
    const { out, code } = run(['--snapshot', snap, '--stamp', stampFile]);
    assert.strictEqual(code, 2);
    assert.match(out, /^version: unknown$/m);
    assert.match(out, /^no-stamp$/m);
});

test('same sha both sides -> empty diff, no network, exit 0', () => {
    const { snap, stampFile } = makeDirs({
        stamp: 'sha: same999\nversion: 0.2.19\n',
        releaseSource: 'sha: same999\nversion: 0.2.19\n',
    });
    const { out, code } = run(['--snapshot', snap, '--stamp', stampFile]);
    assert.strictEqual(code, 0);
    assert.strictEqual(out.trim().split('\n').length, 2);   // version + base lines only
});

test('300-file fixture leads with TRUNCATED', () => {
    const files = Array.from({ length: 300 }, (_, i) => ({ status: 'modified', filename: `stack/skills/s${i}/SKILL.md` }));
    const { snap, stampFile, fixtureFile } = makeDirs({
        stamp: 'sha: aaa111\nversion: 0.2.17\n',
        releaseSource: 'sha: bbb222\nversion: 0.2.19\n',
        fixture: { files },
    });
    const { out } = run(['--snapshot', snap, '--stamp', stampFile, '--fixture', fixtureFile]);
    assert.match(out.trim().split('\n')[2], /^TRUNCATED - /);
});

// The commands branch on exit 2 = no-stamp; a usage error must never masquerade as that signal.
test('usage error exits 1 and prints no signal line', () => {
    const { out, code } = run([]);
    assert.strictEqual(code, 1);
    assert.ok(!/no-stamp|compare-unreachable/.test(out || ''), 'no signal line on a usage error');
});
