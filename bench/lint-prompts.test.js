'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkText, ourNames, eccNames, lintTasks } = require('./lint-prompts.js');

const NAMES = ['dotnet-minimal-api', 'project-solve-task', 'codebase-onboarding', 'tdd-workflow', 'plan', 'dotnet', 'init'];
const words = (text) => checkText(text, NAMES).map((f) => f.word);

test('a hyphenated name of either stack is flagged as a whole token, in any case', () =>
{
    assert.deepStrictEqual(words('Follow the Dotnet-Minimal-API conventions.'), ['Dotnet-Minimal-API']);
    assert.deepStrictEqual(words('Start with codebase-onboarding, then tdd-workflow.'), ['codebase-onboarding', 'tdd-workflow']);
    assert.deepStrictEqual(words('The project-solve-tasks table and a pre-tdd-workflow step stay.'), []);
});

test('a single-word name is flagged only as a slash command, never as a plain word', () =>
{
    assert.deepStrictEqual(words('Make a plan for the dotnet API before you init the database.'), []);
    assert.deepStrictEqual(words('Run /plan first, then /ecc:plan and /claude-stack:init.'), ['/plan', '/ecc:plan', '/claude-stack:init']);
    assert.deepStrictEqual(words('Add GET /api/loans/overdue and keep /health as it is.'), []);
});

test('the generic stack phrases are flagged', () =>
{
    const found = words('Use a skill or a subagent, add a hook, read CLAUDE.md and the architecture docs, or use the docs via an MCP plugin.');
    for (const w of ['skill', 'subagent', 'hook', 'CLAUDE.md', 'architecture docs', 'use the docs', 'MCP', 'plugin']) assert.ok(found.includes(w), `${w} not flagged in ${found}`);
    assert.deepStrictEqual(words('Add a webhook for overdue loans and a pre-commit check in CI.'), []);
});

test('our names are read from the tree, ECC\'s from the pinned list, and an absent list refuses', (t) =>
{
    const root = path.join(__dirname, '..');
    const ours = ourNames(root);
    for (const n of ['dotnet-minimal-api', 'project-solve-cross-task', 'integration-reviewer', 'init', 'claude-stack']) assert.ok(ours.includes(n), n);
    const ecc = eccNames(path.join(__dirname, 'arms', 'ecc-vocabulary.txt'));
    assert.ok(ecc.includes('codebase-onboarding') && ecc.includes('tdd-workflow') && !ecc.some((n) => n.startsWith('#')));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-lint-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    assert.throws(() => eccNames(path.join(dir, 'none.txt')), /no ECC vocabulary at .*none\.txt/);
});

test('lintTasks names the file and the word, over prompt.md only', (t) =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-lint-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    for (const [id, text] of [['a1', 'Add a paged loans endpoint.\n'], ['b2', 'Use the tdd-workflow here.\n']])
    {
        fs.mkdirSync(path.join(dir, id, 'hidden'), { recursive: true });
        fs.writeFileSync(path.join(dir, id, 'prompt.md'), text);
        fs.writeFileSync(path.join(dir, id, 'hidden', 'notes.md'), 'a skill named here is fine: tests never reach a session\n');
    }
    const found = lintTasks({ tasksDir: dir, names: NAMES });
    assert.deepStrictEqual(found.map((f) => [f.file, f.word]), [[path.join('b2', 'prompt.md'), 'tdd-workflow']]);
});

test('every real task prompt is clean', () =>
{
    const tasksDir = path.join(__dirname, 'tasks');
    if (!fs.existsSync(tasksDir)) return;
    const found = lintTasks({ tasksDir });
    assert.deepStrictEqual(found.map((f) => `${f.file}: ${f.word} (${f.why})`), []);
});
