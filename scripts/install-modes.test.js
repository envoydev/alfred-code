'use strict';
// The mode block and the installer (mode commands v2 stage 3, Task 8; scripts/install/modes.js): the four mode keys in
// the checkout's own settings.local.json are the user's typed modes. The settings pass leaves them as typed, one
// writeModes call after it refreshes Claude Code's own two keys from them, and uninstall takes the block out. Every case
// reads the files the run left.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const rt = require('./install/runtime.js');
const layout = require('../stack/hooks/layout.js');
const { seedRun, POSIX_ONLY, releaseExport, skipWithout } = require('./seed-sandbox.js');

const ROOT = path.join(__dirname, '..');
const SEL = 'skill markdown-style\n';
const PLUGINS = JSON.stringify([{ id: 'alfred-code@envoydev', version: '2.0.0', scope: 'local', enabled: true }]);
const MODELS = Object.keys(require('../stack/hooks/model-windows.json').models);
const COMPACT = 'ALFRED_CODE_AUTO_COMPACT';
const AUTO_RUN = 'ALFRED_CODE_AUTO_RUN';

const json = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const readOr = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const localFile = (repo) => path.join(repo, '.claude', 'settings.local.json');
const local = (repo) => json(localFile(repo)) || {};
const envIn = (repo, name) => ((json(path.join(repo, '.claude', name)) || {}).env || {});
const varsFile = (repo) => path.join(repo, '.alfred', '.variables');
const varsOf = (repo) => ((layout.readDotenv(varsFile(repo)) || {}).values || {});
const ledgerText = (repo) => readOr(path.join(repo, '.claude', 'alfred-code.stamp')) || '';
const modeBlock = (env) => Object.fromEntries(Object.entries(env).filter(([k]) => layout.MODE_KEYS.includes(k)));
const putLocal = (repo, obj) => { fs.mkdirSync(path.join(repo, '.claude'), { recursive: true }); fs.writeFileSync(localFile(repo), `${JSON.stringify(obj, null, 2)}\n`); };
const putVars = (repo, lines) => { fs.mkdirSync(path.dirname(varsFile(repo)), { recursive: true }); fs.writeFileSync(varsFile(repo), `${lines.join('\n')}\n`); };
const ignoreLocal = (repo) => fs.writeFileSync(path.join(repo, '.gitignore'), '.claude/settings.local.json\n');
const windows = (repo) => Object.fromEntries(Object.entries(local(repo).modelSettings || {}).map(([id, v]) => [id, v.autoCompactWindow]).filter(([, v]) => v !== undefined));
const scopeArgs = (scope, more = []) => ['--scope', scope, ...more];

test('setAside: the block leaves the env and comes back in place; a 3.10 name is held under its new one; a pass\'s mode key goes', () =>
{
    const { setAside } = require('./install/modes.js');
    const data = { env: { A: '1', ALFRED_CODE_SCORER: '0', B: '2', ALFRED_CODE_AUTO_RUN: '1', ALFRED_CODE_AUTO_COMPACT: '1' } };
    const putBack = setAside(data, 'settings.local.json');
    assert.deepStrictEqual(data.env, { A: '1', B: '2' });
    data.env.C = '3';
    data.env.ALFRED_CODE_SCORING_LEVEL = '80';
    const ledger = { C: 'h', ALFRED_CODE_SCORING_LEVEL: 'h' };
    putBack(data, ledger);
    assert.deepStrictEqual(Object.entries(data.env), [['A', '1'], ['ALFRED_CODE_SCORING', '0'], ['B', '2'], ['ALFRED_CODE_AUTO_RUN', '1'],
        ['ALFRED_CODE_AUTO_COMPACT', '1'], ['C', '3']]);
    assert.deepStrictEqual(ledger, { C: 'h' }, 'no ledger row for a mode key');
    // the new name beside the old: the new one is held, the old one goes
    const both = { env: { ALFRED_CODE_SCORER: '0', ALFRED_CODE_SCORING: '1' } };
    setAside(both, 'settings.local.json')(both);
    assert.deepStrictEqual(both.env, { ALFRED_CODE_SCORING: '1' });
    // a reseed of the stack's own old seed is applied in place, and putBack says so; an unchanged block says nothing changed
    const old = { env: { ALFRED_CODE_SCORER: '0', ALFRED_CODE_AUTO_COMPACT: '0' } };
    const seen = [];
    const changed = setAside(old, 'settings.local.json', (key, from, value) => { seen.push([key, from]); return key === 'ALFRED_CODE_SCORING' ? '1' : value; })(old);
    assert.strictEqual(changed, true);
    assert.deepStrictEqual(old.env, { ALFRED_CODE_SCORING: '1', ALFRED_CODE_AUTO_COMPACT: '0' });
    assert.deepStrictEqual(seen, [['ALFRED_CODE_SCORING', 'ALFRED_CODE_SCORER'], ['ALFRED_CODE_AUTO_COMPACT', 'ALFRED_CODE_AUTO_COMPACT']]);
    assert.strictEqual(setAside(old, 'settings.local.json')(old), false);
    // another file: nothing set aside
    const shared = { env: { ALFRED_CODE_AUTO_COMPACT: '1' } };
    setAside(shared, 'settings.json')(shared);
    assert.deepStrictEqual(shared.env, { ALFRED_CODE_AUTO_COMPACT: '1' });
    // no env at all, a pass adds one: its mode key goes, the rest stays
    const none = {};
    const back = setAside(none, 'settings.local.json');
    none.env = { ALFRED_CODE_SCORING: '1', X: 'y' };
    back(none);
    assert.deepStrictEqual(none.env, { X: 'y' });
});

for (const scope of ['local', 'project', 'user'])
{
    test(`a typed mode block survives an install, an update and a re-run at ${scope} scope`, POSIX_ONLY, () =>
    {
        const block = { [AUTO_RUN]: '1', ALFRED_CODE_SCORING: '0', ALFRED_CODE_SCORING_LEVEL: '90' };
        for (const vars of [[], ['ALFRED_CODE_SCORING=1', 'ALFRED_CODE_SCORING_LEVEL=80']])
        {
            const { outs, steps } = seedRun(['install', 'update', 'update'], SEL, {
                plugins: PLUGINS, args: [scopeArgs(scope), scopeArgs(scope, ['--installed-only']), scopeArgs(scope, ['--installed-only'])],
                prepare: (repo) => { ignoreLocal(repo); putLocal(repo, { env: { MY_KEY: 'a', ...block } }); if (vars.length) putVars(repo, vars); },
                each: (repo) => ({ block: modeBlock(envIn(repo, 'settings.local.json')), vars: readOr(varsFile(repo)), local: readOr(localFile(repo)), stamp: ledgerText(repo) }),
            });
            for (const [i, s] of steps.entries()) assert.deepStrictEqual(s.block, block, `step ${i} (${vars.length ? 'team lines' : 'no lines'})\n${outs[i]}`);
            assert.strictEqual(steps[2].vars, steps[1].vars, '.variables unchanged by the update');
            if (vars.length) for (const line of vars) assert.ok(steps[2].vars.includes(line), `the team's line stays: ${line}`);
            for (const s of steps) assert.doesNotMatch(s.stamp, /managed-env:[^\n]*settings\.local\.json:ALFRED_CODE_(AUTO_RUN|AUTO_COMPACT|SCORING|SCORING_LEVEL)=/, 'no local-file ledger row names a mode key');
            assert.strictEqual(steps[2].local, steps[1].local, 'a re-run changes the local file in no byte');
        }
    });
}

test('an untyped 0 from before this release stays as it is, with no Claude Code key beside it', POSIX_ONLY, () =>
{
    for (const vars of [[], ['ALFRED_CODE_AUTO_COMPACT=1']])
    {
        const { outs, steps } = seedRun(['install', 'update', 'update'], SEL, {
            plugins: PLUGINS, args: [scopeArgs('local'), scopeArgs('local', ['--installed-only']), scopeArgs('local', ['--installed-only'])],
            prepare: (repo) => { ignoreLocal(repo); putLocal(repo, { env: { [COMPACT]: '0' } }); if (vars.length) putVars(repo, vars); },
            each: (repo) => ({ env: envIn(repo, 'settings.local.json'), data: local(repo), text: readOr(localFile(repo)) }),
        });
        for (const s of steps.slice(1))
        {
            assert.strictEqual(s.env[COMPACT], '0', outs[1]);
            assert.ok(!Object.hasOwn(s.data, 'autoCompactEnabled') && !Object.hasOwn(s.data, 'modelSettings'), JSON.stringify(s.data));
        }
        assert.strictEqual(steps[2].text, steps[1].text, 'a re-run leaves the bytes');
    }
});

test('the migration: a .variables 0 leaves, a 1 stays, the mode file\'s 0 stays', POSIX_ONLY, () =>
{
    for (const [line, kept] of [['ALFRED_CODE_AUTO_COMPACT=0', false], ['ALFRED_CODE_AUTO_COMPACT=1', true]])
    {
        const { outs, result } = seedRun(['install', 'update'], SEL, {
            plugins: PLUGINS, args: [scopeArgs('project'), scopeArgs('project', ['--installed-only'])],
            prepare: (repo) => { ignoreLocal(repo); putLocal(repo, { env: { [COMPACT]: '0' } }); },
            each: (repo, i) => { if (i === 0) putVars(repo, [...(readOr(varsFile(repo)) || '').split('\n').filter(Boolean), line]); return null; },
            inspect: (repo) => ({ vars: varsOf(repo), env: envIn(repo, 'settings.local.json') }),
        });
        assert.strictEqual(Object.hasOwn(result.vars, COMPACT), kept, `${line}\n${outs[1]}`);
        assert.strictEqual(result.env[COMPACT], '0', 'the mode file keeps its 0');
    }
});

test('--auto-compact on: the mode file holds 1, autoCompactEnabled true and the windows; the variables file holds 1', POSIX_ONLY, () =>
{
    const { outs, result } = seedRun(['install'], SEL, {
        plugins: PLUGINS, args: scopeArgs('project', ['--auto-compact', 'on']), prepare: ignoreLocal,
        inspect: (repo) => ({ env: envIn(repo, 'settings.local.json'), data: local(repo), wins: windows(repo), vars: varsOf(repo) }),
    });
    assert.strictEqual(result.env[COMPACT], '1', outs[0]);
    assert.strictEqual(result.data.autoCompactEnabled, true);
    assert.ok(Object.keys(result.wins).length > 0 && Object.keys(result.wins).every((id) => MODELS.includes(id)), JSON.stringify(result.wins));
    assert.strictEqual(result.vars[COMPACT], '1');
    assert.match(outs[0], /modes: \d+ window rows, autoCompactEnabled true/);
});

test('--auto-compact off: the key and both Claude Code keys leave the mode file, the .variables line leaves, the next update copies nothing', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update', 'update'], SEL, {
        plugins: PLUGINS, args: [scopeArgs('project', ['--auto-compact', 'on']), scopeArgs('project', ['--installed-only', '--auto-compact', 'off']), scopeArgs('project', ['--installed-only'])],
        prepare: ignoreLocal,
        each: (repo) => ({ env: envIn(repo, 'settings.local.json'), data: local(repo), vars: varsOf(repo) }),
    });
    assert.strictEqual(steps[0].env[COMPACT], '1');
    for (const s of steps.slice(1))
    {
        assert.ok(!Object.hasOwn(s.env, COMPACT), `${JSON.stringify(s.env)}\n${outs[1]}`);
        assert.ok(!Object.hasOwn(s.data, 'autoCompactEnabled') && !Object.hasOwn(s.data, 'modelSettings'), JSON.stringify(s.data));
        assert.ok(!Object.hasOwn(s.vars, COMPACT), JSON.stringify(s.vars));
    }
});

test('--auto-compact off at local scope over a tracked .variables holding 1: refused, no byte changes', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update'], SEL, {
        plugins: PLUGINS, args: [scopeArgs('local'), scopeArgs('local', ['--installed-only', '--auto-compact', 'off'])],
        prepare: (repo) => { ignoreLocal(repo); putVars(repo, ['ALFRED_CODE_AUTO_COMPACT=1']); rt.execCommand('git', ['-C', repo, 'add', '-f', '.alfred/.variables']); },
        each: (repo) => ({ vars: readOr(varsFile(repo)), local: readOr(localFile(repo)) }),
    });
    assert.match(outs[1], /!! variables: ALFRED_CODE_AUTO_COMPACT - \.variables is tracked here/, outs[1]);
    assert.strictEqual(steps[1].vars, steps[0].vars);
    assert.strictEqual(steps[1].local, steps[0].local, 'the mode file is left as it is');
});

test('the team\'s 1 is copied into the mode file once; then the mode file is the switch', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update', 'update', 'update'], SEL, {
        plugins: PLUGINS, args: [scopeArgs('project'), ...Array(3).fill(scopeArgs('project', ['--installed-only']))],
        prepare: ignoreLocal,
        each: (repo, i) =>
        {
            if (i === 0) putVars(repo, [...(readOr(varsFile(repo)) || '').split('\n').filter((l) => l && !l.startsWith(COMPACT)), 'ALFRED_CODE_AUTO_COMPACT=1']);
            if (i === 1) putVars(repo, (readOr(varsFile(repo)) || '').split('\n').filter((l) => l && !l.startsWith(COMPACT)));
            return { env: envIn(repo, 'settings.local.json'), data: local(repo), text: readOr(localFile(repo)) };
        },
    });
    assert.strictEqual(steps[1].env[COMPACT], '1', outs[1]);
    assert.strictEqual(steps[1].data.autoCompactEnabled, true);
    assert.ok(Object.keys(steps[1].data.modelSettings || {}).length > 0);
    assert.strictEqual(steps[2].text, steps[1].text, 'the line gone from .variables: the mode file keeps its three');
    assert.strictEqual(steps[3].text, steps[2].text, 'and a re-run');
    // a mode-file 0 over the team's 1 is the user's
    const { result } = seedRun(['install', 'update'], SEL, {
        plugins: PLUGINS, args: [scopeArgs('project'), scopeArgs('project', ['--installed-only'])],
        prepare: (repo) => { ignoreLocal(repo); putLocal(repo, { env: { [COMPACT]: '0' } }); },
        each: (repo, i) => { if (i === 0) putVars(repo, ['ALFRED_CODE_AUTO_COMPACT=1']); return null; },
        inspect: (repo) => ({ env: envIn(repo, 'settings.local.json'), data: local(repo) }),
    });
    assert.strictEqual(result.env[COMPACT], '0');
    assert.ok(!Object.hasOwn(result.data, 'autoCompactEnabled'));
});

for (const scope of ['local', 'project', 'user'])
{
    test(`no seed of either key at ${scope} scope`, POSIX_ONLY, () =>
    {
        const { result, out } = seedRun(['install'], SEL, {
            plugins: PLUGINS, args: scopeArgs(scope), prepare: ignoreLocal,
            inspect: (repo) => ({ vars: varsOf(repo), local: envIn(repo, 'settings.local.json'), shared: envIn(repo, 'settings.json') }),
        });
        for (const where of ['vars', 'local', 'shared']) for (const key of [COMPACT, AUTO_RUN])
            assert.ok(!Object.hasOwn(result[where], key), `${key} in ${where}\n${out}`);
    });
}

test('a tracked mode file: the run goes on, one !! modes line, the file unchanged', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update'], SEL, {
        plugins: PLUGINS, args: [scopeArgs('project'), scopeArgs('project', ['--installed-only'])],
        each: (repo, i) =>
        {
            if (i === 0)
            {
                const d = local(repo);
                d.env = { ...(d.env || {}), [COMPACT]: '1' };
                putLocal(repo, d);
                rt.execCommand('git', ['-C', repo, 'add', '-f', '.claude/settings.local.json']);
            }
            return { text: readOr(localFile(repo)), data: local(repo) };
        },
    });
    assert.match(outs[1], /!! modes: not written - git tracks the file/, outs[1]);
    assert.ok(!Object.hasOwn(steps[1].data, 'autoCompactEnabled'), 'no Claude Code key written');
});

test('--print-plan creates and changes no mode file', POSIX_ONLY, () =>
{
    const { result } = seedRun(['install', 'update'], SEL, {
        plugins: PLUGINS, args: [scopeArgs('project'), scopeArgs('project', ['--installed-only', '--print-plan'])],
        prepare: ignoreLocal,
        each: (repo, i) => { if (i === 0) { const d = local(repo); d.env = { ...(d.env || {}), [COMPACT]: '1' }; putLocal(repo, d); } return null; },
        inspect: (repo) => local(repo),
    });
    assert.ok(!Object.hasOwn(result, 'autoCompactEnabled') && !Object.hasOwn(result, 'modelSettings'), JSON.stringify(result));
});

test('a hand-set 1 in the mode file: the run writes true and the windows; a hand-set 0 neither', POSIX_ONLY, () =>
{
    for (const [value, want] of [['1', true], ['0', undefined]])
    {
        const { result, out } = seedRun(['install'], SEL, {
            plugins: '[]', args: scopeArgs('local'),
            prepare: (repo) => { ignoreLocal(repo); putLocal(repo, { env: { [COMPACT]: value } }); },
            inspect: (repo) => ({ data: local(repo), wins: windows(repo) }),
        });
        assert.strictEqual(result.data.autoCompactEnabled, want, `${value}\n${out}`);
        assert.strictEqual(Object.keys(result.wins).length > 0, want === true, JSON.stringify(result.wins));
    }
});

test('the root project refreshes the mode file; a same-repository child leaves it byte-identical', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'install'], SEL, {
        plugins: PLUGINS, args: [scopeArgs('local'), scopeArgs('local')], cwds: ['repo', 'repo/app'],
        prepare: (repo) => { ignoreLocal(repo); putLocal(repo, { env: { [COMPACT]: '1' } }); fs.mkdirSync(path.join(repo, 'app')); },
        each: (repo) => ({ text: readOr(localFile(repo)), data: local(repo) }),
    });
    assert.strictEqual(steps[0].data.autoCompactEnabled, true, outs[0]);
    assert.strictEqual(steps[1].text, steps[0].text, `the child's run leaves the top file\n${outs[1]}`);
});

test('uninstall takes the block and its Claude Code keys out, and keeps the rest', POSIX_ONLY, () =>
{
    const keepModel = 'not-a-catalog-model';
    const { outs, steps } = seedRun(['install', 'uninstall'], SEL, {
        plugins: PLUGINS, args: [scopeArgs('local', ['--auto-compact', 'on']), scopeArgs('local')],
        prepare: (repo) => { ignoreLocal(repo); putLocal(repo, { permissions: { allow: ['Bash(ls)'] }, env: { MY_KEY: 'a', [AUTO_RUN]: '1', ALFRED_CODE_SCORING: '0' }, modelSettings: { [keepModel]: { autoCompactWindow: 300000 } } }); },
        each: (repo) => local(repo),
    });
    const after = steps[1];
    assert.ok(steps[0].autoCompactEnabled === true, outs[0]);
    for (const key of layout.MODE_KEYS) assert.ok(!Object.hasOwn(after.env || {}, key), `${key}\n${outs[1]}`);
    assert.strictEqual((after.env || {}).MY_KEY, 'a');
    assert.deepStrictEqual(after.permissions && after.permissions.allow, ['Bash(ls)']);
    assert.ok(!Object.hasOwn(after, 'autoCompactEnabled'));
    assert.deepStrictEqual(Object.keys(after.modelSettings || {}), [keepModel]);
    // without the compact key the user's own autoCompactEnabled stays
    const { steps: s2 } = seedRun(['install', 'uninstall'], SEL, {
        plugins: PLUGINS, args: [scopeArgs('local'), scopeArgs('local')],
        prepare: (repo) => { ignoreLocal(repo); putLocal(repo, { autoCompactEnabled: false, env: { [AUTO_RUN]: '1' } }); },
        each: (repo) => local(repo),
    });
    assert.strictEqual(s2[1].autoCompactEnabled, false);
});

test('the order: an older local install\'s ledgered windows give way to the ones writeModes writes', skipWithout('v3.10.0'), () =>
{
    const exp = releaseExport('v3.10.0');
    const { outs, steps } = seedRun(['install', 'update'], SEL, {
        plugins: PLUGINS, seed: [path.join(exp, 'scripts', 'install', 'alfred-code.js'), path.join(ROOT, 'scripts', 'install', 'alfred-code.js')], source: [exp, ROOT],
        args: [scopeArgs('local', ['--auto-compact', 'on']), scopeArgs('local', ['--installed-only'])], prepare: ignoreLocal,
        each: (repo) => ({ wins: windows(repo), ledger: ledgerText(repo), data: local(repo) }),
    });
    assert.ok(Object.keys(steps[0].wins).length > 0, outs[0]);
    assert.ok(Object.keys(steps[1].wins).length > 0, outs[1]);
    assert.strictEqual(steps[1].data.autoCompactEnabled, true);
    assert.doesNotMatch(steps[1].ledger, /modelSettings\./, 'no window row left in the ledger');
});
