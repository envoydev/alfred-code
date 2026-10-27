// The project's own tree-walking tools skip the data root (scripts/install/tool-ignores.js, the user's ruling of
// 2026-10-14): Prettier reads no nested .gitignore, so `prettier --check .` walked .alfred/ and flagged 272 files.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ensureToolIgnores, removeToolIgnores, prettierUsed, MARK, END } = require('./install/tool-ignores.js');
const block = (eol = '\n', ...dirs) => [MARK, ...(dirs.length ? dirs : ['/.alfred/', '/.claude/']), END].join(eol) + eol;
const { readToolIgnores } = require('./install/stamp.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-ignores-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const project = (files = {}) =>
{
    const root = fs.mkdtempSync(path.join(TMP, 'p-'));
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, name), text);
    return root;
};
const rd = (root, name) => { try { return fs.readFileSync(path.join(root, name), 'utf8'); } catch { return null; } };
const run = (root, prior = {}, dataRoot = '.alfred') => { const said = []; const notes = []; const record = ensureToolIgnores({ projectRoot: root, root: dataRoot, prior, log: (l) => said.push(l), note: (l) => notes.push(l) }); return { record, said, notes }; };

test('a project on Prettier gets the data root and .claude/ in .prettierignore - made when absent, and a re-run changes nothing', () =>
{
    const root = project({ '.prettierrc': '{}\n' });
    const first = run(root);
    assert.strictEqual(rd(root, '.prettierignore'), block());
    assert.deepStrictEqual(first.record, { '.prettierignore': 'created' });
    assert.match(first.said.join('\n'), /tool ignores: \.prettierignore written \/\.alfred\/ \/\.claude\//);
    const again = run(root, first.record);
    assert.deepStrictEqual(again.record, first.record);
    assert.deepStrictEqual(again.said, [], 'idempotent');
    assert.strictEqual(rd(root, '.prettierignore'), block());
});

test('an existing ignore file gains the block after its own lines, in its own line endings, and gives them back on uninstall', () =>
{
    const own = '# mine\r\n/dist\r\n.claude\r\n';
    const root = project({ '.prettierignore': own, '.eslintignore': 'build/' });
    const { record } = run(root);
    assert.deepStrictEqual(record, { '.prettierignore': 'appended', '.eslintignore': 'appended' });
    assert.strictEqual(rd(root, '.prettierignore'), `${own}\r\n${block('\r\n', '/.alfred/')}`, 'the project keeps .claude out itself: the block names only the data root');
    assert.strictEqual(rd(root, '.eslintignore'), `build/\n\n${block()}`, 'a file with no last newline gets one first');
    assert.strictEqual(rd(root, '.stylelintignore'), null, 'a tool the project keeps no file for is left alone');
    removeToolIgnores({ projectRoot: root, record });
    assert.strictEqual(rd(root, '.prettierignore'), own, 'byte for byte');
    assert.strictEqual(rd(root, '.eslintignore'), 'build/\n');
});

test('what the project already says, or the user took out, stands', () =>
{
    for (const line of ['.alfred', '.alfred/', '/.alfred/', '.alfred/**'])
    {
        const root = project({ '.prettierignore': `dist\n${line}\n.claude\n` });
        const { record, said } = run(root);
        assert.deepStrictEqual(record, {}, `'${line}' and '.claude' already keep both out`);
        assert.deepStrictEqual(said, []);
        assert.strictEqual(rd(root, '.prettierignore'), `dist\n${line}\n.claude\n`);
    }
    // the project adds its own lines for both later: the stack's block leaves, nothing else changes
    const later = project({ '.prettierignore': 'dist\n' });
    const r0 = run(later);
    fs.writeFileSync(path.join(later, '.prettierignore'), `dist\n/.alfred\n.claude/\n\n${block()}`);
    const r1Later = run(later, r0.record);
    assert.strictEqual(rd(later, '.prettierignore'), 'dist\n/.alfred\n.claude/\n');
    assert.match(r1Later.said.join('\n'), /the stack's block left it/);
    // a line the user typed straight after the block is theirs, never part of it
    const typed = project({ '.prettierignore': 'dist\n' });
    const t0 = run(typed);
    fs.appendFileSync(path.join(typed, '.prettierignore'), '/generated/\n');
    assert.deepStrictEqual(run(typed, t0.record, 'data').said, ['  tool ignores: .prettierignore now names /data/ /.claude/']);
    assert.strictEqual(rd(typed, '.prettierignore'), `dist\n\n${block('\n', '/data/', '/.claude/')}/generated/\n`);
    removeToolIgnores({ projectRoot: typed, record: t0.record });
    assert.strictEqual(rd(typed, '.prettierignore'), 'dist\n/generated/\n');
    // the user removes the block: the record carries on and nothing is written again
    const root = project({ '.prettierignore': 'dist\n' });
    const { record } = run(root);
    fs.writeFileSync(path.join(root, '.prettierignore'), 'dist\n');
    const after = run(root, record);
    assert.deepStrictEqual(after.record, record);
    assert.strictEqual(rd(root, '.prettierignore'), 'dist\n');
    // the user deletes the file the stack made: not made again
    const made = project({ 'package.json': JSON.stringify({ devDependencies: { prettier: '^3' } }) });
    const r1 = run(made);
    assert.deepStrictEqual(r1.record, { '.prettierignore': 'created' });
    fs.rmSync(path.join(made, '.prettierignore'));
    assert.deepStrictEqual(run(made, r1.record).record, r1.record);
    assert.strictEqual(rd(made, '.prettierignore'), null);
});

test('a data move re-points the line; no Prettier, no file; a bad input never throws', () =>
{
    const root = project({ '.prettierrc.json': '{}' });
    const { record } = run(root);
    const moved = run(root, record, 'tools/alfred');
    assert.strictEqual(rd(root, '.prettierignore'), block('\n', '/tools/alfred/', '/.claude/'));
    assert.match(moved.said.join('\n'), /now names \/tools\/alfred\/ \/\.claude\//);
    assert.deepStrictEqual(run(project({ 'package.json': '{"name":"x"}' })).record, {}, 'no Prettier anywhere: nothing made');
    assert.strictEqual(prettierUsed(project({ 'package.json': 'garbage {{{' })), false);
    assert.strictEqual(prettierUsed(project({ 'package.json': JSON.stringify({ prettier: { semi: false } }) })), true, 'a package.json prettier key');
    const dir = project({ '.prettierrc': '{}' });
    fs.mkdirSync(path.join(dir, '.prettierignore'));
    const bad = run(dir);
    assert.deepStrictEqual(bad.record, {});
    assert.match(bad.notes.join('\n'), /\.prettierignore could not be read \(EISDIR\)/);
});

test('uninstall: a file the stack made goes when only its block is left, and stays when the user added to it', () =>
{
    const root = project({ '.prettierrc': '{}' });
    const { record } = run(root);
    removeToolIgnores({ projectRoot: root, record });
    assert.strictEqual(rd(root, '.prettierignore'), null);
    const kept = project({ '.prettierrc': '{}' });
    const r = run(kept);
    fs.appendFileSync(path.join(kept, '.prettierignore'), 'coverage\n');
    removeToolIgnores({ projectRoot: kept, record: r.record });
    assert.strictEqual(rd(kept, '.prettierignore'), 'coverage\n');
});

test('a child at local scope never appends the block to a tracked .eslintignore; a block appended earlier stays and is named once', () =>
{
    const root = project({ '.eslintignore': 'dist/\n' });
    const tracked = (file) => path.basename(file) === '.eslintignore';
    const said = [];
    const record = ensureToolIgnores({ projectRoot: root, root: '.alfred', prior: {}, skipTracked: true, tracked, log: (l) => said.push(l) });
    assert.strictEqual(rd(root, '.eslintignore'), 'dist/\n', 'a tracked file gained the block');
    assert.deepStrictEqual(record, {});
    assert.deepStrictEqual(said, ['  tool ignores: .eslintignore is tracked here - the block is not added, so teammates get no Alfred edit; add /.alfred/ and /.claude/ yourself if eslint walks them']);
    const earlier = project({ '.eslintignore': `dist/\n\n${block()}` });
    const before = rd(earlier, '.eslintignore');
    const again = [];
    const kept = ensureToolIgnores({ projectRoot: earlier, root: '.ws-data', prior: { '.eslintignore': 'appended' }, skipTracked: true, tracked, log: (l) => again.push(l) });
    assert.strictEqual(rd(earlier, '.eslintignore'), before, 'a block in a tracked file was rewritten');
    assert.deepStrictEqual(kept, { '.eslintignore': 'appended' });
    assert.deepStrictEqual(again, ['  tool ignores: .eslintignore is tracked here - the block an earlier run added is left as it is']);
    assert.deepStrictEqual(run(project({ '.eslintignore': 'dist/\n' })).record, { '.eslintignore': 'appended' }, 'without skipTracked the block still lands');
});

test('the stamp line reads back only the files the module knows, in the two shapes it writes', () =>
{
    const f = path.join(TMP, 'stamp');
    fs.writeFileSync(f, 'version: 2\ntool-ignores: .prettierignore=created,../etc/passwd=created,.eslintignore=bogus,.stylelintignore=appended\n');
    assert.deepStrictEqual(readToolIgnores(f), { '.prettierignore': 'created', '.stylelintignore': 'appended' });
    assert.deepStrictEqual(readToolIgnores(path.join(TMP, 'none')), {});
});
