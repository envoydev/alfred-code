'use strict';
// Mode inheritance D3: every line that says a mode's state names an inherited source - the bare state lines, the
// scoring and auto-run context lines, the run contract, the child's own off and its refusal where git tracks the file.
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { putWorkspace } = require('./workspace-fixture.js');
const { realLong } = require('./test-paths.js');
const M = require('../stack/hooks/mode-settings.js');

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const WORKSPACE_CLI = path.join(__dirname, 'workspace.js');
const TMP = realLong(fs.mkdtempSync(path.join(os.tmpdir(), 'mode-inherit-lines-')));
test.after(() => { process.chdir(os.tmpdir()); fs.rmSync(TMP, { recursive: true, force: true }); });
const ACCT = path.join(TMP, 'acct');
fs.mkdirSync(path.join(ACCT, 'skills', 'mode-output-scoring'), { recursive: true });
fs.writeFileSync(path.join(ACCT, 'skills', 'mode-output-scoring', 'SKILL.md'), '---\nname: mode-output-scoring\n---\n');
const GIT_OK = spawnSync('git', ['--version']).status === 0;
const SKIP_GIT = !GIT_OK;
const SKIP_LINK = !GIT_OK || process.platform === 'win32';
const K = (s) => `ALFRED_CODE_${s}`;
const gitIn = (cwd, args) => execFileSync('git', args, { cwd, stdio: 'ignore' });
const modeFileOf = (dir) => path.join(dir, '.claude', 'settings.local.json');
const OFF_HERE = (rel) => `[mode] auto-run is OFF here - ${rel} keeps it on for itself; remove ALFRED_CODE_AUTO_RUN from this folder's .claude/settings.local.json to inherit it again`;
const IGNORE_ADD = "ignore --root . --add 'env ALFRED_CODE_AUTO_RUN'";

// A root and a joined child, each with its own git and workspace record; `root` and `child` are the env of their mode files.
let count = 0;
function pair(root = {}, child = {}, { trackChild = false, trackRoot = false } = {})
{
    const top = fs.mkdtempSync(path.join(TMP, `t${++count}-`));
    const dirs = { root: path.join(top, 'root'), child: path.join(top, 'root', 'child') };
    const spec = { root: [root, { children: ['child'] }], child: [child, { parent: '..' }] };
    for (const [name, dir] of Object.entries(dirs))
    {
        fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), 'sha: x\n');
        gitIn(dir, ['init', '-q']);
        const [env, record] = spec[name];
        fs.writeFileSync(modeFileOf(dir), JSON.stringify({ env }));
        putWorkspace(dir, record, { dataRoot: '.alfred' });
    }
    if (trackRoot) gitIn(dirs.root, ['add', '-f', '.claude/settings.local.json']);
    if (trackChild) gitIn(dirs.child, ['add', '-f', '.claude/settings.local.json']);
    return { root: fs.realpathSync.native(dirs.root), child: fs.realpathSync.native(dirs.child) };
}
const ROOT_ON = { [K('AUTO_RUN')]: '1' };
const transcript = () => { const t = path.join(TMP, `t-${++count}.jsonl`); fs.writeFileSync(t, ''); return t; };
const hookEnv = (project) => ({ ...process.env, CLAUDE_CONFIG_DIR: ACCT, CLAUDE_PROJECT_DIR: project, ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'log-')) });
const runHook = (file, payload, project) => spawnSync(process.execPath, [path.join(HOOKS, file)], { input: JSON.stringify(payload), encoding: 'utf8', env: hookEnv(project) });
const contextOf = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; } catch { return ''; } };
let session = 0;
const typed = (file, project, prompt, sid = `s${++session}`) => contextOf(runHook(file, { hook_event_name: 'UserPromptSubmit', session_id: sid, cwd: project, transcript_path: transcript(), prompt }, project));
const startLine = (project, command, sid) => typed('guard-fresh-session-start.js', project, command, sid);
const reminder = (project, text, sid) => typed('communication-reminder.js', project, text, sid);
const ledgerKinds = (project, sid) =>
{
    try { return fs.readFileSync(path.join(project, '.alfred', 'statistics', 'hook-blocks', `${sid}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l).kind); }
    catch { return []; }
};
// The words of the command a refusal prints, as an argv: what follows `workspace.js` up to ` here`, quotes dropped.
const printedArgv = (line) => [...line.match(/workspace\.js (.+) here to stop/)[1].matchAll(/'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2]);

test('the bare auto-run line names the member it inherits ON from', { skip: SKIP_GIT }, () =>
{
    const { child } = pair(ROOT_ON);
    assert.strictEqual(startLine(child, '/alfred-code:mode:auto-run'), '[mode] auto-run is ON (from ..)');
});

test('the bare auto-run line says OFF with the member where the root holds a 0', { skip: SKIP_GIT }, () =>
{
    assert.strictEqual(startLine(pair({ [K('AUTO_RUN')]: '0' }).child, '/alfred-code:mode:auto-run'), '[mode] auto-run is OFF (from ..)');
});

test('the bare auto-compact line says ON and OFF with the member it is inherited from', { skip: SKIP_GIT }, () =>
{
    assert.strictEqual(startLine(pair({ [K('AUTO_COMPACT')]: '1' }).child, '/alfred-code:mode:auto-compact'), '[mode] auto-compact is ON (from ..)');
    assert.strictEqual(startLine(pair({ [K('AUTO_COMPACT')]: '0' }).child, '/alfred-code:mode:auto-compact'), '[mode] auto-compact is OFF (from ..)');
});

test('the bare auto-run line names no source where the child holds its own value', { skip: SKIP_GIT }, () =>
{
    assert.strictEqual(startLine(pair(ROOT_ON, { [K('AUTO_RUN')]: '0' }).child, '/alfred-code:mode:auto-run'), '[mode] auto-run is OFF');
});

test('an inherited 1 that git tracks is said as OFF with the member named, never taken', { skip: SKIP_GIT }, () =>
{
    const { child } = pair(ROOT_ON, {}, { trackRoot: true });
    assert.strictEqual(startLine(child, '/alfred-code:mode:auto-run'), `[mode] auto-run is OFF: ..'s file holds it, but ${M.WHY.tracked} - asks stay with you`);
});

test('the run contract names the member whose file holds the inherited auto-run', { skip: SKIP_GIT }, () =>
{
    const { child } = pair(ROOT_ON);
    const said = contextOf(runHook('guard-fresh-session-start.js', { hook_event_name: 'UserPromptExpansion', session_id: 'st1', cwd: child, transcript_path: transcript(),
        expansion_type: 'slash_command', command_name: 'loop-code-quality', command_args: 'src/', prompt: '/loop-code-quality src/', prompt_id: 'p1' }, child));
    assert.match(said, /auto-run is on for this checkout, new sessions included \(\.\.\/\.claude\/settings\.local\.json holds ALFRED_CODE_AUTO_RUN=1 - this folder inherits it\)/);
});

test('auto-run off in an inheriting child writes 0 there, leaves the root alone and says where the on lives', { skip: SKIP_GIT }, () =>
{
    const { root, child } = pair(ROOT_ON);
    const rootBefore = fs.readFileSync(modeFileOf(root), 'utf8');
    assert.strictEqual(startLine(child, '/alfred-code:mode:auto-run off'), OFF_HERE('..'));
    assert.strictEqual(JSON.parse(fs.readFileSync(modeFileOf(child), 'utf8')).env[K('AUTO_RUN')], '0');
    assert.strictEqual(fs.readFileSync(modeFileOf(root), 'utf8'), rootBefore);
    assert.strictEqual(startLine(child, '/alfred-code:mode:auto-run'), '[mode] auto-run is OFF');
});

test('auto-run off where git tracks the child\'s file changes no file, names the ignore command, and that command ends the inheritance', { skip: SKIP_GIT }, () =>
{
    const { root, child } = pair(ROOT_ON, {}, { trackChild: true });
    const [childBefore, rootBefore] = [fs.readFileSync(modeFileOf(child)), fs.readFileSync(modeFileOf(root))];
    const said = startLine(child, '/alfred-code:mode:auto-run off');
    assert.match(said, /^\[mode\] auto-run stays ON here: it is inherited from \.\., and git tracks this folder's \.claude\/settings\.local\.json, so the off cannot be kept in it - run node \S+\/scripts\/workspace\.js ignore --root \. --add 'env ALFRED_CODE_AUTO_RUN' here to stop inheriting it$/);
    assert.ok(said.includes(IGNORE_ADD));
    assert.deepStrictEqual([fs.readFileSync(modeFileOf(child)), fs.readFileSync(modeFileOf(root))], [childBefore, rootBefore], 'no mode file changed');
    assert.strictEqual(startLine(child, '/alfred-code:mode:auto-run'), '[mode] auto-run is ON (from ..)');
    // the printed command, run as printed from the child's folder (the plugin root is the repo's here)
    const cli = spawnSync(process.execPath, [WORKSPACE_CLI, ...printedArgv(said)], { cwd: child, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: ACCT } });
    assert.strictEqual(cli.status, 0, cli.stdout + cli.stderr);
    assert.strictEqual(startLine(child, '/alfred-code:mode:auto-run'), '[mode] auto-run is OFF');
});

test('the context line says the auto-run is inherited on every prompt, the first included', { skip: SKIP_GIT }, () =>
{
    const { child } = pair(ROOT_ON);
    const line = ' auto-run: on, inherited from .. - each ask takes its (Recommended) option; /alfred-code:mode:auto-run off here stops it for this folder';
    for (const text of ['hello', 'and again']) assert.ok(reminder(child, text, 'one-session').includes(line), text);
});

test('the context line keeps its own wording where the child holds the auto-run itself', { skip: SKIP_GIT }, () =>
{
    const ctx = reminder(pair({}, ROOT_ON).child, 'hello');
    assert.match(ctx, / auto-run: on - each ask takes its \(Recommended\) option; only \/alfred-code:mode:auto-run off ends it/);
    assert.doesNotMatch(ctx, /inherited from/);
});

test('the bare scoring line and its context line name the member the scoring is inherited from', { skip: SKIP_GIT }, () =>
{
    const { child } = pair({ [K('SCORING')]: '1', [K('SCORING_LEVEL')]: '90' });
    assert.ok(reminder(child, '/alfred-code:mode:scoring').startsWith('[mode] scoring is ON (from ..) (level 90, rounds 3)'));
    assert.match(reminder(child, 'hello'), /scoring: on \(level 90, rounds 3, inherited from \.\.\)/);
});

test('the bare scoring line says OFF with the member where the root holds ALFRED_CODE_SCORING=0', { skip: SKIP_GIT }, () =>
{
    assert.ok(reminder(pair({ [K('SCORING')]: '0' }).child, '/alfred-code:mode:scoring').startsWith('[mode] scoring is OFF (from ..)'));
});

test('an inherited 1 whose member file git cannot vouch for is said as OFF with the member named', { skip: SKIP_LINK }, () =>
{
    const { root, child } = pair(ROOT_ON);
    const real = fs.mkdtempSync(path.join(TMP, 'real-'));
    fs.cpSync(path.join(root, '.claude'), real, { recursive: true });
    fs.rmSync(path.join(root, '.claude'), { recursive: true });
    fs.symlinkSync(real, path.join(root, '.claude'), 'dir');
    assert.strictEqual(startLine(child, '/alfred-code:mode:auto-run'), `[mode] auto-run is OFF: ..'s file holds it, but ${M.WHY.unvouched} - asks stay with you`);
});

test('a scoring flag typed in the child is its own value: no member is named on its lines', { skip: SKIP_GIT }, () =>
{
    const off = reminder(pair({ [K('SCORING')]: '0' }).child, '/alfred-code:mode:scoring off');
    assert.ok(off.startsWith('[mode] scoring is OFF (level 80, rounds 3 kept)'), off.slice(0, 80));
    const on = reminder(pair({ [K('SCORING')]: '1' }).child, '/alfred-code:mode:scoring on 90');
    assert.ok(on.startsWith('[mode] scoring is ON (level 90, rounds 3)'), on.slice(0, 80));
    assert.doesNotMatch(on, /inherited from|\(from /);
});

test('auto-run off over an inherited on writes the auto-end ledger row an own-file off writes', { skip: SKIP_GIT }, () =>
{
    const { child } = pair(ROOT_ON);
    startLine(child, '/alfred-code:mode:auto-run off', 'end-1');
    assert.deepStrictEqual(ledgerKinds(child, 'end-1').filter((kind) => kind === 'auto-end'), ['auto-end']);
});

// scoringState runs in a child process: loading the prelude applies the cwd project's variables to that process's env.
function scoringSource(project, ownEnv)
{
    const script = `const p = require(${JSON.stringify(path.join(HOOKS, 'hook-prelude.js'))}); process.stdout.write(JSON.stringify(p.scoringState(${JSON.stringify(project)}, 's')));`;
    const env = { ...process.env, CLAUDE_CONFIG_DIR: ACCT };
    for (const key of Object.keys(env)) if (/^ALFRED_CODE_/.test(key) || key === 'CLAUDE_PROJECT_DIR') delete env[key];
    const r = spawnSync(process.execPath, ['-e', script], { cwd: project, env: { ...env, ...ownEnv }, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr);
    return JSON.parse(r.stdout);
}

test('scoringState reports its source as inherited from the member, and env otherwise', { skip: SKIP_GIT }, () =>
{
    const { child } = pair({ [K('SCORING')]: '1' });
    assert.strictEqual(scoringSource(child).source, 'inherited from ..');
    assert.strictEqual(scoringSource(pair({}, { [K('SCORING')]: '1' }).child).source, 'env', 'the child\'s own value is no inheritance');
    assert.strictEqual(scoringSource(pair({ [K('SCORING')]: '1' }).root).source, 'env', 'the root inherits from nobody');
    assert.strictEqual(scoringSource(child, { [K('SCORING')]: '0' }).source, 'env', 'a launch value of the key is an own layer');
});

test('a session started in a sub-folder of the child names no member for a scoring value it did not take from one', { skip: SKIP_GIT }, () =>
{
    const { child } = pair({ [K('SCORING')]: '0' });
    const src = path.join(child, 'src');
    fs.mkdirSync(src);
    const context = reminder(src, 'hello');
    assert.doesNotMatch(context, /scoring: on \([^)]*inherited from/, context.slice(0, 400));
    assert.notStrictEqual(scoringSource(src).source === 'inherited from ..' && scoringSource(src).on, true);
});
