'use strict';
// What a workspace root passes to its children, proved end to end: a real root and three children are installed from a
// clean export of THIS tree (plugin route, the core enabled at user scope through a stub `claude`), then each channel is
// read from the files and the hooks' own output - skills as links into the root's store, seats un-denied, the core's
// hooks left on, the root's variables, the rules a child's start sends, and the member index a root's start opens with.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { cleanExport } = require('./clean-export.js');
const { POSIX_ONLY, scrubStackEnv } = require('./seed-sandbox.js');
const { realLong } = require('./test-paths.js');

const REPO = path.resolve(__dirname, '..');
const CORE = 'alfred-code@envoydev';
const SEAT_KEPT = 'code-quality-analyzer';
const SEAT_ABSENT = 'security-auditor';
const VARIABLE_KEY = 'ALFRED_CODE_MAXIMUM_RUN_AGENTS';
const ROOT_SELECTION = 'skill javascript\nagent code-quality-analyzer\nrule alfred-security\nrule javascript-conventions\n';
const CHILD_SELECTION = 'skill javascript\nskill typescript\nagent code-quality-analyzer\nrule alfred-security\nrule javascript-conventions\n';
const TRACKED_SELECTION = 'skill javascript\nagent code-quality-analyzer\nrule alfred-security\nrule javascript-conventions\n';
const PLUGIN_LIST = JSON.stringify([{ id: CORE, enabled: true, scope: 'user' }]);
const CLAUDE_STUB = '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$CLAUDE_STUB_LOG"\nif [ "$1" = "plugin" ] && [ "$2" = "list" ]; then cat "$CLAUDE_STUB_PLUGINS"; exit 0; fi\nexit 0\n';
const FAILING_TOOLS = ['uvx', 'npx', 'npm', 'curl'];
const RULE_PARTS = [1, 2, 3, 4, 5];
const SECURITY_HEADING = /^## alfred-security /m;
const LOADED_NATIVELY_LINE = /^loaded natively:/m;
const API_OWN_HEADING = /^## api-own /m;
const MEMBER_INDEX_OPENING = /^Project rules, part 1[^\n]*\n\nWorkspace members/;
const HOOK_START = ['rules-session.js'];
const GIT_IDENTITY = ['-c', 'user.name=ws-test', '-c', 'user.email=ws-test@example.com'];
const TEST_TIMEOUT_MS = 900000;
const RUN_TIMEOUT_MS = 600000;
const HOME_DIRS = '.claude/\n.alfred/\n';

const work = realLong(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-inherit-')));
const exportDir = path.join(work, 'export');
const env = {};
let installs;

const at = (rel = '.') => path.join(work, 'ws', ...(rel === '.' ? [] : rel.split('/')));
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

function buildEnv()
{
    const bin = path.join(work, 'bin');
    fs.mkdirSync(bin);
    fs.mkdirSync(path.join(work, 'acct'));
    put(path.join(work, 'plugins.json'), PLUGIN_LIST);
    fs.writeFileSync(path.join(bin, 'claude'), CLAUDE_STUB, { mode: 0o755 });
    for (const tool of FAILING_TOOLS) fs.writeFileSync(path.join(bin, tool), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    Object.assign(env, process.env, {
        HOME: work, CLAUDE_CONFIG_DIR: path.join(work, 'acct'), PATH: bin + path.delimiter + process.env.PATH,
        CLAUDE_STUB_LOG: path.join(work, 'claude-calls.log'), CLAUDE_STUB_PLUGINS: path.join(work, 'plugins.json'), ALFRED_CODE_MEMORY_WARM: '0',
    });
    for (const key of Object.keys(env)) if (/^(CLAUDE_PROJECT_DIR|CLAUDE_PLUGIN_ROOT|CLAUDE_CODE_)/.test(key)) delete env[key];
    scrubStackEnv(env);
}

function run(cwd, argv, extraEnv = {}, input)
{
    const done = spawnSync(process.execPath, argv, { cwd, env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: RUN_TIMEOUT_MS, input });
    return { code: done.status, out: `${done.stdout || ''}${done.stderr || ''}`, stdout: done.stdout || '' };
}

const selectionFile = (text) =>
{
    const file = path.join(work, `selection-${crypto.randomBytes(4).toString('hex')}.txt`);
    fs.writeFileSync(file, text);
    return file;
};
const installer = () => path.join(exportDir, 'scripts', 'install', 'alfred-code.js');
const workspaceCli = () => path.join(exportDir, 'scripts', 'workspace.js');

function git(cwd, ...argv)
{
    const done = spawnSync('git', argv, { cwd, env, encoding: 'utf8' });
    assert.strictEqual(done.status, 0, `git ${argv.join(' ')} in ${cwd}: ${done.stdout}${done.stderr}`);
    return done.stdout;
}

function makeGitProject(rel, { ignoreHomes = true } = {})
{
    fs.mkdirSync(at(rel), { recursive: true });
    git(work, 'init', '-q', at(rel));
    if (ignoreHomes) put(path.join(at(rel), '.gitignore'), HOME_DIRS);
}

function installChild(rel, selection)
{
    const plan = path.join(work, `parent-${crypto.randomBytes(4).toString('hex')}.json`);
    const scope = run(at('.'), [path.join(exportDir, 'scripts', 'install', 'stamp.js'), 'scope', '.']).out.trim();
    run(at('.'), [installer(), 'update', '--source', exportDir, '--scope', scope, '--installed-only', '--print-plan', '--plan-out', plan]);
    const join = run(at(rel), [workspaceCli(), 'role', '--root', '.', '--answer', 'child']);
    const args = [installer(), 'install', '--source', exportDir, '--selection', selectionFile(selection),
        ...(join.code === 0 ? ['--parent-plan', plan] : []), '--instructions-file', 'agents', '--instructions-at', 'root'];
    return run(at(rel), args);
}

function buildWorkspace()
{
    cleanExport(REPO, exportDir);
    buildEnv();
    fs.mkdirSync(at('.'), { recursive: true });
    makeGitProject('api');
    makeGitProject('web');
    makeGitProject('tracked');
    put(path.join(at('api'), 'AGENTS.md'), '# Project api, part 1\n\nUse dotnet.\n');
    put(path.join(at('api'), '.claude', 'rules', 'api-own.md'), '# api own rule\n\nAPI-OWN-RULE-TEXT\n');
    put(path.join(at('api'), '.claude', 'skills', 'my-notes', 'SKILL.md'), '---\nname: my-notes\ndescription: Use when noting.\n---\n\nMY-NOTES\n');
    put(path.join(at('api'), '.claude', 'settings.local.json'), `${JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }] } }, null, 2)}\n`);
    put(path.join(at('tracked'), '.claude', 'skills', 'own', 'SKILL.md'), '---\nname: own\ndescription: Use when owning.\n---\n\nOWN\n');
    git(at('tracked'), ...GIT_IDENTITY, 'add', '-f', '.claude/skills');
    git(at('tracked'), ...GIT_IDENTITY, 'commit', '-q', '-m', 'track the skills');
    put(path.join(at('.'), '.alfred', '.variables'), `${VARIABLE_KEY}=7\n`);
    const root = run(at('.'), [installer(), 'install', '--source', exportDir, '--selection', selectionFile(ROOT_SELECTION)]);
    const rootRole = run(at('.'), [workspaceCli(), 'role', '--root', '.', '--answer', 'root']);
    put(path.join(at('.'), '.alfred', '.variables'), `${VARIABLE_KEY}=7\n`);
    const api = installChild('api', CHILD_SELECTION);
    const web = installChild('web', ROOT_SELECTION);
    const tracked = installChild('tracked', TRACKED_SELECTION);
    return { root, rootRole, api, web, tracked };
}

function hookOutput(rel, argv, payload, sessionId)
{
    const input = JSON.stringify({ session_id: sessionId, cwd: at(rel), transcript_path: path.join(work, 'none.jsonl'), ...payload });
    const done = run(at(rel), [path.join(exportDir, 'stack', 'hooks', ...HOOK_START), ...argv], { CLAUDE_PROJECT_DIR: at(rel), CLAUDE_PLUGIN_ROOT: exportDir }, input);
    assert.strictEqual(done.code, 0, `the hook crashed or refused in ${rel}: ${done.out.slice(-800)}`);
    return done.stdout;
}

function contextOf(stdout)
{
    try { return String(JSON.parse(stdout).hookSpecificOutput.additionalContext || ''); } catch { return ''; }
}

function startContext(rel, source, part, sessionId = `s-${crypto.randomBytes(3).toString('hex')}`)
{
    return contextOf(hookOutput(rel, ['--part', String(part)], { hook_event_name: 'SessionStart', source }, sessionId));
}

const readOutput = (rel, target, sessionId) => hookOutput(rel, [], {
    hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: path.join(at(target), 'AGENTS.md') }, tool_response: {},
}, sessionId);

const denyOf = (rel) => ((readJson(path.join(at(rel), '.claude', 'settings.local.json')).permissions || {}).deny || []);
const realUnderStore = (rel, name) => realLong(path.join(at(rel), '.claude', 'skills', name)).startsWith(path.join(realLong(at('.')), '.alfred', 'stack', 'skills'));

test.before(() => { if (POSIX_ONLY.skip) return; installs = buildWorkspace(); }, { timeout: TEST_TIMEOUT_MS });
test.after(() => { fs.rmSync(work, { recursive: true, force: true }); });

test('the tree installs: a root and its three children each finish with code 0', { ...POSIX_ONLY, timeout: TEST_TIMEOUT_MS }, () =>
{
    for (const [name, result] of Object.entries(installs)) assert.strictEqual(result.code, 0, `${name}: ${result.out.slice(-1500)}`);
});

test('skills pass as links into the root store; a child pick joins it; the child own skill stays', POSIX_ONLY, () =>
{
    for (const rel of ['api', 'web'])
    {
        const link = path.join(at(rel), '.claude', 'skills', 'javascript');
        assert.ok(fs.lstatSync(link).isSymbolicLink(), `${rel} javascript is a link`);
        assert.ok(realUnderStore(rel, 'javascript'), `${rel} javascript resolves into the root store`);
    }
    const typescript = path.join(at('api'), '.claude', 'skills', 'typescript');
    assert.ok(fs.lstatSync(typescript).isSymbolicLink(), 'api typescript is a link');
    assert.ok(realUnderStore('api', 'typescript'));
    assert.ok(fs.existsSync(path.join(at('.'), '.alfred', 'stack', 'skills', 'typescript')), 'the root store holds typescript');
    const own = path.join(at('api'), '.claude', 'skills', 'my-notes');
    assert.ok(fs.lstatSync(own).isDirectory() && !fs.lstatSync(own).isSymbolicLink(), 'my-notes stays a real folder');
    assert.match(fs.readFileSync(path.join(own, 'SKILL.md'), 'utf8'), /MY-NOTES/);
});

test('a child whose .claude/skills is committed in git gets copies, never links', POSIX_ONLY, () =>
{
    const skills = path.join(at('tracked'), '.claude', 'skills');
    assert.ok(fs.existsSync(path.join(skills, 'javascript', 'SKILL.md')), 'tracked holds javascript');
    const stat = fs.lstatSync(path.join(skills, 'javascript'));
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'javascript is a real folder');
    assert.ok(fs.lstatSync(path.join(skills, 'own')).isDirectory(), 'the committed own skill is intact');
});

test('seats: a seat the child picked is a linked store copy, no seat is denied, and an unpicked seat has no copy', POSIX_ONLY, () =>
{
    const agents = path.join(at('api'), '.claude', 'agents');
    assert.ok(fs.lstatSync(path.join(agents, SEAT_KEPT)).isSymbolicLink(), `${SEAT_KEPT} is a link`);
    assert.ok(realLong(path.join(agents, SEAT_KEPT)).startsWith(path.join(realLong(at('api')), '.alfred', 'stack', 'agents')), 'into the child\'s own store - it picked the seat too');
    assert.ok(!fs.existsSync(path.join(agents, SEAT_ABSENT)), `${SEAT_ABSENT} is not copied`);
    for (const rel of ['.', 'api', 'web', 'tracked']) assert.deepStrictEqual(denyOf(rel).filter((d) => /^Agent\(/.test(d)), [], `${rel}: no seat deny`);
});

test('hooks: the core rides the user-scope row, so a child run never switches it off', POSIX_ONLY, () =>
{
    const local = readJson(path.join(at('api'), '.claude', 'settings.local.json'));
    assert.notStrictEqual((local.enabledPlugins || {})[CORE], false, 'no enabledPlugins false row for the core');
    const calls = fs.readFileSync(path.join(work, 'claude-calls.log'), 'utf8').split('\n');
    const switchedOff = calls.filter((line) => /plugin (disable|uninstall)/.test(line) && /alfred-code/.test(line));
    assert.deepStrictEqual(switchedOff, [], 'the stub saw no disable or uninstall of the core');
    assert.ok(calls.some((line) => line.startsWith('plugin list')), 'the stub answered a plugin list');
    const mine = (local.hooks || {}).PreToolUse || [];
    assert.ok(JSON.stringify(mine).includes('echo mine'), 'the hand-added PreToolUse row is still there');
});

test('variables: the root value reaches a hook started in the child, and the child own value wins', POSIX_ONLY, () =>
{
    const layout = require(path.join(exportDir, 'stack', 'hooks', 'layout.js'));
    const valueIn = (rel) => layout.variablesOf(at(rel), { env: { ...env } }).values[VARIABLE_KEY];
    assert.strictEqual(valueIn('api'), '7', 'the root key reads 7 in api');
    put(path.join(at('api'), '.alfred', '.variables'), `${VARIABLE_KEY}=3\n`);
    assert.strictEqual(valueIn('api'), '3', 'the child own key wins');
    assert.strictEqual(valueIn('web'), '7', 'a sibling still reads the root value');
    const applied = { ...env };
    layout.applyVariables(at('api'), applied);
    assert.strictEqual(applied[VARIABLE_KEY], '3', 'a hook env started in api carries the child value');
});

for (const source of ['startup', 'resume', 'fork'])
{
    test(`rules: a child's ${source} sends neither the root security rule nor its own rule, both held natively`, POSIX_ONLY, () =>
    {
        const all = RULE_PARTS.map((part) => startContext('api', source, part, `s-${source}-${part}`)).join('\n');
        const rootNative = fs.readFileSync(path.join(at('.'), '.claude', 'rules', 'alfred-security.md'), 'utf8');
        assert.ok(rootNative.includes('generated by alfred-code'), 'the root holds its security rule as a marked native file');
        assert.doesNotMatch(all, SECURITY_HEADING, 'the loader does not send a rule the root holds natively');
        assert.doesNotMatch(all, API_OWN_HEADING, 'the loader does not send the child own rule, held natively');
        assert.doesNotMatch(all, LOADED_NATIVELY_LINE, 'the loaded-natively line is gone');
    });
}

test('root: the start opens with the member index naming api/AGENTS.md; a Read of it sends no rule text', POSIX_ONLY, () =>
{
    const sessionId = 's-root-members';
    const first = startContext('.', 'startup', 1, sessionId);
    assert.match(first, MEMBER_INDEX_OPENING, `part 1 opens with the index: ${first.slice(0, 300)}`);
    assert.match(first, /api\/AGENTS\.md/);
    assert.strictEqual(readOutput('.', 'api', sessionId).trim(), '', 'a Read sends no member block: the touch row is gone');
});
