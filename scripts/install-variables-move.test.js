'use strict';
// The move (workspace roles and variables, T12b - D5, D6, D3's Claude settings; AC7-AC10, AC14's env half, AC23): an
// install writes the stack's variables into `<data root>/.variables`, an update over 2.12.0 moves them there out of the
// settings, and git tracks the file at project and user scope. Every case reads the files the run left; an update over
// an older release runs that release's own installer from a `git archive` of its tag (skipped where the tag is absent).
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const rt = require('./install/runtime.js');
const layout = require('../stack/hooks/layout.js');
const variables = require('./install/variables.js');
const stampLib = require('./install/stamp.js');
const { DATA_IGNORE_HEAD } = require('../stack/mcp/data-root.js');
const { seedRun, POSIX_ONLY, releaseExport, skipWithout } = require('./seed-sandbox.js');

const ROOT = path.join(__dirname, '..');
const SEL = 'skill markdown-style\n';
const PLUGINS = JSON.stringify([{ id: 'alfred-code@envoydev', version: '2.0.0', scope: 'local', enabled: true }]);
const CATALOG = require('../meta/environment.json').env.map((r) => r.key);
const SETTINGS_KEYS = ['ALFRED_CODE_DATA_PATH', 'ALFRED_CODE_HOOKS_OFF'];
const SEEDED = CATALOG.filter((k) => !SETTINGS_KEYS.includes(k) && k !== 'ALFRED_CODE_WORKSPACE');
const MOVED_LINE = /variables: (\d+) keys moved to \.alfred\/\.variables - a teammate on 2\.12\.0 or older reads none of them until they update; a downgrade needs them put back in \.claude\/settings\.json by hand/;

const exportOf = releaseExport;
// The steps of an update over `tag`: that release installs, this tree updates.
const over = (tag, n) => ({
    seed: [path.join(exportOf(tag) || ROOT, 'scripts', 'install', 'alfred-code.js'), ...Array(n).fill(path.join(ROOT, 'scripts', 'install', 'alfred-code.js'))],
    source: [exportOf(tag) || ROOT, ...Array(n).fill(ROOT)],
});

const json = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const readOr = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const envIn = (repo, name) => ((json(path.join(repo, '.claude', name)) || {}).env || {});
const varsFile = (repo) => path.join(repo, '.alfred', '.variables');
const varsOf = (repo) => ((layout.readDotenv(varsFile(repo)) || {}).values || {});
const ignoredExit = (repo, rel) => rt.spawnCommand('git', ['check-ignore', '-q', '--', rel], { cwd: repo, stdio: 'ignore' }).status;
const acctEnv = (repo) => ({ CLAUDE_CONFIG_DIR: path.join(path.dirname(repo), 'acct') });
const effective = (repo) => Object.fromEntries(variables.show(repo, { env: acctEnv(repo) }).map((r) => [r.key, r.value]));
const ledgerOf = (repo) => stampLib.readLedger(path.join(repo, '.claude', 'alfred-code.stamp')) || {};
const settingsName = (scope) => (scope === 'local' ? 'settings.local.json' : 'settings.json');
const catalogIn = (env) => Object.keys(env).filter((k) => CATALOG.includes(k)).sort();
// The instrumentation hook's wired command lines, read from a settings file's hooks.
const instrumentCommands = (repo) => Object.values((json(path.join(repo, '.claude', 'settings.json')) || {}).hooks || {})
    .flat().flatMap((entry) => entry.hooks || []).map((h) => h.command).filter((c) => /instrument-tool-usage/.test(c));

// Every file under the repo but .git, with its sha256 - the stamp read without its two run times.
function treeHash(dir)
{
    const rows = [];
    const walk = (d) =>
    {
        for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)))
        {
            const p = path.join(d, e.name);
            if (e.name === '.git') continue;
            if (e.isDirectory()) { walk(p); continue; }
            let body = fs.readFileSync(p);
            if (e.name === 'alfred-code.stamp') body = Buffer.from(String(body).replace(/^installed(-ms)?: .*$/gm, ''));
            rows.push(`${path.relative(dir, p)} ${crypto.createHash('sha256').update(body).digest('hex')}`);
        }
    };
    walk(dir);
    return rows.join('\n');
}

for (const scope of ['project', 'user', 'local'])
{
    test(`AC7: a fresh install at ${scope} scope writes every moved key but WORKSPACE into .variables, leaves DATA_PATH and HOOKS_OFF in settings, and git ${scope === 'local' ? 'ignores' : 'tracks'} the file`, POSIX_ONLY, () =>
    {
        const { result } = seedRun('install', SEL, {
            plugins: PLUGINS, args: ['--scope', scope],
            inspect: (repo) => ({ vars: varsOf(repo), env: envIn(repo, settingsName(scope)), ignored: ignoredExit(repo, '.alfred/.variables'), effective: effective(repo) }),
        });
        assert.deepStrictEqual(Object.keys(result.vars).sort(), [...SEEDED].sort());
        assert.strictEqual(result.vars.ALFRED_CODE_SCORER_LEVEL, '80');
        assert.strictEqual(result.env.ALFRED_CODE_DATA_PATH, '.alfred');
        assert.deepStrictEqual(catalogIn(result.env).filter((k) => !SETTINGS_KEYS.includes(k)), [], JSON.stringify(result.env));
        assert.strictEqual(result.ignored, scope === 'local' ? 0 : 1);
        assert.strictEqual(result.effective.ALFRED_CODE_MAXIMUM_RUN_AGENTS, '5');
    });
}

test('AC7: git-hygiene\'s own /.alfred/ line becomes /.alfred/* plus !/.alfred/.variables, and the file is tracked', POSIX_ONLY, () =>
{
    const { result } = seedRun('install', SEL, {
        plugins: PLUGINS, args: ['--scope', 'project'],
        prepare: (repo) => fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n# alfred-code: the data root (ALFRED_CODE_DATA_PATH) is machine-local\n/.alfred/\n'),
        inspect: (repo) => ({ ignore: readOr(path.join(repo, '.gitignore')), vars: varsOf(repo), ignored: ignoredExit(repo, '.alfred/.variables'), other: ignoredExit(repo, '.alfred/state/x') }),
    });
    assert.strictEqual(result.ignore, 'node_modules/\n# alfred-code: the data root (ALFRED_CODE_DATA_PATH) is machine-local\n/.alfred/*\n!/.alfred/.variables\n');
    assert.strictEqual(result.ignored, 1);
    assert.strictEqual(result.other, 0, 'the rest of the data root stays ignored');
    assert.deepStrictEqual(Object.keys(result.vars).sort(), [...SEEDED].sort());
});

test('AC7: the user\'s own .alfred/ line keeps the keys in settings.json and names .gitignore:<n>', POSIX_ONLY, () =>
{
    const { out, result } = seedRun('install', SEL, {
        plugins: PLUGINS, args: ['--scope', 'project'],
        prepare: (repo) => fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n.alfred/\n'),
        inspect: (repo) => ({ vars: fs.existsSync(varsFile(repo)) ? varsOf(repo) : null, env: envIn(repo, 'settings.json') }),
    });
    assert.ok(!result.vars || !Object.keys(result.vars).length, `a key went into an ignored .variables: ${JSON.stringify(result.vars)}`);
    for (const key of SEEDED) assert.ok(Object.hasOwn(result.env, key), `${key} was not seeded into settings.json`);
    assert.match(out, /!! variables: \.alfred\/\.variables is ignored by \.gitignore:2 - the keys are kept in settings\.json; ignore \/\.alfred\/\* and re-include !\/\.alfred\/\.variables, then update/, out);
});

// A decision the run takes for a moved key (`--docs-versioning`, `--memory`, `--auto-compact`) lands in .variables, and its
// line names that file - a line naming settings.json sent the reader to a file that no longer holds the key.
test('an update\'s --docs-versioning and --memory lines name .variables, where the values land', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update'], SEL, {
        plugins: PLUGINS, args: [[], ['--installed-only', '--docs-versioning', 'local', '--memory', 'custom']],
        each: (repo) => ({ vars: varsOf(repo), env: envIn(repo, 'settings.json') }),
    });
    assert.match(outs[1], /^==> {3}\.variables env: ALFRED_CODE_DOCS_VERSIONING 'git' -> 'local' \(--docs-versioning\)$/m, outs[1]);
    assert.match(outs[1], /^==> {3}\.variables env: ALFRED_CODE_MEMORY '[a-z]+' -> 'custom'/m, outs[1]);
    assert.doesNotMatch(outs[1], /settings\.json env: ALFRED_CODE_(DOCS_VERSIONING|MEMORY)\b/);
    assert.strictEqual(steps[1].vars.ALFRED_CODE_DOCS_VERSIONING, 'local');
    assert.strictEqual(steps[1].vars.ALFRED_CODE_MEMORY, 'custom');
    assert.ok(!Object.hasOwn(steps[1].env, 'ALFRED_CODE_DOCS_VERSIONING') && !Object.hasOwn(steps[1].env, 'ALFRED_CODE_MEMORY'));
});

// AC17: the guard key never moves (D7) - a fresh install over a settings file that holds it, and an update over v2.12.0.
const OFF = 'ALFRED_CODE_HOOKS_OFF';
const putOff = (repo) =>
{
    const f = path.join(repo, '.claude', 'settings.json');
    const data = json(f) || {};
    data.env = { ...(data.env || {}), [OFF]: 'docs-session:gate' };
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, `${JSON.stringify(data, null, 2)}\n`);
};
test('AC17: HOOKS_OFF is in settings.json after a fresh install, never in .variables', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install'], SEL, { plugins: PLUGINS, prepare: (repo) => putOff(repo), each: (repo) => ({ env: envIn(repo, 'settings.json'), vars: varsOf(repo) }) });
    assert.strictEqual(steps[0].env[OFF], 'docs-session:gate', outs[0]);
    assert.ok(Object.keys(steps[0].vars).length > 0 && !Object.hasOwn(steps[0].vars, OFF), JSON.stringify(steps[0].vars));
});

test('AC17: HOOKS_OFF is in settings.json after an update over v2.12.0, never in .variables', skipWithout('v2.12.0'), () =>
{
    const { outs, steps } = seedRun(['install', 'update'], SEL, {
        plugins: PLUGINS, ...over('v2.12.0', 1), args: [[], ['--installed-only']],
        each: (repo, i) => { if (i === 0) putOff(repo); return { env: envIn(repo, 'settings.json'), vars: varsOf(repo) }; },
    });
    assert.strictEqual(steps[1].env[OFF], 'docs-session:gate', outs[1]);
    assert.ok(Object.keys(steps[1].vars).length > 0 && !Object.hasOwn(steps[1].vars, OFF), JSON.stringify(steps[1].vars));
});

for (const scope of ['project', 'user', 'local'])
{
    test(`AC8: an update over a v2.12.0 export at ${scope} scope keeps every effective value, carries each ledger row to .variables at its hash, and a second update changes no file`, skipWithout('v2.12.0'), () =>
    {
        const file = settingsName(scope);
        const { outs, steps } = seedRun(['install', 'update', 'update'], SEL, {
            plugins: PLUGINS, ...over('v2.12.0', 2),
            args: [['--scope', scope], ['--scope', scope, '--installed-only'], ['--scope', scope, '--installed-only']],
            each: (repo) => ({
                effective: effective(repo), env: envIn(repo, file), vars: varsOf(repo), ledger: ledgerOf(repo).env || {},
                tree: treeHash(repo), ignored: ignoredExit(repo, '.alfred/.variables'), dataIgnore: readOr(path.join(repo, '.alfred', '.gitignore')),
            }),
        });
        const [before, after, again] = steps;
        assert.deepStrictEqual(after.effective, before.effective, outs[1]);
        assert.deepStrictEqual(catalogIn(after.env).filter((k) => !SETTINGS_KEYS.includes(k)), [], JSON.stringify(after.env));
        for (const key of SEEDED) assert.strictEqual(after.vars[key], before.env[key], `${key} did not move unchanged`);
        const moved = Object.entries(before.ledger[file] || {}).filter(([k]) => SEEDED.includes(k));
        assert.ok(moved.length > 0, 'v2.12.0 ledgered its seeds');
        for (const [key, hash] of moved) assert.strictEqual((after.ledger['.variables'] || {})[key], hash, `${key}'s ledger row did not follow it`);
        for (const [key] of moved) assert.ok(!Object.hasOwn(after.ledger[file] || {}, key), `${key} is still ledgered under ${file}`);
        assert.strictEqual(after.ignored, scope === 'local' ? 0 : 1);
        if (scope !== 'local') assert.match(after.dataIgnore, /^!\/\.variables$/m, 'the data root\'s own file re-includes .variables');
        else assert.doesNotMatch(after.dataIgnore, /\.variables/, 'a local-scope run never adds !/.variables');
        assert.strictEqual(again.tree, after.tree, 'the second update changed a file');
        // The close line: once, at project and user scope, on the run that moved.
        if (scope === 'local') assert.doesNotMatch(outs[1], MOVED_LINE);
        else assert.strictEqual(Number((MOVED_LINE.exec(outs[1]) || [])[1]), moved.length, outs[1]);
        assert.doesNotMatch(outs[2], MOVED_LINE, 'nothing moved, so no line');
    });
}

test('AC8: an update over a v2.12.0 export whose own .gitignore line .alfred/ ignores the data root leaves settings.json byte-identical and names .gitignore:<n>', skipWithout('v2.12.0'), () =>
{
    const { outs, steps } = seedRun(['install', 'update'], SEL, {
        plugins: PLUGINS, ...over('v2.12.0', 1),
        args: [['--scope', 'project'], ['--scope', 'project', '--installed-only']],
        prepare: (repo) => fs.writeFileSync(path.join(repo, '.gitignore'), '.alfred/\n'),
        each: (repo) => ({ settings: readOr(path.join(repo, '.claude', 'settings.json')), vars: fs.existsSync(varsFile(repo)) }),
    });
    assert.strictEqual(steps[1].settings, steps[0].settings, outs[1]);
    assert.strictEqual(steps[1].vars, false, 'a .variables was written under an ignored data root');
    assert.match(outs[1], /!! variables: \.alfred\/\.variables is ignored by \.gitignore:1 - the keys are kept in settings\.json/, outs[1]);
    assert.doesNotMatch(outs[1], MOVED_LINE);
});

test('the one-way gate: a value .variables cannot hold keeps its settings key and prints one !! line', POSIX_ONLY, () =>
{
    const KEY = 'ALFRED_CODE_SCORER_OUTPUTS';
    const { outs, result } = seedRun(['install', 'update'], SEL, {
        plugins: PLUGINS, args: [['--scope', 'project'], ['--scope', 'project', '--installed-only']],
        each: (repo, i) =>
        {
            if (i !== 0) return null;
            variables.write(varsFile(repo), { [KEY]: null });
            const f = path.join(repo, '.claude', 'settings.json');
            const data = json(f);
            data.env[KEY] = 'plan\ndesign';
            fs.writeFileSync(f, `${JSON.stringify(data, null, 2)}\n`);
            return null;
        },
        inspect: (repo) => ({ env: envIn(repo, 'settings.json'), vars: varsOf(repo), text: readOr(varsFile(repo)) }),
    });
    assert.strictEqual(result.env[KEY], 'plan\ndesign');
    assert.ok(!Object.hasOwn(result.vars, KEY));
    assert.doesNotMatch(result.text, /^design$/m, 'half a value reached the file');
    assert.strictEqual((outs[1].match(/!! variables:/g) || []).length, 1, outs[1]);
    assert.match(outs[1], new RegExp(`!! variables: ${KEY} [^\\n]*kept in settings\\.json`), outs[1]);
});

test('AC9: an update over a v2.10.0 export applies the renames, then moves, and writes no workspace file', skipWithout('v2.10.0'), () =>
{
    const { outs, steps } = seedRun(['install', 'update'], SEL, {
        plugins: PLUGINS, ...over('v2.10.0', 1),
        args: [['--scope', 'project'], ['--scope', 'project', '--installed-only']],
        each: (repo) => ({ env: envIn(repo, 'settings.json'), vars: varsOf(repo), effective: effective(repo), ws: fs.existsSync(path.join(repo, '.alfred', 'workspace')) }),
    });
    const [, after] = steps;
    assert.deepStrictEqual(Object.keys(after.env).filter((k) => k.startsWith('ALFRED_CODE_') && !SETTINGS_KEYS.includes(k)), [], outs[1]);
    for (const key of SEEDED) assert.ok(Object.hasOwn(after.vars, key), `${key} is not in .variables`);
    assert.ok(Object.keys(after.vars).every((k) => CATALOG.includes(k)), `an old name reached .variables: ${Object.keys(after.vars).join(',')}`);
    assert.strictEqual(after.ws, false);
});

test('AC10: a hand-typed value moves unledgered, a non-catalog key stays, a differing settings.local.json key stays, is named and wins', skipWithout('v2.12.0'), () =>
{
    const { outs, steps } = seedRun(['install', 'update'], SEL, {
        plugins: PLUGINS, ...over('v2.12.0', 1),
        args: [['--scope', 'project'], ['--scope', 'project', '--installed-only']],
        each: (repo, i) =>
        {
            if (i === 0)
            {
                const f = path.join(repo, '.claude', 'settings.json');
                const data = json(f);
                Object.assign(data.env, { ALFRED_CODE_SCORER_LEVEL: '95', ALFRED_CODE_ALLOW_WRITE_OUTSIDE: '/elsewhere/repo' });
                fs.writeFileSync(f, `${JSON.stringify(data, null, 2)}\n`);
                fs.writeFileSync(path.join(repo, '.claude', 'settings.local.json'), `${JSON.stringify({ env: { ALFRED_CODE_TURN_CHECK: '1', ALFRED_CODE_HISTORY: data.env.ALFRED_CODE_HISTORY } }, null, 2)}\n`);
                return null;
            }
            return { env: envIn(repo, 'settings.json'), local: envIn(repo, 'settings.local.json'), vars: varsOf(repo), ledger: ledgerOf(repo).env || {}, effective: effective(repo) };
        },
    });
    const got = steps[1];
    assert.strictEqual(got.vars.ALFRED_CODE_SCORER_LEVEL, '95');
    assert.ok(!Object.hasOwn(got.ledger['.variables'] || {}, 'ALFRED_CODE_SCORER_LEVEL'), 'a hand-typed value was ledgered as the stack\'s');
    assert.strictEqual(got.env.ALFRED_CODE_ALLOW_WRITE_OUTSIDE, '/elsewhere/repo', 'a non-catalog key left settings.json');
    assert.ok(!Object.hasOwn(got.vars, 'ALFRED_CODE_ALLOW_WRITE_OUTSIDE'));
    assert.deepStrictEqual(got.local, { ALFRED_CODE_TURN_CHECK: '1' }, 'the equal local copy goes, the differing one stays');
    assert.strictEqual(got.effective.ALFRED_CODE_TURN_CHECK, '1');
    assert.strictEqual((outs[1].match(/variables: ALFRED_CODE_TURN_CHECK set in \.claude\/settings\.local\.json \(it overrides \.variables here\)/g) || []).length, 1, outs[1]);
});

test('AC10: a local-scope run leaves a tracked settings.json byte-identical and seeds none of its keys', POSIX_ONLY, () =>
{
    const team = `${JSON.stringify({ env: { ALFRED_CODE_SCORER_LEVEL: '90', ALFRED_CODE_HISTORY: '5' } }, null, 2)}\n`;
    const { result } = seedRun('install', SEL, {
        plugins: PLUGINS, args: ['--scope', 'local'],
        prepare: (repo) =>
        {
            fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
            fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), team);
            rt.execCommand('git', ['add', '.claude/settings.json'], { cwd: repo, stdio: 'ignore' });
        },
        inspect: (repo) => ({ shared: readOr(path.join(repo, '.claude', 'settings.json')), vars: varsOf(repo), effective: effective(repo) }),
    });
    assert.strictEqual(result.shared, team);
    assert.ok(!Object.hasOwn(result.vars, 'ALFRED_CODE_SCORER_LEVEL') && !Object.hasOwn(result.vars, 'ALFRED_CODE_HISTORY'), JSON.stringify(result.vars));
    assert.strictEqual(result.effective.ALFRED_CODE_SCORER_LEVEL, '90');
});

test('AC16 (installer half): a local-scope run over a tracked .variables writes nothing there and names a differing flag', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update'], SEL, {
        plugins: PLUGINS, args: [['--scope', 'project'], ['--scope', 'local', '--installed-only', '--memory', 'custom']],
        each: (repo, i) =>
        {
            if (i === 0)
            {
                rt.execCommand('git', ['add', '-f', '.alfred/.variables'], { cwd: repo, stdio: 'ignore' });
                return readOr(varsFile(repo));
            }
            return { text: readOr(varsFile(repo)), local: envIn(repo, 'settings.local.json') };
        },
    });
    assert.strictEqual(steps[1].text, steps[0], outs[1]);
    assert.ok(!Object.hasOwn(steps[1].local, 'ALFRED_CODE_MEMORY'), JSON.stringify(steps[1].local));
    assert.match(outs[1], /!! variables: ALFRED_CODE_MEMORY - \.variables is tracked here; change it with the team \(no \.variables\.local yet\)/, outs[1]);
});

for (const scope of ['project', 'local'])
{
    test(`AC23: at ${scope} scope AUTO_COMPACT=1 and MEMORY=custom keep every autoCompactWindow row and autoMemoryEnabled false byte-identical; 0 in .variables removes the rows`, skipWithout('v2.12.0'), () =>
    {
        const file = settingsName(scope);
        const claudeOwn = (repo) =>
        {
            const data = json(path.join(repo, '.claude', file)) || {};
            return JSON.stringify({ modelSettings: data.modelSettings, autoMemoryEnabled: data.autoMemoryEnabled });
        };
        const { outs, steps } = seedRun(['install', 'update', 'update', 'update'], SEL, {
            plugins: PLUGINS, ...over('v2.12.0', 3),
            args: [['--scope', scope, '--auto-compact', 'on', '--memory', 'custom'], ['--scope', scope, '--installed-only'], ['--scope', scope, '--installed-only'], ['--scope', scope, '--installed-only']],
            each: (repo, i) =>
            {
                const got = { own: claudeOwn(repo), settingsRows: (ledgerOf(repo).settings || {})[file] || {}, tree: treeHash(repo) };
                if (i === 2) variables.write(varsFile(repo), { ALFRED_CODE_AUTO_COMPACT: '0' });
                return got;
            },
        });
        const [before, after, again, off] = steps;
        assert.ok(/autoCompactWindow/.test(before.own) && /"autoMemoryEnabled":false/.test(before.own), before.own);
        assert.strictEqual(after.own, before.own, outs[1]);
        assert.deepStrictEqual(after.settingsRows, before.settingsRows);
        assert.strictEqual(again.tree, after.tree, 'the second update changed a file');
        assert.doesNotMatch(off.own, /autoCompactWindow/, outs[3]);
        assert.match(off.own, /"autoMemoryEnabled":false/);
    });
}

test('the copy route wires instrumentation with no shell gate', POSIX_ONLY, () =>
{
    const { result } = seedRun('install', `${SEL}hook instrument-tool-usage\n`, {
        plugins: PLUGINS, args: ['--scope', 'project'], env: { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false' },
        inspect: (repo) => instrumentCommands(repo),
    });
    assert.ok(result.length > 0, 'the copy route wired no instrumentation hook');
    for (const c of result) assert.doesNotMatch(c, /\[ .*\] \|\|/, c);
});

test('AC19: instrumentation on the copy route logs with ALFRED_CODE_INSTRUMENT=1 in .variables, and not at 0', POSIX_ONLY, () =>
{
    const { result } = seedRun('install', `${SEL}hook instrument-tool-usage\n`, {
        plugins: PLUGINS, args: ['--scope', 'project'], env: { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false' },
        inspect: (repo) =>
        {
            const [command] = instrumentCommands(repo);
            const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('ALFRED_CODE_')));
            const fire = (session) =>
            {
                rt.spawnCommand('sh', ['-c', command], { cwd: repo, input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: session, tool_name: 'Read', tool_input: { file_path: 'a.txt' } }), encoding: 'utf8', env: { ...env, CLAUDE_PROJECT_DIR: repo, ...acctEnv(repo) } });
                return fs.existsSync(path.join(repo, '.alfred', 'statistics', 'tools-usage', `${session}.jsonl`));
            };
            const seeded = varsOf(repo).ALFRED_CODE_INSTRUMENT;
            const off = fire('off-run');
            variables.write(varsFile(repo), { ALFRED_CODE_INSTRUMENT: '1' });
            return { command, seeded, off, on: fire('on-run') };
        },
    });
    assert.ok(result.command, 'the copy route wired no instrumentation hook');
    assert.strictEqual(result.seeded, '0', 'seeded off in .variables');
    assert.strictEqual(result.off, false, 'no row while .variables holds 0');
    assert.strictEqual(result.on, true, 'a row once .variables holds 1');
});

test('an update over a v2.12.0 copy-route install replaces the gated instrumentation entry with one ungated entry, and a second update changes nothing', skipWithout('v2.12.0'), () =>
{
    const { outs, steps } = seedRun(['install', 'update', 'update'], `${SEL}hook instrument-tool-usage\n`, {
        plugins: PLUGINS, ...over('v2.12.0', 2), env: { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false' },
        args: [['--scope', 'project'], ['--scope', 'project', '--installed-only'], ['--scope', 'project', '--installed-only']],
        each: (repo) => ({ commands: instrumentCommands(repo), tree: treeHash(repo) }),
    });
    assert.ok(steps[0].commands.some((c) => /\|\|/.test(c)), `v2.12.0 wired no gated entry: ${steps[0].commands.join('\n')}`);
    assert.strictEqual(steps[1].commands.length, steps[0].commands.length, outs[1]);
    for (const c of steps[1].commands) assert.doesNotMatch(c, /\[ .*\] \|\|/, c);
    assert.strictEqual(steps[2].tree, steps[1].tree);
});

test('a move off local adds !/.variables and the file is then tracked; an update at local scope never adds it', POSIX_ONLY, () =>
{
    const { steps } = seedRun(['install', 'update', 'update'], SEL, {
        plugins: PLUGINS, args: [['--scope', 'local'], ['--scope', 'local', '--installed-only'], ['--scope', 'project', '--installed-only']],
        each: (repo) => ({ dataIgnore: readOr(path.join(repo, '.alfred', '.gitignore')), ignored: ignoredExit(repo, '.alfred/.variables'), vars: varsOf(repo) }),
    });
    for (const i of [0, 1]) { assert.doesNotMatch(steps[i].dataIgnore, /\.variables/); assert.strictEqual(steps[i].ignored, 0); }
    assert.match(steps[2].dataIgnore, /^!\/\.variables$/m);
    assert.strictEqual(steps[2].ignored, 1);
    assert.deepStrictEqual(Object.keys(steps[2].vars).sort(), [...SEEDED].sort());
});

// T12c (AC22): copy.js reads the docs mode through the loader, so the ignore step sees the value this run just wrote into
// .variables - at local scope too, where a project's docs are kept out of git only when the flag says so.
for (const [scope, mode, shape] of [['project', 'git', /the docs under it are committed \(ALFRED_CODE_DOCS_VERSIONING=git\)/], ['local', 'local', /the docs under it are too \(ALFRED_CODE_DOCS_VERSIONING=local\)/]])
{
    test(`a fresh install with --docs-versioning ${mode} writes the ${mode}-shaped data ignore (${scope} scope)`, POSIX_ONLY, () =>
    {
        const { result } = seedRun('install', SEL, {
            plugins: PLUGINS, args: ['--scope', scope, '--docs-versioning', mode],
            inspect: (repo) => ({ ignore: readOr(path.join(repo, '.alfred', '.gitignore')), vars: varsOf(repo) }),
        });
        assert.strictEqual(result.vars.ALFRED_CODE_DOCS_VERSIONING, mode);
        assert.match(result.ignore || '', shape, result.ignore);
    });
}

test('ensureRootIgnore writes no !/.variables', () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'root-ignore-'));
    try
    {
        const dataRoot = require('../stack/mcp/data-root.js');
        assert.strictEqual(dataRoot.ensureRootIgnore({ projectDir: dir, root: '.alfred', env: { CLAUDE_CONFIG_DIR: path.join(dir, 'acct') } }), 'written');
        assert.doesNotMatch(fs.readFileSync(path.join(dir, '.alfred', '.gitignore'), 'utf8'), /\.variables/);
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a configure set where the user\'s .alfred/ line ignores the data root writes settings.json and names .gitignore:<n>', () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'set-ignored-'));
    try
    {
        rt.execCommand('git', ['init', '-q', dir]);
        fs.writeFileSync(path.join(dir, '.gitignore'), 'dist/\n.alfred/\n');
        const lines = [];
        const got = variables.set(dir, ['ALFRED_CODE_SCORER_LEVEL=90'], { scope: 'project', env: { CLAUDE_CONFIG_DIR: path.join(dir, 'acct') }, log: (l) => lines.push(l) });
        assert.deepStrictEqual(got.toSettings, ['ALFRED_CODE_SCORER_LEVEL']);
        assert.deepStrictEqual(got.written, []);
        assert.strictEqual(envIn(dir, 'settings.json').ALFRED_CODE_SCORER_LEVEL, '90');
        assert.ok(!fs.existsSync(varsFile(dir)));
        assert.ok(lines.some((l) => /!! variables: \.alfred\/\.variables is ignored by \.gitignore:2/.test(l)), lines.join('\n'));
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('variables.ignoreVerdict: a data-root .gitignore the user wrote is not the stack\'s own, so the keys stay in settings.json', () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-own-'));
    try
    {
        rt.execCommand('git', ['init', '-q', dir]);
        fs.mkdirSync(path.join(dir, '.alfred'));
        // ensureDataIgnore keeps a file without the stack's head as it is, so nothing re-includes .variables there.
        fs.writeFileSync(path.join(dir, '.alfred', '.gitignore'), '*\n');
        assert.deepStrictEqual(variables.ignoreVerdict(dir, '.alfred'), { ignored: true, source: '.alfred/.gitignore', line: 1, own: false });
        assert.match(variables.ignoredLine('.alfred', variables.ignoreVerdict(dir, '.alfred')), /add !\/\.variables to \.alfred\/\.gitignore/, 'the hint names the file that ignores it');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('variables.ignoreVerdict reads -q for the verdict and -v only for the rule\'s name', () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-'));
    try
    {
        rt.execCommand('git', ['init', '-q', dir]);
        fs.mkdirSync(path.join(dir, '.alfred'));
        fs.writeFileSync(path.join(dir, '.alfred', '.gitignore'), `${DATA_IGNORE_HEAD}\n/*\n!/.gitignore\n`);
        assert.deepStrictEqual(variables.ignoreVerdict(dir, '.alfred'), { ignored: true, source: '.alfred/.gitignore', line: 2, own: true }, 'the data root\'s own file, which the run re-includes');
        fs.writeFileSync(path.join(dir, '.alfred', '.gitignore'), '# alfred\n/*\n!/.gitignore\n!/.variables\n');
        assert.deepStrictEqual(variables.ignoreVerdict(dir, '.alfred'), { ignored: false });
        fs.writeFileSync(path.join(dir, '.gitignore'), 'x\n.alfred/\n');
        assert.deepStrictEqual(variables.ignoreVerdict(dir, '.alfred'), { ignored: true, source: '.gitignore', line: 2, own: false });
        fs.writeFileSync(path.join(dir, '.gitignore'), 'x\n');
        fs.mkdirSync(path.join(dir, 'sub', '.alfred'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'sub', '.alfred', '.gitignore'), `${DATA_IGNORE_HEAD}\n/*\n`);
        assert.deepStrictEqual(variables.ignoreVerdict(path.join(dir, 'sub'), '.alfred'), { ignored: true, source: 'sub/.alfred/.gitignore', line: 2, own: true }, 'a project below the repository top');
        const none = fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-nogit-'));
        try { assert.deepStrictEqual(variables.ignoreVerdict(none, '.alfred'), { ignored: false }); }
        finally { fs.rmSync(none, { recursive: true, force: true }); }
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a --data-path move carries .variables to the new root with its values; a file already there is kept and the old one named', POSIX_ONLY, () =>
{
    const move = ['--scope', 'project', '--installed-only', '--data-path', '.data', '--data-move', 'move'];
    const level = (repo, rel) => ((layout.readDotenv(path.join(repo, ...rel.split('/'), '.variables')) || {}).values || {}).ALFRED_CODE_SCORER_LEVEL;
    const { outs, steps } = seedRun(['install', 'update', 'update'], SEL, {
        plugins: PLUGINS, args: [['--scope', 'project'], move, ['--scope', 'project', '--installed-only']],
        each: (repo, i) =>
        {
            if (i === 0) variables.set(repo, ['ALFRED_CODE_SCORER_LEVEL=95'], { env: acctEnv(repo), log: () => {} });
            return { old: level(repo, '.alfred'), now: level(repo, '.data'), effective: effective(repo).ALFRED_CODE_SCORER_LEVEL, tree: treeHash(repo) };
        },
    });
    assert.deepStrictEqual(steps[0], { ...steps[0], old: '95', now: undefined });
    assert.deepStrictEqual([steps[1].old, steps[1].now, steps[1].effective], [undefined, '95', '95'], outs[1]);
    assert.match(outs[1], /variables: moved \.alfred\/\.variables -> \.data\/\.variables/);
    // The files the move writes; the root move's own state files are not this case's.
    const rows = (tree) => tree.split('\n').filter((r) => /^(\.data|\.alfred)\/\.variables |^\.claude\/(settings(\.local)?\.json|alfred-code\.stamp) /.test(r));
    assert.ok(rows(steps[1].tree).length >= 3, steps[1].tree);
    assert.deepStrictEqual(rows(steps[2].tree), rows(steps[1].tree), 'a re-run changed a file');

    const clash = seedRun(['install', 'update'], SEL, {
        plugins: PLUGINS, args: [['--scope', 'project'], move],
        prepare: (repo) => { fs.mkdirSync(path.join(repo, '.data'), { recursive: true }); fs.writeFileSync(path.join(repo, '.data', '.variables'), 'ALFRED_CODE_SCORER_LEVEL=70\n'); },
        inspect: (repo) => ({ old: level(repo, '.alfred'), now: level(repo, '.data') }),
    });
    assert.deepStrictEqual(clash.result, { old: '80', now: '70' });
    assert.match(clash.out, /!! variables: \.alfred\/\.variables left in place - \.data\/\.variables already exists/);
});

test('at local scope a key typed into settings.local.json after the move goes into .variables with its value - the value the loader read', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update'], SEL, {
        plugins: PLUGINS, args: [['--scope', 'local'], ['--scope', 'local', '--installed-only']],
        each: (repo, i) =>
        {
            if (i === 0)
            {
                const file = path.join(repo, '.claude', 'settings.local.json');
                const data = json(file);
                data.env.ALFRED_CODE_HISTORY = '7';
                fs.writeFileSync(file, JSON.stringify(data, null, 2));
            }
            return { effective: effective(repo).ALFRED_CODE_HISTORY, file: varsOf(repo).ALFRED_CODE_HISTORY, local: envIn(repo, 'settings.local.json').ALFRED_CODE_HISTORY };
        },
    });
    assert.strictEqual(steps[0].effective, '7', 'settings.local.json reads over .variables (D4 step 2)');
    assert.deepStrictEqual(steps[1], { effective: '7', file: '7', local: undefined }, outs[1]);
});

test('a move off local keeps the user\'s own .variables values local: they go to settings.local.json, the seeds stay for the team (R78)', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update', 'update'], SEL, {
        plugins: PLUGINS, args: [['--scope', 'local'], ['--scope', 'project', '--installed-only'], ['--scope', 'project', '--installed-only']],
        each: (repo, i) =>
        {
            if (i === 0) variables.set(repo, ['ALFRED_CODE_HISTORY=7'], { env: acctEnv(repo), log: () => {} });
            return { effective: effective(repo).ALFRED_CODE_HISTORY, file: varsOf(repo).ALFRED_CODE_HISTORY, local: envIn(repo, 'settings.local.json').ALFRED_CODE_HISTORY, seed: varsOf(repo).ALFRED_CODE_SCORER_LEVEL, tree: treeHash(repo) };
        },
    });
    assert.deepStrictEqual([steps[0].effective, steps[0].file], ['7', '7']);
    assert.strictEqual(steps[1].effective, '7', outs[1]);
    assert.strictEqual(steps[1].local, '7', 'the user\'s value stays this machine\'s own');
    assert.notStrictEqual(steps[1].file, '7', 'a personal value reached the file the team tracks');
    assert.strictEqual(steps[1].seed, '80', 'the seeds stay in the file');
    assert.match(outs[1], /ALFRED_CODE_HISTORY/);
    assert.doesNotMatch(outs[1], /HISTORY[^\n]*\b7\b/, 'a kept value reached the log');
    assert.strictEqual(steps[2].tree, steps[1].tree, 'a re-run changed a file');
});

test('uninstall removes the stack\'s .variables rows at their recorded hash and keeps a value the user changed', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'uninstall'], SEL, {
        plugins: PLUGINS, args: [['--scope', 'project'], ['--scope', 'project']],
        each: (repo, i) =>
        {
            if (i === 0) variables.set(repo, ['ALFRED_CODE_HISTORY=7'], { env: acctEnv(repo), log: () => {} });
            return fs.existsSync(varsFile(repo)) ? varsOf(repo) : null;
        },
    });
    assert.strictEqual(steps[0].ALFRED_CODE_SCORER_LEVEL, '80');
    assert.deepStrictEqual(steps[1], { ALFRED_CODE_HISTORY: '7' }, outs[1]);
    assert.match(outs[1], /\.variables env: ALFRED_CODE_HISTORY kept - changed since the stack wrote it, so it is yours \(1 chars\)/);
});
