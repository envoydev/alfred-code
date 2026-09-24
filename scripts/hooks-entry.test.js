'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseHookWirings, hooksBlock, hooksPlugin, coreEntry, HOOKS_PLUGIN } = require('./build-marketplace.js');

const wirings = parseHookWirings();
const block = hooksBlock(wirings);

test('the wirings come from the installer table, not a second list', () => {
    assert.ok(wirings.length >= 26, `expected the installer's whole HOOKS table, got ${wirings.length}`);
    const files = new Set(wirings.map(w => w.file));
    assert.strictEqual(files.size, 17, 'seventeen hooks, however many wirings they take');
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
test('the block is a valid plugin hooks object: node launcher, timeout 10 (60 for the one declared exception), plugin-root paths', () => {
    for (const [event, blocks] of Object.entries(block))
    {
        assert.ok(Array.isArray(blocks) && blocks.length, `${event} must hold at least one block`);
        for (const b of blocks)
            for (const h of b.hooks)
            {
                assert.strictEqual(h.type, 'command');
                // check-turn-build.js runs a real build at Stop - the one hook allowed past 10s.
                const expected = /check-turn-build\.js"/.test(h.command) ? 60 : 10;
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
        for (const entry of [hooksPlugin(), coreEntry()])
            for (const blocks of Object.values(entry.hooks))
                for (const b of blocks) for (const h of b.hooks) commands.add(h.command);
        assert.ok(commands.size >= 18, `expected the seventeen hooks plus the layer-table guard, got ${commands.size}`);
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
    for (const [event, blocks] of Object.entries(block))
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

test('the hooks plugin entry is the shared-root, inline shape spike S9 and Phase 2 proved', () => {
    assert.strictEqual(HOOKS_PLUGIN.name, 'alfred-code-hooks');
    assert.strictEqual(HOOKS_PLUGIN.source, './');
    assert.strictEqual(HOOKS_PLUGIN.strict, false);
    assert.ok(HOOKS_PLUGIN.hooks, 'the hooks are declared INLINE, so nothing sits at the shared root');
    assert.ok(!HOOKS_PLUGIN.skills && !HOOKS_PLUGIN.agents, 'it ships hooks only');
});
