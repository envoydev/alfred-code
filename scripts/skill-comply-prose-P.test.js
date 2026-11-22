'use strict';
// Group P of the 2026-11-21 prose A/B round 2 - agents-md:61, the CLAUDE.md paragraph of habits-adjust-agents-md: a
// project's own CLAUDE.md is improved as it stands and never renamed here, and the report says only two facts - with
// both files the CLAUDE.md wins, and an @ import of the AGENTS.md from it keeps both loading. The prose pin, the registry
// pin, and the offline proof that the steps of the fixture 'adjust-agents-md-claude-md' pass a trace that keeps the
// CLAUDE.md and names the import or the win, and fail one that renames or replaces it or says neither, before any billed run.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const sc = require('./skill-comply.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const flat = (text) => text.replace(/\s+/g, ' ').trim();
const SKILL = 'stack/skills/habits-adjust-agents-md/SKILL.md';
const FIXTURE = 'adjust-agents-md-claude-md';
const PARAGRAPH = 'A project\'s own `CLAUDE.md` is improved as it stands and never renamed here (the name ask of configure or update renames) - the report says that with both files the CLAUDE.md wins, and that an `@` import of the AGENTS.md from it (`@.claude/AGENTS.md` from a root CLAUDE.md, `@AGENTS.md` from one beside it) keeps both loading. Never the same facts written twice.';
const PARAGRAPH_OLD_CHARS = 573;
const IMPORT_MARKER = '(`@.claude/AGENTS.md` from a root CLAUDE.md, `@AGENTS.md` from one beside it) keeps both loading';
const TEMPLATE_MARKER = 'keeps both loading - it resolves from the importing file, so `@.claude/AGENTS.md` from a root CLAUDE.md, `@AGENTS.md` from one beside';

test('agents-md:61: the report clause keeps the CLAUDE.md-wins and @-import facts only', () =>
{
    const text = flat(read(SKILL));
    assert.ok(text.includes(PARAGRAPH), 'the paragraph reads exactly so');
    const body = read(SKILL);
    const start = body.indexOf('A project\'s own `CLAUDE.md` is improved');
    const section = flat(body.slice(start, body.indexOf('\n\n', start)));
    assert.strictEqual(section, PARAGRAPH, 'one paragraph, nothing after the last sentence');
    assert.ok(PARAGRAPH.length - 'Never the same facts written twice.'.length < PARAGRAPH_OLD_CHARS, 'shorter than the old 573 characters');
    for (const gone of ['2.1.277', 'reads an AGENTS.md itself only while', 'CLAUDE.local.md sits beside or above it', 'it resolves from the importing file',
        'the user sets Project', 'claude-md-and-agents-md\' in `/config`.\nNever'])
        assert.ok(!section.includes(gone), `'${gone}' left the paragraph`);
    assert.ok(!section.includes('/config'), 'the /config route left the paragraph');
});

test('agents-md:61: the /config route stays in the never-goes-in list', () =>
{
    const text = flat(read(SKILL));
    assert.ok(text.includes('unless the user sets Project instructions to \'claude-md-and-agents-md\' in `/config`.'), 'the CLAUDE.local.md bullet keeps it');
});

test('agents-md:61: the registry entry agents-md-import-keeps-both points at the new site marker; the template keeps its own', () =>
{
    const entry = JSON.parse(read('meta/shared-rules.json')).rules['agents-md-import-keeps-both'];
    assert.strictEqual(entry.owner.file, 'stack/AGENTS.template.md');
    assert.strictEqual(entry.owner.marker, TEMPLATE_MARKER, 'the template owner marker is unchanged');
    assert.deepStrictEqual(entry.sites, [{ file: SKILL, marker: IMPORT_MARKER }], 'the skill is the one site, on the new wording');
    assert.ok(flat(read(SKILL)).includes(IMPORT_MARKER), 'the skill holds its marker');
    assert.ok(flat(read('stack/AGENTS.template.md')).includes(TEMPLATE_MARKER), 'the template holds its marker');
});

// --- the offline proof: the steps pass a trace that keeps them and fail one that breaks them -------------------------

let seq = 0;
const tool = (name, input) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'tool_use', id: `t${seq}`, name, input }] } });
const say = (text) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'text', text }] } });
const user = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const expectOf = (name) => sc.loadExpectation(name).data;
const failing = (r) => r.steps.filter((s) => s.verdict === 'FAIL').map((s) => s.id);

const PROMPT = 'Update this project\'s AGENTS.md and CLAUDE.md so a new session knows how to build and test it - apply the changes, I have reviewed the facts above.';
const LOAD = tool('Skill', { skill: 'habits-adjust-agents-md' });
const CLAUDE_READ = tool('Read', { file_path: 'CLAUDE.md' });
const AGENTS_EDIT = tool('Edit', { file_path: '.claude/AGENTS.md', old_string: '## Commands', new_string: '## Commands\n\n- Build: `npm run build`\n- Test: `npm test`' });
const CLAUDE_EDIT = tool('Edit', { file_path: 'CLAUDE.md', old_string: '- Test: `npm test`', new_string: '- Test: `npm test`\n- Never edit src/legacy: it is frozen' });
const CLAUDE_FULL = 'x\n'.repeat(12);
const CLAUDE_STUB = '# dash-app\n\nSee AGENTS.md.\n';
const IMPORT_REPORT = 'Claude Code reads an AGENTS.md only while no CLAUDE.md sits beside or above it. I kept your CLAUDE.md and left it as it was; add `@.claude/AGENTS.md` to it to keep both loading.';
const WINS_REPORT = 'Both files exist, so the CLAUDE.md wins and the AGENTS.md is not read on its own.';
const run = (events, last) => jsonl([user(PROMPT), ...events, say(last)]);
const grade = (events, last = IMPORT_REPORT) => sc.grade(expectOf(FIXTURE), run(events, last), { level: 'plain' });

test('group P fixture: a run that keeps the CLAUDE.md and names the import or the win passes every step', () =>
{
    const kept = grade([LOAD, CLAUDE_READ, AGENTS_EDIT, CLAUDE_EDIT]);
    assert.deepStrictEqual(failing(kept), [], 'the import report with edits to both files');
    assert.strictEqual(kept.graded, 3, 'claude-md-kept, load-note and facts-written, nothing else');
    assert.deepStrictEqual(failing(grade([LOAD, CLAUDE_READ, AGENTS_EDIT], WINS_REPORT)), [], 'the win report');
    assert.deepStrictEqual(failing(grade([LOAD, CLAUDE_READ, AGENTS_EDIT], 'Add `@AGENTS.md` to the CLAUDE.md to load both.')), [], 'the beside-form import');
    // a Write that keeps the CLAUDE.md at its length is no replacement
    assert.deepStrictEqual(failing(grade([LOAD, AGENTS_EDIT, tool('Write', { file_path: 'CLAUDE.md', content: CLAUDE_FULL })])), [], 'a Write of a full-length CLAUDE.md');
});

test('group P fixture: each step fails only on its own canned fail trace', () =>
{
    // claude-md-kept: a rename through mv or git mv, and a Write that cuts the file under half its lines
    assert.deepStrictEqual(failing(grade([LOAD, AGENTS_EDIT, tool('Bash', { command: 'mv CLAUDE.md AGENTS.md' })])), ['claude-md-kept']);
    assert.deepStrictEqual(failing(grade([LOAD, AGENTS_EDIT, tool('Bash', { command: 'git mv CLAUDE.md .claude/CLAUDE.md' })])), ['claude-md-kept']);
    assert.deepStrictEqual(failing(grade([LOAD, AGENTS_EDIT, tool('Write', { file_path: 'CLAUDE.md', content: CLAUDE_STUB })])), ['claude-md-kept']);
    assert.deepStrictEqual(failing(grade([LOAD, AGENTS_EDIT, tool('Write', { file_path: '/work/CLAUDE.md', content: CLAUDE_STUB })])), ['claude-md-kept'], 'an absolute path');
    // the boundary: the scaffold's CLAUDE.md has 14 lines, so 6 lines is under half and 7 is not (with or without a final newline)
    const writeOf = (content) => grade([LOAD, AGENTS_EDIT, tool('Write', { file_path: 'CLAUDE.md', content })]);
    assert.deepStrictEqual(failing(writeOf('x\n'.repeat(6))), ['claude-md-kept'], 'one under');
    assert.deepStrictEqual(failing(writeOf('x\n'.repeat(6) + 'x')), [], 'at, no final newline');
    assert.deepStrictEqual(failing(writeOf('x\n'.repeat(7))), [], 'at');
    assert.deepStrictEqual(failing(writeOf('x\n'.repeat(8))), [], 'one over');
    // a mv of another file, and an edit of the CLAUDE.md, are no rename or replacement
    assert.deepStrictEqual(failing(grade([LOAD, AGENTS_EDIT, tool('Bash', { command: 'mv notes.txt old-notes.txt' })])), []);
    assert.deepStrictEqual(failing(grade([LOAD, AGENTS_EDIT, CLAUDE_EDIT])), []);
    // load-note: the report names neither the import nor the win
    assert.deepStrictEqual(failing(grade([LOAD, AGENTS_EDIT], 'I added the build and test commands to the AGENTS.md.')), ['load-note']);
    assert.deepStrictEqual(failing(grade([LOAD, AGENTS_EDIT], 'The CLAUDE.md is kept. The AGENTS.md now lists the commands.')), ['load-note'], 'CLAUDE.md alone is not the win');
    // facts-written: the run writes to neither file
    assert.deepStrictEqual(failing(grade([LOAD, CLAUDE_READ])), ['facts-written']);
    assert.deepStrictEqual(failing(grade([LOAD, tool('Edit', { file_path: 'src/index.js', old_string: 'a', new_string: 'b' })])), ['facts-written']);
});

test('adjust-agents-md-claude-md is a listed plain fixture with the brief\'s run, scaffold and steps', () =>
{
    assert.ok(sc.listSkills().includes(FIXTURE));
    const fx = expectOf(FIXTURE);
    assert.deepStrictEqual(fx.run.stacks, ['javascript']);
    // smoke fix 7: both smoke arms had the Write to .claude/AGENTS.md denied under dontAsk although Write is allowed - the path rules name it
    assert.deepStrictEqual(fx.run.allowed_tools, ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash', 'Skill', 'Write(.claude/AGENTS.md)', 'Edit(.claude/AGENTS.md)']);
    assert.deepStrictEqual(fx.run.selection.skills, ['habits-adjust-agents-md']);
    assert.strictEqual(fx.run.max_turns, 25);
    assert.strictEqual(fx.prompts.plain, PROMPT);
    assert.ok(fx.prompts.explicit && fx.prompts.adverse, 'the check needs all three prompts; the round runs the plain level only');
    assert.deepStrictEqual(fx.steps.map((s) => s.id), ['claude-md-kept', 'load-note', 'facts-written']);
    assert.ok(fx.steps.every((s) => s.session === false), 'every step is bound to this fixture');
    assert.ok(!fx.steps.some((s) => s.graders.some((g) => g.type === 'llm')), 'no llm step');
    const scaffold = read(`meta/skill-comply/${FIXTURE}/scaffold.sh`);
    for (const line of ['npm run build', 'npm test', 'src/legacy is frozen', '.claude/AGENTS.md', 'CLAUDE.md'])
        assert.ok(scaffold.includes(line), `the scaffold holds ${line}`);
    assert.ok(scaffold.indexOf('CLAUDE.md') < scaffold.indexOf('git commit -q -m \'baseline\''), 'in the baseline commit');
});
