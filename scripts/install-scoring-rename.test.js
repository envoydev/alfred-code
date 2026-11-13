'use strict';
// 3.11.0's scoring rename (mode v2 stage 1): what an update migrates - the dead session state under the old names, the
// four variables in every file that holds them, the skill override and the seat deny, and a tracked .variables a
// local-scope run must not write.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const layout = require('../stack/hooks/layout.js');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');

const SEL = 'skill markdown-style\n';
const PLUGINS = JSON.stringify([{ id: 'alfred-code@envoydev', version: '2.0.0', scope: 'local', enabled: true }]);
const SESSIONS = (repo) => path.join(repo, '.alfred', 'state', 'sessions');
const GONE = ['SCORER-s1', 'SCORER-HELD-s1', 'SCORER-NOTED-s1', '.alfred-sweep-SCORER-', 'scorer'];
const KEPT = ['SCORER_s1', 'SCORING-s1', 'scoring', 'scorer-notes', 'scorers', 'scorer.bak', 'xSCORER-s1', 'AUTO-RUN-s1'];
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
const writeJson = (file, v) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(v, null, 2)}\n`); };
const OLD = /ALFRED_CODE_SCORER/;

test('an update removes the session state written under the old names, and nothing beside it', POSIX_ONLY, () =>
{
    const { outs, result } = seedRun(['install', 'update', 'update'], SEL, {
        plugins: PLUGINS,
        each: (repo, i) =>
        {
            if (i !== 0) return null;
            fs.mkdirSync(path.join(SESSIONS(repo), 'scorer', 's1'), { recursive: true });
            fs.writeFileSync(path.join(SESSIONS(repo), 'scorer', 's1', 'draft.md'), '# draft');
            fs.mkdirSync(path.join(SESSIONS(repo), 'scoring', 's1'), { recursive: true });
            for (const n of [...GONE, ...KEPT]) if (!fs.existsSync(path.join(SESSIONS(repo), n))) fs.writeFileSync(path.join(SESSIONS(repo), n), 'on\n');
            return null;
        },
        inspect: (repo) => fs.readdirSync(SESSIONS(repo)),
    });
    for (const n of GONE) assert.ok(!result.includes(n), `${n} is gone`);
    for (const n of KEPT) assert.ok(result.includes(n), `${n} stays`);
    assert.match(outs[1], /state: scoring session entries from before the rename removed: 5/);
    assert.doesNotMatch(outs[2], /from before the rename/, 'a second update finds nothing');
});

test('the removal takes a link, never its target, and a sessions path that is a file stops nothing', POSIX_ONLY, () =>
{
    let target = '';
    const { outs, result } = seedRun(['install', 'update'], SEL, {
        plugins: PLUGINS,
        prepare: (_repo, work) => { target = path.join(work, 'kept'); fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'keep.md'), 'keep'); },
        each: (repo, i) => { if (i === 0) { fs.mkdirSync(SESSIONS(repo), { recursive: true }); fs.symlinkSync(target, path.join(SESSIONS(repo), 'scorer')); } return null; },
        inspect: (repo) => ({ link: fs.existsSync(path.join(SESSIONS(repo), 'scorer')) || isLink(path.join(SESSIONS(repo), 'scorer')), kept: fs.readFileSync(path.join(target, 'keep.md'), 'utf8') }),
    });
    assert.deepStrictEqual(result, { link: false, kept: 'keep' });
    assert.match(outs[1], /removed: 1/);

    const second = seedRun(['install', 'update'], SEL, {
        plugins: PLUGINS,
        each: (repo, i) =>
        {
            if (i === 0) { fs.rmSync(SESSIONS(repo), { recursive: true, force: true }); fs.mkdirSync(path.dirname(SESSIONS(repo)), { recursive: true }); fs.writeFileSync(SESSIONS(repo), 'not a folder\n'); }
            return null;
        },
        inspect: (repo) => fs.readFileSync(SESSIONS(repo), 'utf8'),
    });
    assert.deepStrictEqual(second.codes, [0, 0]);
    assert.strictEqual(second.result, 'not a folder\n');
    assert.doesNotMatch(second.outs[1], /from before the rename/);
});
const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };

test('a project with no state folder logs nothing', POSIX_ONLY, () =>
{
    const { outs } = seedRun(['install', 'update'], SEL, {
        plugins: PLUGINS,
        each: (repo, i) => { if (i === 0) fs.rmSync(path.join(repo, '.alfred', 'state'), { recursive: true, force: true }); return null; },
    });
    assert.doesNotMatch(outs[1], /from before the rename/);
});

// Characterization: the existing rename passes, driven by the four rename rows of meta/migrations.json.
test('an update renames the four variables in every file that holds them', POSIX_ONLY, () =>
{
    const { steps } = seedRun(['install', 'update'], SEL, {
        plugins: PLUGINS,
        each: (repo, i) =>
        {
            const vars = path.join(repo, '.alfred', '.variables');
            const local = path.join(repo, '.claude', 'settings.local.json');
            const shared = path.join(repo, '.claude', 'settings.json');
            if (i === 0)
            {
                // as an older install holds them: no new key in the file this tree's install seeded, so none shadows a planted old one
                const text = fs.readFileSync(vars, 'utf8').split('\n').filter((l) => !/^ALFRED_CODE_SCOR(?:ING|ER)_(?:LEVEL|OUTPUTS)=/.test(l)).join('\n');
                fs.writeFileSync(vars, `${text.replace(/\n*$/, '\n')}ALFRED_CODE_SCORER_LEVEL=90\n`);
                const l = readJson(local); l.env = { ...(l.env || {}), ALFRED_CODE_SCORER_ROUNDS: '5' }; writeJson(local, l);
                const s = readJson(shared); s.env = { ...(s.env || {}), ALFRED_CODE_SCORER_OUTPUTS: 'root-cause' }; writeJson(shared, s);
                return null;
            }
            const env = { CLAUDE_CONFIG_DIR: path.join(repo, '..', 'acct') };
            return {
                values: layout.variablesOf(repo, { env, layers: 'files' }).values,
                texts: [vars, local, shared].map((f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '')),
            };
        },
    });
    const after = steps[1];
    assert.strictEqual(after.values.ALFRED_CODE_SCORING_LEVEL, '90');
    assert.strictEqual(after.values.ALFRED_CODE_SCORING_ROUNDS, '5');
    assert.strictEqual(after.values.ALFRED_CODE_SCORING_OUTPUTS, 'root-cause');
    for (const t of after.texts) assert.doesNotMatch(t, OLD, t);
});

test('skillOverrides and the seat deny follow', POSIX_ONLY, () =>
{
    const { steps, outs } = seedRun(['install', 'update'], SEL, {
        plugins: PLUGINS,
        each: (repo, i) =>
        {
            const shared = path.join(repo, '.claude', 'settings.json');
            if (i === 0)
            {
                const s = readJson(shared);
                s.skillOverrides = { ...(s.skillOverrides || {}), 'mode-output-scorer': 'off', 'markdown-style': 'off' };   // legacy
                s.permissions = { ...(s.permissions || {}) };
                s.permissions.deny = [...(s.permissions.deny || []).filter((r) => !/output-scor/.test(r)), 'Agent(alfred-code:output-scorer)'];   // legacy
                writeJson(shared, s);
                return null;
            }
            return readJson(shared);
        },
    });
    const s = steps[1];
    assert.strictEqual(s.skillOverrides['mode-output-scoring'], 'off', outs[1]);
    assert.strictEqual(s.skillOverrides['markdown-style'], 'off');
    assert.ok(!Object.hasOwn(s.skillOverrides, 'mode-output-scorer'));   // legacy
    assert.ok(s.permissions.deny.includes('Agent(alfred-code:output-scoring)'), JSON.stringify(s.permissions.deny));
    assert.ok(!s.permissions.deny.some((r) => /output-scorer\)/.test(r)), JSON.stringify(s.permissions.deny));   // legacy
});

test('a local-scope update over a tracked .variables leaves the file alone', POSIX_ONLY, () =>
{
    const git = (repo, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { cwd: repo, stdio: 'pipe' });
    const { steps } = seedRun(['install', 'update'], SEL, {
        plugins: PLUGINS,
        args: [['--scope', 'project'], ['--scope', 'local']],
        each: (repo, i) =>
        {
            const vars = path.join(repo, '.alfred', '.variables');
            const local = path.join(repo, '.claude', 'settings.local.json');
            if (i === 0)
            {
                const text = fs.readFileSync(vars, 'utf8').split('\n').filter((l) => !/^ALFRED_CODE_SCOR(?:ING|ER)_LEVEL=/.test(l)).join('\n');
                fs.writeFileSync(vars, `${text.replace(/\n*$/, '\n')}ALFRED_CODE_SCORER_LEVEL=90\n`);
                git(repo, 'add', '-f', '--', vars);
                git(repo, 'commit', '-qm', 'vars');
                return fs.readFileSync(vars);
            }
            return { bytes: fs.readFileSync(vars), localEnv: readJson(local).env || {},
                value: layout.variablesOf(repo, { env: { CLAUDE_CONFIG_DIR: path.join(repo, '..', 'acct') } }).values.ALFRED_CODE_SCORING_LEVEL };
        },
    });
    assert.ok(steps[1].bytes.equals(steps[0]), 'the tracked file is byte-identical');
    assert.ok(!Object.hasOwn(steps[1].localEnv, 'ALFRED_CODE_SCORING_LEVEL'), JSON.stringify(steps[1].localEnv));
    assert.strictEqual(steps[1].value, '90');
});
