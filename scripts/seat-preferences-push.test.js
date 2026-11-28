// scripts/seat-preferences-push.test.js - C10: a seat that can edit gets the user's code preferences at its start, with the
// read mark, so its first write passes. A read-only seat gets nothing new. Driven through stdin payloads in throwaway repos.
'use strict';
const test = require('node:test');
require('./hook-test-env').isolateHookSuite({ ownTmp: true });
const { verdictOf } = require('./hook-test-env');
delete process.env.CLAUDE_CODE_ENTRYPOINT;
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { realLong } = require('./test-paths.js');

const HOOK = path.join(__dirname, '..', 'stack', 'hooks', 'preferences-session.js');
const { seatGetsPush } = require(HOOK);
const PREFS = '.alfred/docs/preferences';
const PERSONAL = '# Personal code preferences\n\nUpdated: 2026-10-21\n\n## C1 - No static helper classes\n<!-- id: c1 -->\n- Rule: put behaviour on the type that owns the data, never in a static helper class.\n- Scope: every language\n';
const ARCHITECTURE = '# Architecture preferences\n\nUpdated: 2026-10-21\n\n## A1 - Handlers stay thin\n<!-- id: a1 -->\n- Rule: a handler validates, calls one service and maps the result.\n';
const PUSH_MARK = /put behaviour on the type that owns the data/;
const entry = (id, title, body) => `## ${id.toUpperCase()} - ${title}\n<!-- id: ${id} -->\n${body}\n`;

let counter = 0;
const sessionId = () => `seat-push-${process.pid}-${++counter}`;

function project(docs = { 'PERSONAL-CODE-PREFERENCES.md': PERSONAL, 'ARCHITECTURE-PREFERENCES.md': ARCHITECTURE })
{
    const root = realLong(fs.mkdtempSync(path.join(os.tmpdir(), 'seat-push-')));
    const config = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-push-config-'));
    const write = (rel, text) => { const file = path.join(root, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
    const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    git('init', '-q', '-b', 'develop');
    write('.gitignore', '.alfred/\n');
    write('src/app.ts', 'export const x = 1;\n');
    write('.claude/settings.json', JSON.stringify({ enabledPlugins: {} }));
    for (const [name, text] of Object.entries(docs)) write(path.join(PREFS, name), text);
    write(path.join(PREFS, 'watch.json'), '{}\n');
    const env = { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: config, ALFRED_CODE_HOOKS_OFF: 'preferences-session:tools,preferences-session:host' };
    const hook = (payload) => spawnSync(process.execPath, [HOOK], { cwd: root, input: JSON.stringify({ cwd: root, ...payload }), encoding: 'utf8', env });
    return { root, write, hook, rm: () => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(config, { recursive: true, force: true }); } };
}
const out = (result) => { try { return JSON.parse(result.stdout).hookSpecificOutput || {}; } catch { return {}; } };
const startOf = (session, agentType, extra = { agent_id: 'g1' }) => ({ hook_event_name: 'SubagentStart', session_id: session, agent_type: agentType, ...extra });
const pushText = (result) => String(out(result).additionalContext || '');
const editBy = (session, file, agent) => ({ hook_event_name: 'PreToolUse', session_id: session, tool_name: 'Edit', tool_input: { file_path: file, old_string: 'x', new_string: 'y' }, ...agent });
const isHeld = (result) => verdictOf(result) === 'ask';

test('a general-purpose seat gets the preferences text and the read mark, and its first write passes', () =>
{
    const p = project();
    try
    {
        const session = sessionId();
        const agent = { agent_id: 'g1', agent_type: 'general-purpose' };
        assert.match(pushText(p.hook(startOf(session, 'general-purpose'))), PUSH_MARK);
        assert.ok(!isHeld(p.hook(editBy(session, 'src/app.ts', agent))), 'the first write passes');
        assert.ok(fs.existsSync(path.join(p.root, `.alfred/state/sessions/preferences-${session}-g1.json`)), 'the mark file is written for the seat');
    }
    finally { p.rm(); }
});

test('a stack seat that grants Edit gets the push', () =>
{
    const p = project();
    try
    {
        const session = sessionId();
        assert.match(pushText(p.hook(startOf(session, 'alfred-code:aspnet-implementer'))), PUSH_MARK);
        p.write('.claude/agents/edit-seat.md', '---\nname: edit-seat\ntools: Read, Grep, Edit\n---\nbody\n');
        assert.match(pushText(p.hook(startOf(sessionId(), 'edit-seat'))), PUSH_MARK);
    }
    finally { p.rm(); }
});

test('a seat with tools: * or with no tools line gets the push', () =>
{
    const p = project();
    try
    {
        p.write('.claude/agents/star-seat.md', '---\nname: star-seat\ntools: "*"\n---\nbody\n');
        p.write('.claude/agents/bare-seat.md', '---\nname: bare-seat\ndescription: no tools line\n---\nbody\n');
        p.write('.claude/agents/star-plain-seat.md', '---\nname: star-plain-seat\ntools: *\n---\nbody\n');
        for (const type of ['star-seat', 'bare-seat', 'star-plain-seat']) assert.match(pushText(p.hook(startOf(sessionId(), type))), PUSH_MARK, type);
    }
    finally { p.rm(); }
});

test('an Explore seat and a stack seat with Read and Grep only get nothing new', () =>
{
    const p = project();
    try
    {
        p.write('.claude/agents/reader-seat.md', '---\nname: reader-seat\ntools: Read, Grep\n---\nbody\n');
        for (const type of ['Explore', 'Plan', 'claude-code-guide', 'statusline-setup', 'reader-seat']) assert.strictEqual(pushText(p.hook(startOf(sessionId(), type))), '', type);
    }
    finally { p.rm(); }
});

test('a preferences file over the shared room gets the pointer only, and the first write is held', () =>
{
    const long = (i) => entry(`c${i}`, `Entry ${i}`, `- Rule: rule number ${i} ${'stays put. '.repeat(70)}\n- Scope: every language`);
    const personal = `# Personal code preferences\n\nUpdated: 2026-10-22\n\n${Array.from({ length: 14 }, (_, i) => long(i + 1)).join('\n')}`;
    const p = project({ 'PERSONAL-CODE-PREFERENCES.md': personal, 'ARCHITECTURE-PREFERENCES.md': ARCHITECTURE });
    try
    {
        const session = sessionId();
        const text = pushText(p.hook(startOf(session, 'general-purpose')));
        assert.match(text, /Not pasted yet/, 'the pointer names what did not fit');
        assert.doesNotMatch(text, /rule number 14 /, 'the last entry is not pasted');
        assert.ok(isHeld(p.hook(editBy(session, 'src/app.ts', { agent_id: 'g1', agent_type: 'general-purpose' }))), 'the first write is held');
    }
    finally { p.rm(); }
});

test('a payload with no agent_id gets the text and no mark', () =>
{
    const p = project();
    try
    {
        const session = sessionId();
        assert.match(pushText(p.hook(startOf(session, 'general-purpose', {}))), PUSH_MARK);
        assert.ok(isHeld(p.hook(editBy(session, 'src/app.ts', {}))), 'the main session is still held: no mark was kept');
    }
    finally { p.rm(); }
});

test('the main session is unchanged: its first edit is still held and handed the docs', () =>
{
    const p = project();
    try
    {
        const held = p.hook(editBy(sessionId(), 'src/app.ts', {}));
        assert.ok(isHeld(held), held.stdout);
    }
    finally { p.rm(); }
});

test('seatGetsPush decides by seat kind and type', () =>
{
    const frontmatter = (tools) => ({ frontmatter: `---\nname: x\n${tools}---\n` });
    assert.strictEqual(seatGetsPush('other', 'general-purpose'), true);
    assert.strictEqual(seatGetsPush('other', 'some-plugin:custom'), true);
    for (const type of ['Explore', 'Plan', 'claude-code-guide', 'statusline-setup']) assert.strictEqual(seatGetsPush('other', type), false, type);
    assert.strictEqual(seatGetsPush(frontmatter('tools: Read, Grep\n'), 'x'), false);
    assert.strictEqual(seatGetsPush(frontmatter('tools: Read, Edit\n'), 'x'), true);
    assert.strictEqual(seatGetsPush(frontmatter('tools: Write\n'), 'x'), true);
    assert.strictEqual(seatGetsPush(frontmatter('tools: *\n'), 'x'), true);
    assert.strictEqual(seatGetsPush(frontmatter(''), 'x'), true);
    assert.strictEqual(seatGetsPush(frontmatter('tools: Read, Grep\n'), 'alfred-code:aspnet-verifier'), true, 'a judge, as today');
    assert.strictEqual(seatGetsPush(frontmatter('tools: Read\n'), 'architecture-analyzer'), true, 'the architecture seat, as today');
});
