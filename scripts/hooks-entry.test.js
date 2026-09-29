'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const build = require('./build-marketplace.js');
const { parseHookWirings, hooksBlock, coreEntry } = build;

const dispatcher = require('../stack/hooks/shell-guards.js');
const wirings = parseHookWirings();
const block = hooksBlock(wirings);

test('the wirings come from the installer table, not a second list', () => {
    assert.ok(wirings.length >= 26, `expected the installer's whole HOOKS table, got ${wirings.length}`);
    // The shell guards launch as ONE dispatcher, which runs each of them in-process.
    const files = new Set(wirings.flatMap(w => (w.file === `${dispatcher.SELF}.js` ? dispatcher.GUARDS.map(g => `${g}.js`) : [w.file])));
    assert.strictEqual(files.size, 18, 'eighteen hooks, however many wirings they take');
    for (const w of wirings) assert.ok(/^[a-z-]+\.js$/.test(w.file), `odd file name: ${w.file}`);
});

test('a bare matcher is a PreToolUse wiring; an @ prefix names its own event', () => {
    const read = wirings.find(w => w.file === 'guard-read-whole-file.js' && w.matcher === 'Read');
    assert.ok(read, 'the Read wiring must survive');
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
test('the block is a valid plugin hooks object: node launcher, timeout 10 (60 and 80 for the two declared exceptions), plugin-root paths', () => {
    for (const [event, blocks] of Object.entries(block))
    {
        assert.ok(Array.isArray(blocks) && blocks.length, `${event} must hold at least one block`);
        for (const b of blocks)
            for (const h of b.hooks)
            {
                assert.strictEqual(h.type, 'command');
                // check-turn-build.js runs a real build at Stop - the one wiring allowed past 10s. Its
                // PostToolUse half only appends a path, so it keeps 10 like every other hook.
                // The shell-guard dispatcher runs eight guards in one process: their 10s each, summed.
                const expected = event === 'Stop' && /check-turn-build\.js"/.test(h.command) ? 60
                    : /shell-guards\.js"/.test(h.command) ? 10 * dispatcher.GUARDS.length : 10;
                assert.strictEqual(h.timeout, expected, `${event} wiring must carry timeout ${expected}: ${h.command}`);
                assert.match(h.command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/stack\/hooks\/[a-z-]+\.js"( \S+)*$/,
                    `${event} command must launch through node, quoted, from the plugin root: ${h.command}`);
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
        assert.ok(commands.size >= 17, `expected the eighteen hooks (the eight shell guards through one dispatcher) plus the core's own two, got ${commands.size}`);
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
    assert.ok(pre.includes('Read'), 'the Read matcher survives');
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
