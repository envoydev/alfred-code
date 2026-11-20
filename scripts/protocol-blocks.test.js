'use strict';
// The protocol-block approval (2026-11-20): Claude Code 2.1.329 asks before a command that sets a shell variable and
// uses it, even when an allow rule matches; a PreToolUse hook's `allow` skips that ask (probe, 2026-11-20). The hook
// allows a Bash call only when its text is a shipped fixed block, or the shared opener followed by one.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { normalize, fenceBlocks, buildTable, approves } = require('./protocol-blocks/blocks.js');
const { readBodies } = require('./protocol-blocks/effects.js');

const ROOT = path.join(__dirname, '..');
const TABLE = path.join(ROOT, 'setup-plugin', 'hooks', 'protocol-blocks.json');
const HOOK = path.join(ROOT, 'setup-plugin', 'hooks', 'approve-protocol-block.js');
const OPENER = 'RUN_ROOT=$(pwd)\nTMP=$(cat "$MARK" 2>/dev/null); if [ -z "$TMP" ]; then echo "MISSING the run marker - run the resolve block first"; exit 1; fi';
const FIXED = 'node "$TMP/repo/x.js" --root .';
const FILLED = 'node "$TMP/repo/x.js" --hooks <step 2\'s changed: hooks=N>';
const BODY = ['# t', '', '```bash', OPENER, '```', '', '```bash', FIXED, '```', '', '- a step', '', '  ```bash', '  ' + FILLED, '  ```', '',
    '```powershell', 'Write-Output $TMP', '```', ''].join('\n');

test('a fixed block, or the opener then a fixed block, is approved - a filled placeholder, an added line or another shell is not', () =>
{
    const table = buildTable([{ file: 'setup-plugin/references/t.md', text: BODY }]);
    assert.strictEqual(table.opener, normalize(OPENER));
    assert.strictEqual(table.blocks.length, 2, 'the opener and the fixed block; the placeholder block and the PowerShell block are left out');
    assert.ok(approves(FIXED, table), 'the fixed block as written');
    assert.ok(approves(`${FIXED}  \r\n\n`, table), 'trailing spaces, a CRLF and a final newline do not count');
    assert.ok(approves(`${OPENER}\n${FIXED}`, table), 'the opener, then the block');
    assert.ok(approves(`${OPENER}\n\n${FIXED}\n`, table), 'a blank line between them');
    assert.ok(!approves(`${FIXED}\necho "MARK=$MARK"`, table), 'a line the model added');
    assert.ok(!approves(`${OPENER}\n${FIXED}\ncat x.md`, table), 'a second call merged in');
    assert.ok(!approves(FILLED.replace(/<[^>]+>/, '3'), table), 'a block whose placeholder was filled');
    assert.ok(!approves(`${OPENER}\nrm -rf /`, table), 'the opener then anything else');
    assert.ok(!approves(`${OPENER}${FIXED}`, table), 'the opener glued to the block with no line break');
    assert.ok(!approves('Write-Output $TMP', table), 'a PowerShell block');
    assert.ok(!approves('', table) && !approves(undefined, table), 'no command');
});

test('fence pairing reads an indented block and never reads a closer as an opener', () =>
{
    assert.deepStrictEqual(fenceBlocks(BODY).map((b) => b.lang), ['bash', 'bash', 'bash', 'powershell']);
    assert.strictEqual(fenceBlocks(BODY)[2].body, FILLED, 'the list indent is taken off');
});

test('a table needs exactly one opener', () =>
{
    assert.throws(() => buildTable([{ file: 'a.md', text: '```bash\necho hi\n```\n' }]), /exactly one opener, found 0/);
    const other = BODY.replace('exit 1; fi', 'exit 2; fi');
    assert.throws(() => buildTable([{ file: 'a.md', text: BODY }, { file: 'b.md', text: other }]), /exactly one opener, found 2/);
    assert.strictEqual(buildTable([{ file: 'a.md', text: BODY }, { file: 'b.md', text: BODY }]).blocks.length, 2, 'the same block twice is one entry');
    const commented = ['```bash', OPENER, '```', '```bash', 'node x.js  # prints "<scope> <id>"', '```'].join('\n');
    assert.strictEqual(buildTable([{ file: 'c.md', text: commented }]).blocks.length, 2, 'a placeholder in a comment is not filled in');
});

test('the shipped table is current - run `npm run protocol-blocks` after a shell block in setup-plugin changes', () =>
{
    const built = buildTable(readBodies(ROOT));
    const onDisk = JSON.parse(fs.readFileSync(TABLE, 'utf8'));
    assert.deepStrictEqual({ opener: onDisk.opener, blocks: onDisk.blocks }, built);
    assert.ok(built.blocks.length >= 20, `the scan finds the fixed blocks (${built.blocks.length}; 23 on 2026-11-20)`);
    const protocol = fs.readFileSync(path.join(ROOT, 'setup-plugin', 'references', 'source-protocol.md'), 'utf8');
    const resolve = fenceBlocks(protocol).find((b) => b.lang === 'bash').body;
    assert.ok(approves(resolve, built), 'the resolve block itself is approved');
});

const hook = (input, env = {}) => spawnSync(process.execPath, [HOOK], {
    input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8',
    env: { ...process.env, ALFRED_CODE_HOOKS_OFF: '', CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: '', ...env },
});

test('the hook allows a shipped block and is silent on everything else, a bad payload and a switched-off hook included', () =>
{
    const table = JSON.parse(fs.readFileSync(TABLE, 'utf8'));
    const protocol = fs.readFileSync(path.join(ROOT, 'setup-plugin', 'references', 'source-protocol.md'), 'utf8');
    const resolve = fenceBlocks(protocol).find((b) => b.lang === 'bash').body;
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'apb-'));
    try
    {
        const allowed = hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd, tool_input: { command: resolve } });
        assert.strictEqual(allowed.status, 0, allowed.stderr);
        const out = JSON.parse(allowed.stdout).hookSpecificOutput;
        assert.deepStrictEqual([out.hookEventName, out.permissionDecision], ['PreToolUse', 'allow']);
        assert.match(out.permissionDecisionReason, /shipped alfred-code protocol block, unchanged/);
        assert.ok(table.blocks.length > 0);
        for (const [label, input] of [
            ['an added line', { tool_name: 'Bash', cwd, tool_input: { command: `${resolve}\necho "MARK=$MARK"` } }],
            ['another tool', { tool_name: 'Read', cwd, tool_input: { command: resolve } }],
            ['no command', { tool_name: 'Bash', cwd, tool_input: {} }],
            ['garbage JSON', '{not json'],
            ['empty stdin', ''],
        ])
        {
            const r = hook(input);
            assert.deepStrictEqual([r.status, r.stdout], [0, ''], label);
        }
        const off = hook({ tool_name: 'Bash', cwd, tool_input: { command: resolve } }, { ALFRED_CODE_HOOKS_OFF: 'approve-protocol-block' });
        assert.deepStrictEqual([off.status, off.stdout], [0, ''], 'switched off by name');
    }
    finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});
