'use strict';
// THE UPDATE SWEEPS THE OLD SESSION STATUS FOLDERS, END TO END THROUGH THE SEED - through 3.12.1 the status files lived
// in `<base>/.claude/session-inspector/status/` with an exclude pair in git's `info/exclude`. The install and the update
// now take them back at once, with the same 25 h guard the session start has: a root file younger than that may belong
// to a running session, so it stays for the next session start.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const status = require('../stack/hooks/session-status.js');

const COPY_ENV = { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' };
const SELECTION = 'rule alfred-docs-root\n';
const HOUR = 3600 * 1000;
const put = (file, text = '{}', ageMs = 0) =>
{
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    if (ageMs) { const at = new Date(Date.now() - ageMs); fs.utimesSync(file, at, at); }
};
const inspector = (base) => path.join(base, '.claude', 'session-inspector');

test('the install and the update remove the old status folders; a root file under 25 h stays', POSIX_ONLY, () =>
{
    assert.ok(status.SWEEP_ROOT_MIN_AGE_MS === 25 * HOUR, 'the guard is exported');
    const { result: r, outs } = seedRun(['install', 'update'], SELECTION, {
        env: COPY_ENV,
        prepare(repo)
        {
            const old = path.join(inspector(repo), 'status', 'sess-old_1.json');
            put(old, '{}', 30 * HOUR);
            put(path.join(inspector(repo), 'status', 'sess-young.json'), '{}', 1 * HOUR);
            put(path.join(inspector(repo), 'HANDOFF.md'), '# handoff\n');
            const sub = path.join(repo, 'sub');
            put(path.join(inspector(sub), 'status', 'sess-nested.json'), '{}', 30 * HOUR);
            put(path.join(repo, '.alfred', 'state', 'sessions', 'status-folders.json'), JSON.stringify([sub.split(path.sep).join('/')]));
            fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'),
                `*.mine\n${status.EXCLUDE_COMMENT}\n/sub/.claude/session-inspector/status/\n${status.EXCLUDE_COMMENT}\n/gone/.claude/session-inspector/status/\n`);
        },
        inspect(repo)
        {
            const has = (p) => fs.existsSync(p);
            return {
                old: has(path.join(inspector(repo), 'status', 'sess-old_1.json')),
                young: has(path.join(inspector(repo), 'status', 'sess-young.json')),
                handoff: has(path.join(inspector(repo), 'HANDOFF.md')),
                nested: has(path.join(repo, 'sub', '.claude', 'session-inspector', 'status', 'sess-nested.json')),
                nestedClaude: has(path.join(repo, 'sub', '.claude')),
                claude: has(path.join(repo, '.claude')),
                exclude: fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8'),
            };
        },
    });
    assert.strictEqual(r.old, false, 'a root file over 25 h old goes');
    assert.strictEqual(r.young, true, 'a root file under 25 h old stays for the next session start');
    assert.strictEqual(r.handoff, true, 'session-inspector\'s own file stays');
    assert.strictEqual(r.nested, false, 'a listed base is swept at any age');
    assert.strictEqual(r.nestedClaude, false, 'the folders the stack made in the base go');
    assert.strictEqual(r.claude, true, 'the install writes into .claude');
    assert.ok(r.exclude.includes('*.mine'), 'the user\'s own line stays');
    assert.ok(!r.exclude.includes('/sub/.claude'), 'the pair of a base with no file goes');
    assert.ok(!r.exclude.includes('/gone/.claude'), 'the pair of a folder that is not there goes');
    assert.match(outs[0], /session status: 2 old status files removed from \.claude\/session-inspector\/status/);
    assert.match(outs[0], /\.git\/info\/exclude: 2 lines the stack added removed/);
    assert.match(outs[0], /session status: 1 old status folder kept - a file under 25 h old may belong to a running session; the next session start removes it/);
    assert.doesNotMatch(outs[1], /old status files? removed/, 'a re-run has nothing left to remove');
    assert.match(outs[1], /session status: 1 old status folder kept/, 'the kept line shows again while the file stays');
});

test('a run with no old status folder prints no session status line', POSIX_ONLY, () =>
{
    const { outs } = seedRun(['install'], SELECTION, { env: COPY_ENV });
    assert.doesNotMatch(outs[0], /session status:/);
});

test('--print-plan sweeps nothing', POSIX_ONLY, () =>
{
    const { result: r } = seedRun(['install'], SELECTION, {
        env: COPY_ENV,
        args: ['--print-plan'],
        prepare: (repo) => put(path.join(inspector(repo), 'status', 'sess-old.json'), '{}', 30 * HOUR),
        inspect: (repo) => fs.existsSync(path.join(inspector(repo), 'status', 'sess-old.json')),
    });
    assert.strictEqual(r, true);
});
