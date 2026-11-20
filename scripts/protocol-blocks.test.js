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
const { normalize, fenceBlocks, buildTable, approves, withoutComments } = require('./protocol-blocks/blocks.js');
const { readBodies } = require('./protocol-blocks/effects.js');
require('./hook-test-env').isolateHookSuite();

const ROOT = path.join(__dirname, '..');
const TABLE = path.join(ROOT, 'setup-plugin', 'hooks', 'protocol-blocks.json');
const HOOK = path.join(ROOT, 'setup-plugin', 'hooks', 'approve-protocol-block.js');
const OPENER = 'RUN_ROOT=$(pwd)\nTMP=$(cat "$MARK" 2>/dev/null); if [ -z "$TMP" ]; then echo "MISSING the run marker - run the resolve block first"; exit 1; fi';
const FIXED = 'node "$TMP/repo/x.js" --root .';
const FILLED = 'node "$TMP/repo/x.js" --hooks <step 2\'s changed: hooks=N>';
const RESOLVE = 'TMP=$(mktemp -d)\nprintf \'%s\\n\' "$TMP" > "$MARK" || exit 1';
const BODY = ['# t', '', '```bash', RESOLVE, '```', '', '```bash', OPENER, '```', '', '```bash', FIXED, '```', '', '- a step', '', '  ```bash', '  ' + FILLED, '  ```', '',
    '```powershell', 'Write-Output $TMP', '```', ''].join('\n');

test('a fixed block, or the opener then a fixed block, is approved - a filled placeholder, an added line or another shell is not', () =>
{
    const table = buildTable([{ file: 'setup-plugin/references/t.md', text: BODY }]);
    assert.deepStrictEqual(table.openers, [normalize(OPENER)]);
    assert.strictEqual(table.blocks.length, 3, 'the resolve block, the opener and the fixed block; the placeholder block and the PowerShell block are left out');
    assert.ok(approves(RESOLVE, table) && approves(OPENER, table), 'the resolve block and the opener alone');
    assert.ok(!approves(FIXED, table), 'a fixed block alone: it sets no variable, so Claude Code would not ask, and the user keeps the prompt');
    assert.ok(approves(`${OPENER}\n${FIXED}  \r\n\n`, table), 'trailing spaces, a CRLF and a final newline do not count');
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

test('live run 4 (2026-11-20): a block with its trailing comments dropped is approved too - both spellings come from the shipped text', () =>
{
    const commentedOpener = OPENER.replace('RUN_ROOT=$(pwd)', 'RUN_ROOT=$(pwd)   # the project');
    const body = ['```bash', RESOLVE, '```', '```bash', commentedOpener, '```', '```bash', `${FIXED}   # one step`, '```',
        '```bash', 'echo "a # b"; node y.js   # done', '```'].join('\n');
    const table = buildTable([{ file: 't.md', text: body }]);
    assert.ok(approves(`${OPENER}\n${FIXED}`, table), 'the opener and the block, both without their comments');
    assert.ok(approves(`${commentedOpener}\n${FIXED}   # one step`, table), 'both as shipped');
    assert.ok(approves(OPENER, table), 'the opener alone, without its comment');
    assert.ok(approves(`${OPENER}\necho "a # b"; node y.js`, table), 'a # inside quotes stays');
    assert.ok(!approves(`${OPENER}\necho "a`, table), 'never a spelling cut at a quoted #');
    assert.strictEqual(withoutComments('echo "a # b" \'c # d\' x\\# y   # gone\nz # w'), 'echo "a # b" \'c # d\' x\\# y\nz');
    assert.strictEqual(withoutComments('cat <<EOF\n# kept\nEOF'), null, 'a heredoc gets no second spelling');
    assert.ok(!approves(`${OPENER}\n${FIXED}\ncat x.md`, table), 'a merged page read still prompts');
});

test('review BLOCKER: a lone carriage return or another control character is never read as a line break', () =>
{
    const table = buildTable([{ file: 'setup-plugin/references/t.md', text: BODY }]);
    // bash reads a lone \r as a plain character, so `a # x\rb` is ONE line whose `b` is a comment
    assert.ok(!approves(RESOLVE.replace('\n', '\r'), table), 'a lone CR that hides the next line in a comment');
    assert.ok(!approves(`${OPENER}\r${FIXED}`, table), 'a lone CR between the opener and the block');
    assert.ok(!approves(`${OPENER}\n${FIXED}\u0000`, table), 'a NUL');
    assert.ok(!approves(`${OPENER}\n${FIXED}\u001b[2K`, table), 'an escape sequence');
    assert.ok(approves(`${OPENER}\r\n${FIXED}`, table), 'a CRLF pair is a line end');
});

test('fence pairing reads an indented block and never reads a closer as an opener', () =>
{
    assert.deepStrictEqual(fenceBlocks(BODY).map((b) => b.lang), ['bash', 'bash', 'bash', 'bash', 'powershell']);
    assert.strictEqual(fenceBlocks(BODY)[3].body, FILLED, 'the list indent is taken off');
});

test('a table needs exactly one opener', () =>
{
    assert.throws(() => buildTable([{ file: 'a.md', text: '```bash\necho hi\n```\n' }]), /exactly one opener, found 0/);
    assert.throws(() => buildTable([{ file: 'a.md', text: ['```bash', OPENER, '```'].join('\n') }]), /exactly one resolve block, found 0/);
    const other = BODY.replace('exit 1; fi', 'exit 2; fi');
    assert.throws(() => buildTable([{ file: 'a.md', text: BODY }, { file: 'b.md', text: other }]), /exactly one opener, found 2/);
    assert.strictEqual(buildTable([{ file: 'a.md', text: BODY }, { file: 'b.md', text: BODY }]).blocks.length, 3, 'the same block twice is one entry');
    const commented = ['```bash', RESOLVE, '```', '```bash', OPENER, '```', '```bash', 'node x.js  # prints "<scope> <id>"', '```'].join('\n');
    assert.strictEqual(buildTable([{ file: 'c.md', text: commented }]).blocks.length, 4, 'a placeholder in a comment is not filled in');
});

test('the shipped table is current - run `npm run protocol-blocks` after a shell block in setup-plugin changes', () =>
{
    const built = buildTable(readBodies(ROOT));
    const onDisk = JSON.parse(fs.readFileSync(TABLE, 'utf8'));
    assert.deepStrictEqual({ openers: onDisk.openers, resolves: onDisk.resolves, blocks: onDisk.blocks }, built);
    assert.ok(built.blocks.length >= 20, `the scan finds the fixed blocks (${built.blocks.length}; 23 on 2026-11-20)`);
    const protocol = fs.readFileSync(path.join(ROOT, 'setup-plugin', 'references', 'source-protocol.md'), 'utf8');
    const resolve = fenceBlocks(protocol).find((b) => b.lang === 'bash').body;
    assert.ok(approves(resolve, built), 'the resolve block itself is approved');
    // every second spelling of a shipped block parses, and lost only comments: each removed piece starts with a #
    const bodies = readBodies(ROOT).flatMap(({ text }) => fenceBlocks(text)).filter((b) => b.lang === 'bash').map((b) => normalize(b.body));
    let checked = 0;
    for (const body of bodies)
    {
        const bare = withoutComments(body);
        if (!bare || bare === body) continue;
        checked++;
        const parsed = spawnSync('bash', ['-n'], { input: bare, encoding: 'utf8' });
        assert.strictEqual(parsed.status, 0, `bash -n on the comment-free spelling of:\n${body.slice(0, 200)}\n${parsed.stderr}`);
        const kept = bare.split('\n');
        let k = 0;
        for (const line of body.split('\n'))
        {
            if (k < kept.length && line.startsWith(kept[k]) && (line === kept[k] || /^\s+#/.test(line.slice(kept[k].length)))) { k++; continue; }
            assert.match(line, /^\s*#/, `only a comment line is dropped: ${line}`);
        }
        assert.strictEqual(k, kept.length, 'every kept line maps to a shipped one');
    }
    assert.ok(checked >= 2, `the shipped blocks with comments: the resolve block and the opener (${checked})`);
    assert.match(built.openers[0], /\[ ! -O "\$MARK" \]/, 'review MATERIAL: the opener trusts only a marker the user owns');
    assert.match(resolve, /if ! printf '%s\\n' "\$TMP" > "\$MARK"; then echo "MISSING/, 'review MATERIAL: a failed marker write stops the resolve');
    assert.match(resolve, /\[ -O "\$MARK" \] && \[ -n "\$OLD" \]/, 'review MATERIAL: the reuse path trusts only a marker the user owns');
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
    const typed = (text) => JSON.stringify({ type: 'user', entrypoint: 'cli', timestamp: '2026-11-20T10:00:00Z', message: { role: 'user', content: text } });
    const transcript = (name, rows) => { const file = path.join(cwd, name); fs.writeFileSync(file, `${rows.join('\n')}\n`); return file; };
    const walk = transcript('walk.jsonl', [typed('<command-message>alfred-code:update</command-message>\n<command-name>/alfred-code:update</command-name>')]);
    try
    {
        // side-agent note (2026-11-20): the resolve block updates plugins and may download a release, so it is approved
        // only inside a typed walk - outside one, Claude Code's own prompt stays
        for (const [label, file] of [['no transcript', undefined], ['no walk typed', transcript('none.jsonl', [typed('fix the parser')])],
            ['another command ended the walk', transcript('ended.jsonl', [typed('<command-name>/alfred-code:update</command-name>'), typed('<command-name>/task-solve</command-name>')])]])
        {
            const r = hook({ tool_name: 'Bash', cwd, transcript_path: file, tool_input: { command: resolve } });
            assert.deepStrictEqual([r.status, r.stdout], [0, ''], `outside a walk: ${label}`);
        }
        const allowed = hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd, transcript_path: walk, tool_input: { command: resolve } });
        assert.strictEqual(allowed.status, 0, allowed.stderr);
        const out = JSON.parse(allowed.stdout).hookSpecificOutput;
        assert.deepStrictEqual([out.hookEventName, out.permissionDecision], ['PreToolUse', 'allow']);
        assert.match(out.permissionDecisionReason, /shipped alfred-code protocol block, unchanged/);
        for (const [label, input] of [
            ['an added line', { tool_name: 'Bash', cwd, transcript_path: walk, tool_input: { command: `${resolve}\necho "MARK=$MARK"` } }],
            ['another tool', { tool_name: 'Read', cwd, tool_input: { command: resolve } }],
            ['no command', { tool_name: 'Bash', cwd, tool_input: {} }],
            ['garbage JSON', '{not json'],
            ['empty stdin', ''],
        ])
        {
            const r = hook(input);
            assert.deepStrictEqual([r.status, r.stdout], [0, ''], label);
        }
        const off = hook({ tool_name: 'Bash', cwd, transcript_path: walk, tool_input: { command: resolve } }, { ALFRED_CODE_HOOKS_OFF: 'approve-protocol-block' });
        assert.deepStrictEqual([off.status, off.stdout], [0, ''], 'switched off by name');
        const minimal = hook({ tool_name: 'Bash', cwd, transcript_path: walk, tool_input: { command: resolve } }, { CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'minimal' });
        assert.deepStrictEqual([minimal.status, minimal.stdout], [0, ''], 'the minimal hook profile stands it down, as source-protocol.md says');
        assert.match(protocol.replace(/\s+/g, ' '), /a page is read in a call of its own/);
        assert.match(protocol.replace(/\s+/g, ' '), /approves an unchanged block inside a typed `\/alfred-code:init`, `update`, `configure` or `validate`, unless the hook profile is `minimal`/);
    }
    finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});
