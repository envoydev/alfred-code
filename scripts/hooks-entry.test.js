'use strict';
const test = require('node:test');
// 2.1.5 M5: no inherited stack env, entrypoint or project dir, and the suite fails on a write under os.tmpdir()'s docs root.
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const build = require('./build-marketplace.js');
const { parseHookWirings, hooksBlock, coreEntry } = build;

const dispatcher = require('../stack/hooks/shell-guards.js');
const fileDispatcher = require('../stack/hooks/file-guards.js');
const historySession = require('../stack/hooks/history-session.js');
const wirings = parseHookWirings();
const block = hooksBlock(wirings);

test('the wirings come from the installer table, not a second list', () => {
    assert.ok(wirings.length >= 26, `expected the installer's whole HOOKS table, got ${wirings.length}`);
    // The shell guards launch as ONE dispatcher and the file guards as another, each running its guards in-process.
    const files = new Set(wirings.flatMap(w => (w.file === `${dispatcher.SELF}.js` ? dispatcher.GUARDS.map(g => `${g}.js`)
        : w.file === `${fileDispatcher.SELF}.js` ? fileDispatcher.NAMES.map(g => `${g}.js`)
        // The turn build check rides history-session's Stop process (2026-10-16): a hook, though it starts no process of its own.
        : w.file === 'history-session.js' && w.event === 'Stop' ? [w.file, ...historySession.RIDERS.map(g => `${g}.js`)] : [w.file])));
    assert.strictEqual(files.size, 17, 'seventeen hooks, however many wirings they take');
    for (const w of wirings) assert.ok(/^[a-z-]+\.js$/.test(w.file), `odd file name: ${w.file}`);
});

test('a bare matcher is a PreToolUse wiring; an @ prefix names its own event', () => {
    // The file tools' guards ride one dispatcher row since 2.1.5 (M3); it is a bare matcher list like any other.
    const read = wirings.find(w => w.file === 'file-guards.js' && w.matcher === fileDispatcher.MATCHER);
    assert.ok(read, 'the file-tool wiring must survive');
    assert.strictEqual(read.event, 'PreToolUse');

    const stop = wirings.find(w => w.file === 'guard-stop-contract.js' && w.event === 'Stop');
    assert.ok(stop, 'the Stop wiring must survive');
    assert.strictEqual(stop.matcher, undefined, 'Stop takes no matcher');

    const compact = wirings.find(w => w.file === 'guard-fresh-session-start.js' && w.event === 'SessionStart');
    assert.ok(compact, 'the SessionStart wiring must survive');
    assert.strictEqual(compact.matcher, 'compact', 'an @Event:matcher form keeps its matcher');
});

// Shell form, launched through `node`, the path QUOTED - the spelling the docs give for a plugin
// script ('Exec form and shell form', code.claude.com/docs/en/hooks: 'the node plus script-path
// pattern works on every platform'). A bare script path needs the exec bit and a shebang the
// platform honours: five hooks were committed 100644, and Windows runs neither.
// Audit 2026-10-08 row 28: the plugin route spawned the tool-usage log on every tool call and waited on it; it runs async
// now (code.claude.com/docs/en/hooks, 'Run hooks in the background'), and nothing that must block or decide does.
// Audit 2026-10-14 HK12 made the stop contract's PostToolUse / PostToolUseFailure probe async; the deep hooks review
// 2026-10-16 dropped that probe, so the tool-usage log is the one async hook and the stop contract wires no shell result.
test('only the log-only hook runs async - the tool-usage log - so every guard can still block', () => {
    const async = Object.entries(block).flatMap(([event, groups]) => groups.flatMap((b) => b.hooks.filter((h) => h.async === true)
        .map((h) => `${event} ${h.command.replace(/^node "\$\{CLAUDE_PLUGIN_ROOT\}\/stack\/hooks\//, '').replace(/"$/, '')}`))).sort();
    assert.deepStrictEqual(async, ['PreToolUse instrument-tool-usage.js']);
    for (const [event, groups] of Object.entries(block))
        for (const h of groups.flatMap((b) => b.hooks))
            if (/guard-stop-contract\.js/.test(h.command)) assert.ok(!h.async && !/^PostToolUse/.test(event), `the stop contract's ${event} half must block, and no shell result is wired`);
    const core = JSON.stringify(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'plugin-entries.json'), 'utf8')));
    assert.match(core, /instrument-tool-usage\.js\\"","timeout":10,"async":true/, 'the generated entry carries it');
    assert.strictEqual((core.match(/guard-stop-contract\.js\\"","timeout":10,"async":true/g) || []).length, 0, 'and no stop-contract half');
    // the copy route writes the same table, and backfills it onto an older blocking entry
    const { asyncFor } = require('./install/settings.js');
    for (const event of ['Stop', 'SubagentStop', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure']) assert.ok(!asyncFor('guard-stop-contract.js', event), event);
    assert.ok(asyncFor('instrument-tool-usage.js', 'PreToolUse') && !asyncFor('shell-guards.js', 'PreToolUse'));
});

test('the block is a valid plugin hooks object: node launcher, timeout 10 (60 and 80 for the two declared exceptions), plugin-root paths', () => {
    for (const [event, blocks] of Object.entries(block))
    {
        assert.ok(Array.isArray(blocks) && blocks.length, `${event} must hold at least one block`);
        for (const b of blocks)
            for (const h of b.hooks)
            {
                assert.strictEqual(h.type, 'command');
                // check-turn-build.js runs a real build at Stop - the one wiring allowed past 10s - and since 2026-10-16
                // it rides history-session's Stop process, which takes its 60 (history-session.js wiringRows).
                // Each dispatcher runs its guards in one process: their 10s each, summed.
                const expected = event === 'Stop' && /(check-turn-build|history-session)\.js"/.test(h.command) ? 60
                    : /shell-guards\.js"/.test(h.command) ? 10 * dispatcher.GUARDS.length
                    : /file-guards\.js"/.test(h.command) ? 10 * fileDispatcher.GUARDS.length : 10;
                assert.strictEqual(h.timeout, expected, `${event} wiring must carry timeout ${expected}: ${h.command}`);
                assert.match(h.command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/stack\/hooks\/[a-z-]+\.js"( \S+)*$/,
                    `${event} command must launch through node, quoted, from the plugin root: ${h.command}`);
                // Exec form was built and reverted in 2.1.6 (M3): about 5ms per launch on macOS, and Cursor's hook
                // schema has no args, so a copied row there ran a bare node and let every protective guard through.
                assert.ok(!('args' in h), `${event}: an args array switches to exec form, which needs a real executable - keep args in the string`);
            }
    }
});

// The launcher may not depend on the file's MODE: git carries the bit into the plugin cache
// verbatim, and a 100644 hook run as a bare path died 'permission denied' (exit 126) before a line
// of it ran. So each generated command runs here through sh, the way Claude Code runs a shell-form
// hook, against a stub that is NOT executable, under a root whose path holds a space - once with
// the placeholder exported, once substituted as text.
test('every generated hook command runs a non-executable script, under a root with a space', { skip: process.platform === 'win32' && 'no mode bits on Windows' }, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hook launcher '));
    try
    {
        const commands = new Set();
        for (const blocks of Object.values(coreEntry().hooks))
            for (const b of blocks) for (const h of b.hooks) commands.add(h.command);
        assert.ok(commands.size >= 14, `expected the seventeen hooks (the shell and file guards through their two dispatchers, the turn check through history-session's Stop) plus the core's own two, got ${commands.size}`);
        const env = { PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}` };
        for (const command of commands)
        {
            const stub = path.join(root, command.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s]+)/)[1]);
            fs.mkdirSync(path.dirname(stub), { recursive: true });
            fs.writeFileSync(stub, '#!/usr/bin/env node\nprocess.exit(0);\n');
            fs.chmodSync(stub, 0o644);
            for (const [how, line, extra] of [
                ['exported', command, { CLAUDE_PLUGIN_ROOT: root }],
                ['substituted', command.replaceAll('${CLAUDE_PLUGIN_ROOT}', root), {}],
            ])
            {
                const run = spawnSync('sh', ['-c', line], { env: { ...env, ...extra }, input: '{}', encoding: 'utf8' });
                assert.strictEqual(run.status, 0, `${how}: ${command} -> exit ${run.status}: ${String(run.stderr).trim()}`);
            }
        }
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('every event the stack wires is present, and each keeps its own matchers', () => {
    for (const event of ['PreToolUse', 'Stop', 'SubagentStop', 'SubagentStart', 'SessionStart', 'UserPromptSubmit'])
        assert.ok(block[event], `${event} must be wired`);
    const pre = block.PreToolUse.map(b => b.matcher);
    assert.ok(pre.includes(fileDispatcher.MATCHER), 'the file-tool matcher survives');
    assert.ok(pre.includes('Task|Agent'), 'the dispatch matcher survives');
    assert.ok(pre.includes('.*'), 'the instrumentation catch-all survives');
    const session = block.SessionStart.map(b => b.matcher);
    assert.ok(session.includes('compact'), 'the compact matcher survives');
    assert.ok(session.includes(undefined), 'and the bare SessionStart wiring beside it');
});

test('one matcher holding several hooks groups them, so the entry stays readable', () => {
    for (const [event, blocks] of [...Object.entries(block), ...Object.entries(coreEntry().hooks)])
    {
        const seen = new Set();
        for (const b of blocks)
        {
            const key = String(b.matcher);
            assert.ok(!seen.has(key), `${event} repeats the matcher ${key} instead of grouping it`);
            seen.add(key);
        }
    }
});

// 2.0.0 folds the hooks into the core (user ruling 'Fold into core in 2.0.0'): there is no hooks
// entry to generate, and the core carries the stack hooks INLINE - still no hooks/hooks.json at the
// shared root, which every entry over it would auto-discover (spike S9).
test('the hooks ride the core: no hooks entry is generated, and the core declares them inline', () => {
    for (const gone of ['hooksPlugin', 'HOOKS_PLUGIN', 'applyHooksPlugin', 'applyRenames', 'MARKETPLACE_RENAMES'])
        assert.ok(!(gone in build), `${gone} is gone with the hooks entry and the renames map`);
    const core = coreEntry();
    assert.strictEqual(core.source, './');
    assert.strictEqual(core.strict, false);
    const wired = JSON.stringify(core.hooks);
    for (const w of wirings) assert.ok(wired.includes(`stack/hooks/${w.file}`), `the core carries ${w.file}`);
    assert.ok(!fs.existsSync(path.join(__dirname, '..', 'hooks', 'hooks.json')), 'nothing sits at the shared root');
});

// I1 (2.1.4 audit): the Monitor tool runs a shell `command` under Bash's permission rules
// (code.claude.com/docs/en/tools-reference, 'Monitor tool'), so the shell guards judge it too. Replayed
// through the GENERATED core wiring, matched the way Claude Code matches (code.claude.com/docs/en/hooks,
// 'Matcher String Evaluation': only letters, digits, `_`, `-`, spaces, `,` and `|` is an exact list,
// anything else an unanchored regular expression).
const matches = (matcher, tool) =>
{
    if (matcher === undefined || matcher === '' || matcher === '*') return true;
    if (/^[\w\s,|-]+$/.test(matcher)) return matcher.split(/[|,]/).map(s => s.trim()).includes(tool);
    return new RegExp(matcher).test(tool);
};
function replayPreToolUse(tool, toolInput, cwd)
{
    const repo = path.join(__dirname, '..');
    const out = [];
    for (const g of coreEntry().hooks.PreToolUse.filter(b => matches(b.matcher, tool)))
        for (const h of g.hooks)
        {
            const line = h.command.replaceAll('${CLAUDE_PLUGIN_ROOT}', repo);
            const env = { ...process.env, CLAUDE_PROJECT_DIR: cwd };
            delete env.ALFRED_CODE_DOCS_PATH;
            delete env.CLAUDE_CODE_ENTRYPOINT;
            out.push(spawnSync('sh', ['-c', line], { cwd, env, encoding: 'utf8',
                input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 'monitor-route', cwd, tool_name: tool, tool_input: toolInput }) }));
        }
    return out;
}
const denied = (runs) => runs.some(r => r.status === 2 || /"permissionDecision":"deny"/.test(r.stdout));
const rewrittenTo = (runs) => runs.map(r => { try { return JSON.parse(r.stdout).hookSpecificOutput.updatedInput.command; } catch { return null; } }).find(Boolean) || null;

test('the Monitor route: the shell guards judge a Monitor command through the generated wiring', { skip: process.platform === 'win32' && 'sh launcher' }, () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-route-'));
    try
    {
        fs.writeFileSync(path.join(cwd, '.env'), 'API_KEY=abc123\n');
        assert.ok(denied(replayPreToolUse('Monitor', { command: 'rm -rf ~', description: 'x' }, cwd)), 'rm -rf ~ through Monitor');
        assert.ok(denied(replayPreToolUse('Monitor', { command: 'git push -f origin main', description: 'x' }, cwd)), 'a force-push through Monitor');
        const view = rewrittenTo(replayPreToolUse('Monitor', { command: 'cat .env', description: 'x' }, cwd));
        assert.ok(view && /--redacted/.test(view), `cat .env through Monitor is rewritten to the redacted view: ${view}`);
        // a WebSocket watch carries no command, and passes untouched
        const ws = replayPreToolUse('Monitor', { ws: { url: 'wss://example.test/feed' }, description: 'x' }, cwd);
        assert.ok(!denied(ws) && !rewrittenTo(ws), 'a ws watch passes');
        // the Bash spelling agrees, so the route is the same gate
        assert.ok(denied(replayPreToolUse('Bash', { command: 'rm -rf ~' }, cwd)), 'and Bash still blocks');
    }
    finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test('the slash route is UserPromptExpansion, its matcher naming every orchestration command and nothing else (2.1.5 M14)', () => {
    // UserPromptExpansion fires on a typed command and carries its name (code.claude.com/docs/en/hooks), so the
    // offer no longer spawns on every prompt. A matcher with any character past letters, digits, `_`, `-`,
    // spaces, `,` and `|` is an unanchored JavaScript regex - evaluated here the way Claude Code evaluates it.
    const file = 'guard-fresh-session-start.js';
    const slash = (block.UserPromptExpansion || []).filter((b) => b.hooks.some((h) => h.command.includes(file)));
    assert.strictEqual(slash.length, 1, 'wired once on UserPromptExpansion');
    const matches = (name) => new RegExp(slash[0].matcher).test(name);
    const src = fs.readFileSync(path.join(__dirname, '..', 'stack', 'hooks', file), 'utf8');
    // UserPromptSubmit carries ONLY the auto-mode end (2026-10-14) and the idle-gap route (audit 2026-10-10 C09): the
    // branch ends a session's own auto-mode or offers on a gap, and exits, so the slash offer never runs on an ordinary prompt.
    const submit = (block.UserPromptSubmit || []).filter((b) => b.hooks.some((h) => h.command.includes(file)));
    assert.ok(submit.length <= 1, 'at most once on UserPromptSubmit');
    assert.match(src, /if \(EVENT === 'UserPromptSubmit'\) \{\s*if \(!autoModeEnd\(\)\) idleGapOffer\(\);\s*process\.exit\(0\);\s*\}/, 'and that route is the auto-mode end or the idle gap, then out');
    const orchestration = new RegExp(src.match(/^const ORCHESTRATION = \/(.+)\/;$/m)[1]);
    const names = ['loop-code-quality', 'loop-architecture-quality', 'loop-test-coverage', 'capture-architecture',
        'capture-awareness', 'task-solve', 'task-solve-cross', 'task-verify-code', 'issue-diagnoser',
        'security-review', 'alfred-code:init', 'alfred-code:setup', 'alfred-code:update', 'alfred-code:configure', 'alfred-code:validate'];
    for (const n of names) {
        assert.ok(orchestration.test(n), `${n} is one the hook judges`);
        assert.ok(matches(n) && matches(n.replace(/^.*:/, '')), `${n} reaches the hook under either spelling`);
        if (!n.includes(':')) assert.ok(matches(`alfred-code:${n}`), `${n} reaches it plugin-scoped too`);
    }
    for (const n of ['help', 'clear', 'compact', 'dev-log-convert', 'my-setup', 'tasks', 'my-task-x', 'csharp', 'alfred-code:status'])
        assert.ok(!matches(n), `${n} never spawns the hook`);
    // every task-*, loop-* and issue-* name reaches it, a project's own and a digit included: `auto-mode` opening any of them starts a
    // run, and the hook exits at once for one that is no orchestration run (audit 2026-10-14 HK06)
    for (const n of ['task-migrate-v2', 'task-solved', 'loop-perf', 'alfred-code:task-x2'])
        assert.ok(matches(n), `${n} reaches the hook`);
});

test('the retired tool names are kept evenly: every file-write matcher names MultiEdit, the dispatch one Task (2.1.5 M7)', () => {
    // The tools reference lists neither, but a matcher token no tool carries never matches, and the CLI still
    // spells both (MultiEdit among its edit-tool names, Task as the agent tool's old name) - so they stay, on
    // every sibling alike, and the manifest's note says why once.
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'stack-manifest.json'), 'utf8'));
    const writers = manifest.hooks.filter((r) => /(^|[|:])(Write|Edit)(\||$)/.test(r.matcher));
    assert.ok(writers.length >= 4, writers.map((r) => r.file).join(', '));
    for (const r of writers) assert.match(r.matcher, /(^|[|:])MultiEdit(\||$)/, `${r.file} ${r.matcher}`);
    const dispatch = manifest.hooks.filter((r) => /(^|[|:])Agent(\||$)/.test(r.matcher));
    for (const r of dispatch) assert.match(r.matcher, /(^|[|:])Task(\||$)/, `${r.file} ${r.matcher}`);
    assert.match(manifest.note, /MultiEdit[\s\S]*Task/, 'the one note that says why');
});

test('the hooks audit\'s currency rows follow the hooks reference: DirectoryAdded takes a matcher, SessionStart has a fork source (2.1.5 M18)', () => {
    // hooks reference, 'Matcher patterns' (fetched 2026-09-29): DirectoryAdded matches on how the directory was
    // added (slash_command, register_repo_root); the no-matcher set is UserPromptSubmit, PostToolBatch, Stop,
    // TeammateIdle, TaskCreated, TaskCompleted, WorktreeCreate, WorktreeRemove, MessageDisplay and CwdChanged;
    // SessionStart's matcher values are startup, resume, clear, compact and fork.
    const dir = path.join(__dirname, '..', '.claude', 'skills', 'repo-audit-hooks', 'references');
    const currency = fs.readFileSync(path.join(dir, 'currency.md'), 'utf8');
    const rubric = fs.readFileSync(path.join(dir, 'rubric.md'), 'utf8');
    assert.doesNotMatch(currency, /the eleven events with no matcher/, 'the stale count is gone');
    assert.match(currency, /the ten events with no matcher/);
    assert.match(currency, /`DirectoryAdded` matches on how the directory was added \(`slash_command`, `register_repo_root`\)/);
    assert.match(currency, /`SessionStart` sources `startup` \/ `resume` \/ `clear` \/ `compact` \/ `fork`/);
    const noMatcher = rubric.match(/no matcher on the events that ignore one - ([^;)]*)[;)]/)[1];
    assert.doesNotMatch(noMatcher, /DirectoryAdded/, 'the rubric no longer lists DirectoryAdded among the events that ignore a matcher');
});

// Audit 2026-10-14 HK07 (the user's ruling): a hook that fails - cannot start, times out, exits other than 0 / 2 - lets the
// call through unless it sets `onFailure: "block"` (code.claude.com/docs/en/hooks, 'Block the action when a hook fails',
// 2.1.295+). The shell-guard dispatcher alone carries it, on both routes: its rm, force-push and secret guards are the ones a
// crashed or stalled dispatcher would silently pass. The copy route backfills it onto an older entry once, touches no
// hook of the user's, and a re-run changes nothing.
test('the shell-guard dispatcher alone blocks the call when it fails - plugin and copy routes, backfilled once (HK07)', () => {
    const flagged = Object.entries(block).flatMap(([event, groups]) => groups.flatMap((b) => b.hooks.filter((h) => h.onFailure !== undefined)
        .map((h) => `${event} ${b.matcher} ${h.onFailure} ${h.command.replace(/^node "\$\{CLAUDE_PLUGIN_ROOT\}\/stack\/hooks\//, '').replace(/"$/, '')}`)));
    assert.deepStrictEqual(flagged, [`PreToolUse ${dispatcher.MATCHER} block shell-guards.js`]);
    const core = JSON.stringify(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'plugin-entries.json'), 'utf8')));
    assert.strictEqual((core.match(/"onFailure":"block"/g) || []).length, 1, 'the generated entry carries it once');
    assert.match(core, /shell-guards\.js\\"","timeout":\d+,"onFailure":"block"/, 'on the dispatcher');
    const { onFailureFor, writeSettings, hookCommand } = require('./install/settings.js');
    assert.strictEqual(onFailureFor('shell-guards.js', 'PreToolUse'), 'block');
    for (const [file, event] of [['file-guards.js', 'PreToolUse'], ['guard-stop-contract.js', 'Stop'], ['instrument-tool-usage.js', 'PreToolUse'], ['shell-guards.js', 'PostToolUse']])
        assert.strictEqual(onFailureFor(file, event), undefined, `${file} ${event}`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-entry-onfailure-'));
    try {
        const file = path.join(dir, '.claude', 'settings.json');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const cmd = hookCommand('shell-guards.js', '').command;
        const mine = { type: 'command', command: 'node my-own-bash-hook.js', timeout: 5 };
        // an older install wired the dispatcher without it, beside the user's own Bash hook
        fs.writeFileSync(file, JSON.stringify({ hooks: { PreToolUse: [{ matcher: dispatcher.MATCHER, hooks: [{ type: 'command', command: cmd, timeout: 90 }] },
            { matcher: 'Bash', hooks: [mine] }] } }));
        const specs = [...dispatcher.GUARDS.map((g) => ({ file: `${g}.js`, matcher: dispatcher.MATCHER })), { file: 'guard-stop-contract.js', matcher: '@Stop' }];
        const opts = { file, catalog: require('../meta/environment.json').env, migrations: {}, log: () => {}, note: () => {}, hookSpecs: specs };
        writeSettings(opts);
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        const ours = data.hooks.PreToolUse.flatMap((e) => e.hooks).filter((h) => h.command === cmd);
        assert.deepStrictEqual(ours.map((h) => h.onFailure), ['block'], 'backfilled onto the older entry, not doubled');
        assert.deepStrictEqual(data.hooks.PreToolUse.find((e) => e.matcher === 'Bash').hooks, [mine], 'the user\'s own hook is untouched');
        assert.deepStrictEqual(data.hooks.Stop.flatMap((e) => e.hooks).map((h) => h.onFailure), [undefined], 'a Stop hook never carries it');
        const before = fs.readFileSync(file, 'utf8');
        writeSettings(opts);
        assert.strictEqual(fs.readFileSync(file, 'utf8'), before, 'a re-run changes nothing');
        // a fresh file gets it written with the entry
        fs.rmSync(file);
        writeSettings(opts);
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).hooks.PreToolUse.flatMap((e) => e.hooks).map((h) => h.onFailure), ['block']);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
