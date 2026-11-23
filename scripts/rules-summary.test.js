'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { realLong } = require('./test-paths');

const LOADER = path.join(__dirname, '..', 'stack', 'hooks', 'rules-session.js');
const loader = () => require(LOADER);
const SESSION = 'sess-1';

// A throwaway home holding the workspace; the walk stops below it. The env has no stack variable in it.
function fixture()
{
    const home = realLong(fs.mkdtempSync(path.join(os.tmpdir(), 'rules-summary-')));
    return { home, env: { HOME: home, USERPROFILE: home }, done: () => fs.rmSync(home, { recursive: true, force: true }) };
}
// `always` rules with no frontmatter and `scoped` rules with a `paths:` list, under <folder>/.claude/rules.
function rules(folder, always, scoped)
{
    const dir = path.join(folder, '.claude', 'rules');
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < always; i++) fs.writeFileSync(path.join(dir, `always-${i}.md`), `# Always ${i}\n\nBe plain.\n`);
    for (let i = 0; i < scoped; i++) fs.writeFileSync(path.join(dir, `scoped-${i}.md`), `---\npaths:\n  - "**/*.cs"\n---\n\n# Scoped ${i}\n\nBe plain.\n`);
}
const LINE_HEAD = 'Native rules, full text in context - follow them: ';

test('summaryLine counts each level above and at the session folder', () =>
{
    const { home, env, done } = fixture();
    try
    {
        const root = path.join(home, 'ws-root');
        const child = path.join(root, 'api');
        rules(root, 8, 11);
        rules(child, 1, 0);
        assert.strictEqual(loader().summaryLine(child, SESSION, env), `${LINE_HEAD}ws-root (8 always-on, 11 by path) + api (1 always-on, 0 by path)`);
    }
    finally { done(); }
});

test('a touched child joins the line with its total', () =>
{
    const { home, env, done } = fixture();
    try
    {
        const root = path.join(home, 'ws-root');
        rules(root, 8, 11);
        rules(path.join(root, 'api'), 1, 0);
        fs.mkdirSync(path.join(root, 'api', 'src'), { recursive: true });
        assert.strictEqual(loader().summaryLine(root, SESSION, env), `${LINE_HEAD}ws-root (8 always-on, 11 by path)`, 'no touch yet');
        loader().noteTouch(root, SESSION, path.join(root, 'api', 'src', 'a.cs'), env);
        loader().noteTouch(root, SESSION, path.join(root, 'api', 'src', 'b.cs'), env);
        assert.deepStrictEqual(loader().touchedOf(root, SESSION, env), [path.join(root, 'api')]);
        assert.strictEqual(loader().summaryLine(root, SESSION, env), `${LINE_HEAD}ws-root (8 always-on, 11 by path) + api (1)`);
        assert.deepStrictEqual(loader().touchedOf(root, 'other-session', env), [], 'the record is per session');
    }
    finally { done(); }
});

test('a file of the project root or of a folder with no rules is no touch', () =>
{
    const { home, env, done } = fixture();
    try
    {
        const root = path.join(home, 'ws-root');
        rules(root, 1, 0);
        fs.mkdirSync(path.join(root, 'plain'), { recursive: true });
        loader().noteTouch(root, SESSION, path.join(root, 'top.cs'), env);
        loader().noteTouch(root, SESSION, path.join(root, 'plain', 'x.cs'), env);
        loader().noteTouch(root, SESSION, path.join(home, 'elsewhere', 'y.cs'), env);
        assert.deepStrictEqual(loader().touchedOf(root, SESSION, env), []);
    }
    finally { done(); }
});

test('a rule claudeMdExcludes keeps out is not counted', () =>
{
    const { home, env, done } = fixture();
    try
    {
        const root = path.join(home, 'ws-root');
        rules(root, 3, 2);
        fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({ claudeMdExcludes: ['**/.claude/rules/always-0.md'] }));
        fs.writeFileSync(path.join(root, '.claude', 'settings.local.json'), JSON.stringify({ claudeMdExcludes: ['**/.claude/rules/scoped-*.md'] }));
        assert.strictEqual(loader().summaryLine(root, SESSION, env), `${LINE_HEAD}ws-root (2 always-on, 0 by path)`);
        assert.deepStrictEqual(loader().levelsOf(root, env).map((l) => [l.name, l.always, l.scoped]), [['ws-root', 2, 0]]);
    }
    finally { done(); }
});

test('no rule anywhere gives no line', () =>
{
    const { home, env, done } = fixture();
    try
    {
        const root = path.join(home, 'ws-root');
        fs.mkdirSync(path.join(root, '.claude', 'rules'), { recursive: true });
        fs.writeFileSync(path.join(root, '.claude', 'rules', 'notes.txt'), 'not a rule');
        assert.strictEqual(loader().summaryLine(root, SESSION, env), '');
        assert.strictEqual(loader().summaryLine(path.join(home, 'missing'), SESSION, env), '');
    }
    finally { done(); }
});

test('a garbage settings file or a garbage touch record changes nothing', () =>
{
    const { home, env, done } = fixture();
    try
    {
        const root = path.join(home, 'ws-root');
        rules(root, 1, 1);
        fs.writeFileSync(path.join(root, '.claude', 'settings.json'), '{ not json');
        const state = path.join(root, '.alfred', 'state', 'sessions');
        fs.mkdirSync(state, { recursive: true });
        fs.writeFileSync(path.join(state, `rules-touched-${SESSION}.json`), 'garbage');
        assert.strictEqual(loader().summaryLine(root, SESSION, env), `${LINE_HEAD}ws-root (1 always-on, 1 by path)`);
    }
    finally { done(); }
});
