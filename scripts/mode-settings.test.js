'use strict';
// stack/hooks/mode-settings.js - the mode file's trust test (localTrust) and its one git call (localGitStatus).
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const M = require('../stack/hooks/mode-settings.js');

const TMP = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mode-settings-')));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const GIT = spawnSync('git', ['--version']).status === 0;
let seq = 0;
const tree = () => { const d = path.join(TMP, `t${seq++}`); fs.mkdirSync(d, { recursive: true }); return d; };
// A repository as gitTopOf reads one: a `.git` folder holding HEAD.
const repo = () => { const d = tree(); fs.mkdirSync(path.join(d, '.git')); fs.writeFileSync(path.join(d, '.git', 'HEAD'), 'ref: refs/heads/main\n'); return d; };
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(TMP, 'none.gitconfig'), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const git = (cwd, args) => spawnSync('git', args, { cwd, env: gitEnv, encoding: 'utf8' });
const gitInit = () => { const d = tree(); git(d, ['init', '-q']); return d; };
const linkedClaude = (base) => { const real = tree(); fs.symlinkSync(real, path.join(base, '.claude'), 'dir'); return base; };
const nestedGitClaude = (base) => { fs.mkdirSync(path.join(base, '.claude', '.git'), { recursive: true }); return base; };
const withEnv = (vars, fn) =>
{
    const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    try { return fn(); }
    finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
const withPath = (value, fn) => withEnv({ PATH: value }, fn);

const file = (root) => path.join(root, '.claude', 'settings.local.json');
const never = () => { throw new Error('git was asked'); };

test('no repository: own, and git is never asked - file absent, .claude absent', () => assert.strictEqual(M.localTrust(file(tree()), never), 'own'));
test('in a repository: 0 tracked, 1 own, 128 and null unknown', () =>
{
    const root = repo();
    for (const [status, want] of [[0, 'tracked'], [1, 'own'], [128, 'unknown'], [null, 'unknown']]) assert.strictEqual(M.localTrust(file(root), () => status), want, String(status));
});
test('a tracked file deleted from disk is still tracked', () => assert.strictEqual(M.localTrust(file(repo()), () => 0), 'tracked'));
test('.claude a link, or holding .git: unknown, inside a repository and outside one', { skip: process.platform === 'win32' }, () =>
{
    for (const make of [linkedClaude, nestedGitClaude]) for (const base of [repo(), tree()]) assert.strictEqual(M.localTrust(file(make(base)), () => 1), 'unknown');
});
test('the real git: an untracked file in a real repository is own, a committed one tracked', { skip: !GIT }, () =>
{
    const root = gitInit();
    write(file(root), '{}');
    assert.strictEqual(M.localTrust(file(root)), 'own');
    git(root, ['add', '-f', '.claude/settings.local.json']);
    git(root, ['commit', '-qm', 'x']);
    assert.strictEqual(M.localTrust(file(root)), 'tracked');
});
test('git off PATH inside a repository: localGitStatus is null', () => assert.strictEqual(withPath('', () => M.localGitStatus(file(repo()))), null));
test('an inherited GIT_DIR does not point the call elsewhere', { skip: !GIT }, () =>
{
    const root = gitInit();
    write(file(root), '{}');
    assert.strictEqual(withEnv({ GIT_DIR: path.join(tree(), 'nowhere') }, () => M.localTrust(file(root))), 'own');
});

// ---- writeModes, the one writer (Task 3) ----
const layout = require('../stack/hooks/layout.js');
const K = (s) => `ALFRED_CODE_${s}`;
const K1M = 'claude-opus-5-5';
const WINDOW_SEEDS = { ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '400000', ALFRED_CODE_CONTEXT_WINDOW_FOR_300K: '280000',
    ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '180000', ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '180000' };
const ENV = { ...WINDOW_SEEDS, CLAUDE_CONFIG_DIR: tree() };
const P = () => tree();
const modeFileOf = (root) => layout.modeFile(root);
const raw = (root) => fs.readFileSync(modeFileOf(root), 'utf8');
const obj = (root) => JSON.parse(raw(root).replace(/^\uFEFF/, ''));
const putRaw = (root, text) => write(modeFileOf(root), text);
const put = (root, o) => putRaw(root, `${JSON.stringify(o, null, 2)}\n`);
const putShared = (root, o) => write(path.join(root, '.claude', 'settings.json'), JSON.stringify(o));
const setVars = (root, text) => write(path.join(root, '.alfred', '.variables'), text);
function topLevelWindow(root, where)
{
    if (where === 'mode') { put(root, { autoCompactWindow: 300000 }); return ENV; }
    if (where === 'shared') { putShared(root, { autoCompactWindow: 300000 }); return ENV; }
    const acct = tree();
    write(path.join(acct, 'settings.json'), JSON.stringify({ autoCompactWindow: 300000 }));
    return { ...ENV, CLAUDE_CONFIG_DIR: acct };
}
function trackedRepo()
{
    const root = gitInit();
    put(root, { env: {} });
    git(root, ['add', '-f', '.claude/settings.local.json']);
    git(root, ['commit', '-qm', 'x']);
    return root;
}
function linkedClaudeRepo()
{
    const root = gitInit();
    linkedClaude(root);
    put(root, { env: {} });
    return root;
}

test('absent file: created with the block alone, .claude made', () =>
{
    const root = P();
    const r = M.writeModes(root, { [K('SCORING')]: '1', [K('SCORING_LEVEL')]: '75' }, ENV);
    assert.deepStrictEqual({ changed: r.changed, why: r.why }, { changed: true, why: '' });
    assert.deepStrictEqual(obj(root), { env: { [K('SCORING')]: '1', [K('SCORING_LEVEL')]: '75' } });
});
test('the table of 3.4', () =>
{
    const root = P();
    M.writeModes(root, { [K('AUTO_COMPACT')]: '1' }, ENV);
    assert.strictEqual(obj(root).autoCompactEnabled, true);
    assert.strictEqual(obj(root).modelSettings[K1M].autoCompactWindow, 400000);
    M.writeModes(root, { [K('AUTO_COMPACT')]: '0' }, ENV);
    assert.strictEqual(obj(root).autoCompactEnabled, false);
    assert.strictEqual(obj(root).modelSettings[K1M].autoCompactWindow, 400000);
    M.writeModes(root, { [K('AUTO_COMPACT')]: null }, ENV);
    assert.deepStrictEqual(obj(root), {});
});
test('a 0 nobody typed switches nothing: no update, a scoring update and an auto-run off all leave both keys alone', () =>
{
    const root = P();
    put(root, { env: { [K('AUTO_COMPACT')]: '0' } });
    const before = raw(root);
    assert.strictEqual(M.writeModes(root, {}, ENV).changed, false);
    assert.strictEqual(raw(root), before);
    M.writeModes(root, { [K('SCORING')]: '1' }, ENV);
    M.writeModes(root, { [K('AUTO_RUN')]: '0' }, ENV);
    assert.ok(!('autoCompactEnabled' in obj(root)) && !('modelSettings' in obj(root)));
});
test('a key never there: untouched', () =>
{
    const root = P();
    put(root, { autoCompactEnabled: false, env: {} });
    M.writeModes(root, { [K('SCORING')]: '0' }, ENV);
    assert.strictEqual(obj(root).autoCompactEnabled, false);
});
test('a 1 refreshes on every call: a changed trigger moves the window, the same call twice changes no byte', () =>
{
    const root = P();
    M.writeModes(root, { [K('AUTO_COMPACT')]: '1' }, ENV);
    const first = raw(root);
    assert.strictEqual(M.writeModes(root, {}, ENV).changed, false);
    assert.strictEqual(raw(root), first);
    M.writeModes(root, {}, { ...ENV, ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '350000' });
    assert.strictEqual(obj(root).modelSettings[K1M].autoCompactWindow, 350000);
});
test('the windows: a tier set, 0, unset and garbage', () =>
{
    for (const [v, want] of [['400000', 400000], ['0', undefined], [undefined, 180000], ['x', 180000]])
    {
        const root = P();
        const env = { ...ENV };
        if (v === undefined) delete env.ALFRED_CODE_CONTEXT_WINDOW_FOR_1M; else env.ALFRED_CODE_CONTEXT_WINDOW_FOR_1M = v;
        M.writeModes(root, { [K('AUTO_COMPACT')]: '1' }, env);
        assert.strictEqual(((obj(root).modelSettings || {})[K1M] || {}).autoCompactWindow, want, String(v));
    }
});
test('a tier switched to 0 takes its row out and names it', () =>
{
    const root = P();
    M.writeModes(root, { [K('AUTO_COMPACT')]: '1' }, ENV);
    const r = M.writeModes(root, {}, { ...ENV, ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '0' });
    assert.ok(!(obj(root).modelSettings || {})[K1M]);
    assert.ok(r.replaced.includes(`replaced autoCompactWindow 400000 for ${K1M}`));
});
test('the user\'s own values are replaced and named once', () =>
{
    const root = P();
    put(root, { autoCompactEnabled: false, modelSettings: { [K1M]: { autoCompactWindow: 300000, effort: 'high' } } });
    const r = M.writeModes(root, { [K('AUTO_COMPACT')]: '1' }, ENV);
    assert.deepStrictEqual(r.replaced.sort(), ['replaced autoCompactEnabled false', `replaced autoCompactWindow 300000 for ${K1M}`].sort());
    assert.strictEqual(obj(root).modelSettings[K1M].effort, 'high');
    assert.deepStrictEqual(M.writeModes(root, {}, ENV).replaced, []);
});
test('the stand-aside: a top-level window in the mode, the shared or the account file; a model the shared or account file names', () =>
{
    for (const where of ['mode', 'shared', 'account'])
    {
        const root = P();
        const env = topLevelWindow(root, where);
        const r = M.writeModes(root, { [K('AUTO_COMPACT')]: '1' }, env);
        assert.ok(!obj(root).modelSettings, where);
        assert.strictEqual(obj(root).autoCompactEnabled, true);
        assert.match(r.left[0], /^window for every model left to (\.claude\/settings(\.local)?\.json|the account settings\.json)$/);
    }
    const root = P();
    putShared(root, { modelSettings: { [K1M]: { autoCompactWindow: 300000 } } });
    const r = M.writeModes(root, { [K('AUTO_COMPACT')]: '1' }, ENV);
    assert.ok(!obj(root).modelSettings[K1M]);
    assert.deepStrictEqual(r.left, [`window for ${K1M} left to .claude/settings.json`]);
});
test('refusals change no byte', () =>
{
    for (const [text, why] of [['{ not json', 'unreadable'], ['[]', 'unreadable'], ['{"env":"x"}', 'unreadable'], ['{"env":[]}', 'unreadable'], ['{"env":null}', 'unreadable']])
    {
        const root = P();
        putRaw(root, text);
        const r = M.writeModes(root, { [K('SCORING')]: '1' }, ENV);
        assert.deepStrictEqual({ changed: r.changed, why: r.why }, { changed: false, why }, text);
        assert.strictEqual(raw(root), text);
    }
});
test('the mode file is a folder, or its folder cannot be written: unwritable, and no temp file stays',
    { skip: process.platform === 'win32' || process.getuid() === 0 }, () =>
{
    const a = P();
    fs.mkdirSync(modeFileOf(a), { recursive: true });
    assert.strictEqual(M.writeModes(a, { [K('SCORING')]: '1' }, ENV).why, 'unwritable');
    const b = P();
    put(b, { env: {} });
    const before = raw(b);
    fs.chmodSync(path.dirname(modeFileOf(b)), 0o555);
    try
    {
        assert.strictEqual(M.writeModes(b, { [K('SCORING')]: '1' }, ENV).why, 'unwritable');
        assert.strictEqual(raw(b), before);
        assert.deepStrictEqual(fs.readdirSync(path.dirname(modeFileOf(b))), ['settings.local.json']);
    }
    finally { fs.chmodSync(path.dirname(modeFileOf(b)), 0o755); }
});
test('a tracked file refuses every update; an unknown trust refuses only auto-run on', { skip: !GIT || process.platform === 'win32' }, () =>
{
    const t = trackedRepo();
    for (const u of [{ [K('SCORING')]: '1' }, { [K('AUTO_RUN')]: '0' }, {}]) assert.strictEqual(M.writeModes(t, u, ENV).why, 'tracked');
    const l = linkedClaudeRepo();
    const before = raw(l);
    assert.strictEqual(M.writeModes(l, { [K('AUTO_RUN')]: '1', [K('AUTO_COMPACT')]: '1' }, ENV).why, 'unvouched');
    assert.strictEqual(raw(l), before);
    assert.strictEqual(M.writeModes(l, { [K('AUTO_COMPACT')]: '1' }, ENV).why, '');
    assert.strictEqual(M.writeModes(l, { [K('AUTO_RUN')]: '0' }, ENV).why, '');
});
test('shape kept: CRLF, a BOM, four spaces, the keys\' order', () =>
{
    for (const text of ['{\r\n  "a": 1\r\n}\r\n', '\uFEFF{\n  "a": 1\n}\n', '{\n    "a": 1\n}\n'])
    {
        const root = P();
        putRaw(root, text);
        M.writeModes(root, { [K('SCORING')]: '1' }, ENV);
        const out = raw(root);
        assert.strictEqual(out.startsWith('\uFEFF'), text.startsWith('\uFEFF'));
        assert.strictEqual(/\r\n/.test(out), /\r\n/.test(text));
        assert.strictEqual(/\n {4}"a"/.test(out), /\n {4}"a"/.test(text));
        assert.ok(out.indexOf('"a"') < out.indexOf('"env"'));
    }
});
test('a linked mode file: the target is written and the link stays', { skip: process.platform === 'win32' }, () =>
{
    const root = P();
    const target = path.join(tree(), 'dot.json');
    fs.writeFileSync(target, '{}\n');
    fs.mkdirSync(path.dirname(modeFileOf(root)), { recursive: true });
    fs.symlinkSync(target, modeFileOf(root));
    M.writeModes(root, { [K('SCORING')]: '1' }, ENV);
    assert.ok(fs.lstatSync(modeFileOf(root)).isSymbolicLink());
    assert.strictEqual(JSON.parse(fs.readFileSync(target, 'utf8')).env[K('SCORING')], '1');
});
test('env is removed only when this call emptied it', () =>
{
    const a = P();
    put(a, { env: {} });
    M.writeModes(a, { [K('SCORING')]: null }, ENV);
    assert.deepStrictEqual(obj(a), { env: {} });
    const b = P();
    put(b, { env: { [K('SCORING')]: '1' } });
    M.writeModes(b, { [K('SCORING')]: null }, ENV);
    assert.deepStrictEqual(obj(b), {});
});
// git's global excludes (Claude Code lists the file there) are this machine's: the case runs with an empty home.
test('unignored: only for a file this call created that git does not ignore', { skip: !GIT }, () => withEnv({ HOME: tree(), USERPROFILE: tree(), XDG_CONFIG_HOME: tree() }, () =>
{
    const root = gitInit();
    assert.strictEqual(M.writeModes(root, { [K('SCORING')]: '1' }, ENV).unignored, true);
    assert.strictEqual(M.writeModes(root, { [K('SCORING')]: '0' }, ENV).unignored, false);
    const ig = gitInit();
    fs.writeFileSync(path.join(ig, '.gitignore'), '.claude/settings.local.json\n');
    assert.strictEqual(M.writeModes(ig, { [K('SCORING')]: '1' }, ENV).unignored, false);
    assert.strictEqual(M.writeModes(P(), { [K('SCORING')]: '1' }, ENV).unignored, false, 'no repository: nothing to ignore');
}));
test('autoRunHeld', () =>
{
    const root = P();
    assert.strictEqual(M.autoRunHeld(root), '');
    put(root, { env: { [K('AUTO_RUN')]: '1' } });
    assert.strictEqual(M.autoRunHeld(root), 'own');
    put(root, { env: { [K('AUTO_RUN')]: 1 } });
    assert.strictEqual(M.autoRunHeld(root), '', 'only the string 1');
    putRaw(root, '{ bad');
    assert.strictEqual(M.autoRunHeld(root), '');
});
test('said: the notes and the unignored line, or nothing', () =>
{
    assert.strictEqual(M.said({ replaced: [], left: [], unignored: false }), '');
    assert.strictEqual(M.said({ replaced: ['replaced autoCompactEnabled false'], left: ['window for x left to .claude/settings.json'], unignored: true }),
        ' - replaced autoCompactEnabled false - window for x left to .claude/settings.json'
        + ' - .claude/settings.local.json was created and git does not ignore it here: add it to .gitignore');
});
test('a hook\'s env and the installer\'s give the same bytes', () =>
{
    const a = P();
    const b = P();
    M.writeModes(a, { [K('AUTO_COMPACT')]: '1' }, ENV);
    setVars(b, Object.entries(WINDOW_SEEDS).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
    M.writeModes(b, { [K('AUTO_COMPACT')]: '1' }, { ...layout.variablesOf(b, { env: { CLAUDE_CONFIG_DIR: ENV.CLAUDE_CONFIG_DIR } }).values, CLAUDE_CONFIG_DIR: ENV.CLAUDE_CONFIG_DIR });
    assert.strictEqual(raw(a), raw(b));
});
// Task 10's final review, finding 1: init passes --auto-compact off for every walk answer but 'Compact and go on', and the
// removal took the user's own autoCompactEnabled and windows from a file that never held the key (spec 3.4: untouched).
test('a removal of the compact key the file never held leaves Claude Code\'s keys byte-identical', () =>
{
    const root = P();
    putRaw(root, `${JSON.stringify({ autoCompactEnabled: false, modelSettings: { [K1M]: { autoCompactWindow: 300000 } } }, null, 2)}\n`);
    const before = raw(root);
    const r = M.writeModes(root, { [K('AUTO_COMPACT')]: null }, ENV);
    assert.strictEqual(r.why, '');
    assert.strictEqual(raw(root), before);
    put(root, { env: { [K('AUTO_COMPACT')]: '1' }, autoCompactEnabled: true, modelSettings: { [K1M]: { autoCompactWindow: 360000 } } });
    M.writeModes(root, { [K('AUTO_COMPACT')]: null }, ENV);
    assert.deepStrictEqual(obj(root), {}, 'the key there: both of Claude Code\'s keys leave with it');
});
// Task 10's final review, finding 5: the temp file and the rename reset the mode, so a 0600 settings file holding a
// credential under `env` became 0644 after a mode command or the installer's refresh.
test('a write keeps the file\'s permission bits', { skip: process.platform === 'win32' }, () =>
{
    const root = P();
    put(root, { env: { MY_TOKEN_NAME: 'x' } });
    fs.chmodSync(modeFileOf(root), 0o600);
    M.writeModes(root, { [K('SCORING')]: '1' }, ENV);
    assert.strictEqual(obj(root).env[K('SCORING')], '1');
    assert.strictEqual(fs.statSync(modeFileOf(root)).mode & 0o777, 0o600);
});
// Task 10's matrix, M12: a session started in a sub-folder reads that folder's variables, none of the top's, and its
// windows went into the top's file at the DEFAULT trigger until the top's next update rewrote them.
test('a sub-folder session writes the top\'s windows from the top\'s tier triggers, the bytes the top\'s own write gives', { skip: !GIT }, () =>
{
    const TIERS = 'ALFRED_CODE_CONTEXT_WINDOW_FOR_1M=320000\nALFRED_CODE_CONTEXT_WINDOW_FOR_300K=250000\nALFRED_CODE_CONTEXT_WINDOW_FOR_200K=150000\n';
    const env = { CLAUDE_CONFIG_DIR: ENV.CLAUDE_CONFIG_DIR };
    const [top, other] = [gitInit(), gitInit()];
    for (const r of [top, other]) setVars(r, TIERS);
    fs.mkdirSync(path.join(top, 'app'));
    M.writeModes(path.join(top, 'app'), { [K('AUTO_COMPACT')]: '1' }, { ...env });
    M.writeModes(other, { [K('AUTO_COMPACT')]: '1' }, { ...layout.variablesOf(other, { env }).values, ...env });
    assert.strictEqual(modeFileOf(path.join(top, 'app')), file(top), 'the sub-folder resolves to the top\'s file');
    assert.strictEqual(obj(top).modelSettings[K1M].autoCompactWindow, 320000, raw(top));
    assert.strictEqual(raw(top), raw(other));
});
