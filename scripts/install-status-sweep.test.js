'use strict';
// THE UPDATE SWEEPS THE OLD SESSION STATUS FOLDERS, END TO END THROUGH THE SEED - through 3.12.1 the status files lived
// in `<base>/.claude/session-inspector/status/` with an exclude pair in git's `info/exclude`. The install and the update
// now take them back at once, with the same 25 h guard the session start has: a root file younger than that may belong
// to a running session, so it stays for the next session start.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const status = require('../stack/hooks/session-status.js');
const { sweepSessionStatus } = require('./install/uninstall.js');

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
    assert.match(outs[0], /session status: 2 old status files removed from the old \.claude\/session-inspector\/status folders/);
    assert.match(outs[0], /\.git\/info\/exclude: 2 lines the stack added removed/);
    assert.match(outs[0], /session status: 1 old status folder kept - a file under 25 h old may belong to a running session; the next session start removes it/);
    assert.doesNotMatch(outs[1], /old status files? removed/, 'a re-run has nothing left to remove');
    assert.match(outs[1], /session status: 1 old status folder kept/, 'the kept line shows again while the file stays');
});

test('the current data-root status file survives the install and the update, at any age', POSIX_ONLY, () =>
{
    const current = (repo) => path.join(repo, '.alfred', 'state', 'sessions', 'status', 'sess-now.json');
    const { result: r } = seedRun(['install', 'update'], SELECTION, {
        env: COPY_ENV,
        prepare: (repo) => put(current(repo), '{"keep":true}', 40 * HOUR),
        inspect: (repo) => ({ there: fs.existsSync(current(repo)), text: fs.existsSync(current(repo)) ? fs.readFileSync(current(repo), 'utf8') : null }),
    });
    assert.deepStrictEqual(r, { there: true, text: '{"keep":true}' });
});

test('the 25 h guard: a root file 24 h 59 min old stays, one 25 h 1 min old goes', POSIX_ONLY, () =>
{
    const MINUTE = 60 * 1000;
    const { result: r } = seedRun(['install'], SELECTION, {
        env: COPY_ENV,
        prepare(repo)
        {
            put(path.join(inspector(repo), 'status', 'sess-under.json'), '{}', 24 * HOUR + 59 * MINUTE);
            put(path.join(inspector(repo), 'status', 'sess-over.json'), '{}', 25 * HOUR + MINUTE);
        },
        inspect: (repo) => ({
            under: fs.existsSync(path.join(inspector(repo), 'status', 'sess-under.json')),
            over: fs.existsSync(path.join(inspector(repo), 'status', 'sess-over.json')),
        }),
    });
    assert.deepStrictEqual(r, { under: true, over: false });
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

// The developer's own repository and its `.git/info/exclude` are never the target of a test: every project root is a temp folder.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'status-sweep-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
let seq = 0;
const tempRepo = (name) =>
{
    const repo = path.join(TMP, `${name}-${seq++}`);
    fs.mkdirSync(repo, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: repo, stdio: 'pipe' });
    return repo;
};

test('a sweep that throws is one log line, never a counted failure that stops the cascade', () =>
{
    const notes = [];
    const logs = [];
    const deps = { get clock() { throw new Error('boom'); } };
    sweepSessionStatus({ projectRoot: tempRepo('throws'), log: (l) => logs.push(l), note: (l) => notes.push(l), deps });
    assert.deepStrictEqual(notes, [], 'note() counts a failure and the installer skips the cascade on one');
    assert.strictEqual(logs.length, 1);
    assert.match(logs[0], /^  session status: not swept - .*boom.* - the next session start sweeps them$/);
});

test('a sweep past the exclude time limit is one log line naming the update, never a counted failure', POSIX_ONLY, () =>
{
    const repo = tempRepo('late');
    const sub = path.join(repo, 'sub');
    put(path.join(inspector(sub), 'status', 's2.json'), '{}', 30 * HOUR);
    const exclude = path.join(repo, '.git', 'info', 'exclude');
    fs.appendFileSync(exclude, `${status.EXCLUDE_COMMENT}\n/sub/.claude/session-inspector/status/\n`);
    put(path.join(repo, '.alfred', 'state', 'sessions', 'status-folders.json'), JSON.stringify([sub.split(path.sep).join('/')]));
    const notes = [];
    const logs = [];
    sweepSessionStatus({ projectRoot: repo, log: (l) => logs.push(l), note: (l) => notes.push(l), deps: { uptime: () => 9000 } });
    assert.deepStrictEqual(notes, [], 'a cut-short pass counts no failure');
    assert.strictEqual(logs.filter((l) => /cut short at the time limit/.test(l)).length, 1, logs.join('\n'));
    assert.match(logs.join('\n'), /session status: the exclude clean-up was cut short at the time limit .* - run \/alfred-code:update again to finish it/);
    assert.ok(fs.readFileSync(exclude, 'utf8').includes('/sub/.claude/session-inspector/status/'), 'the pair stays for the next run');
});
