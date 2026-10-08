'use strict';
// THE COPY LAYER OF THE NODE SEED - Phase 7, T2.
//
// What a run still copies into a project after Phases 3, 5 and 6 moved the rest to plugins: the
// rules, the agents and skills NO plugin carries (the extras), and the two hook ENGINES plus the
// model-window table. Everything else arrives through the project's plugin closure.
//
// The rules under test are the shell's `_install_from_src`, unchanged:
//   1. identical content is NOT rewritten - an update that rewrites every file makes every file
//      look changed to git, and a project that keeps its docs in git would see a diff per release;
//   2. but an identical file that LOST its exec bit gets it back - a re-clone or a checkout that
//      dropped the mode would otherwise leave a hook that cannot run;
//   3. a missing source file is reported and SKIPPED, never fatal - one bad file must not take the
//      other 116 down, and the existing copy stays;
//   4. a destination directory is created on the way;
//   5. `__DOCS_ROOT__` in the copied docs-root rule is stamped with the CURRENT value, on install
//      AND update, so the rule always tracks the env rather than the value it shipped with.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { installFromSource, stampDocsRoot } = require('./install/copy.js');
const copy = require('./install/copy.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'install-copy-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let seq = 0;
function fixture(files = {})
{
    const base = path.join(TMP, `case-${seq++}`);
    const src = path.join(base, 'src');
    const dest = path.join(base, 'dest');
    fs.mkdirSync(src, { recursive: true });
    for (const [name, body] of Object.entries(files))
    {
        const full = path.join(src, name);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, body);
    }
    return { base, src, dest };
}

function run(src, dest, files, opts = {})
{
    const logs = [];
    const notes = [];
    const result = installFromSource({
        sourceDir: src, subdir: '', label: opts.label || 'rule', destDir: dest, files,
        exec: opts.exec === true,
        log: (m) => logs.push(m), note: (m) => notes.push(m),
    });
    return { logs, notes, result };
}

test('install-copy: a file is copied, and its destination directory is made on the way', () =>
{
    const { src, dest } = fixture({ 'alfred-interaction.md': 'one\n' });
    const { logs, notes } = run(src, dest, ['alfred-interaction.md']);
    assert.strictEqual(fs.readFileSync(path.join(dest, 'alfred-interaction.md'), 'utf8'), 'one\n');
    assert.deepStrictEqual(notes, []);
    assert.ok(logs.some((m) => /rule installed -> alfred-interaction\.md/.test(m)), logs.join(' | '));
});

test('install-copy: identical content is NOT rewritten - an update leaves the mtime alone', () =>
{
    const { src, dest } = fixture({ 'a.md': 'same\n' });
    run(src, dest, ['a.md']);
    const before = fs.statSync(path.join(dest, 'a.md')).mtimeMs;
    const { logs } = run(src, dest, ['a.md']);
    assert.strictEqual(fs.statSync(path.join(dest, 'a.md')).mtimeMs, before,
        'an unchanged file was rewritten - every release would show a diff in a project that commits its docs');
    assert.ok(logs.some((m) => /rule current: a\.md/.test(m)), logs.join(' | '));
});

test('install-copy: changed content IS rewritten', () =>
{
    const { src, dest } = fixture({ 'a.md': 'v1\n' });
    run(src, dest, ['a.md']);
    fs.writeFileSync(path.join(src, 'a.md'), 'v2\n');
    run(src, dest, ['a.md']);
    assert.strictEqual(fs.readFileSync(path.join(dest, 'a.md'), 'utf8'), 'v2\n');
});

test('install-copy: an identical file that LOST its exec bit gets it back', { skip: process.platform === 'win32' && 'no mode bits on Windows' }, () =>
{
    const { src, dest } = fixture({ 'guard.js': '#!/usr/bin/env node\n' });
    run(src, dest, ['guard.js'], { exec: true, label: 'hook' });
    const target = path.join(dest, 'guard.js');
    assert.ok(fs.statSync(target).mode & 0o111, 'the first copy was not made executable');
    fs.chmodSync(target, 0o644);                       // what a re-clone or a mode-dropping checkout does
    run(src, dest, ['guard.js'], { exec: true, label: 'hook' });
    assert.ok(fs.statSync(target).mode & 0o111,
        'the content matched so the copy was skipped, and the hook was left unable to run');
});

test('install-copy: a missing source file is reported and skipped - the other files still land', () =>
{
    const { src, dest } = fixture({ 'a.md': 'a\n', 'c.md': 'c\n' });
    const { notes } = run(src, dest, ['a.md', 'b-missing.md', 'c.md']);
    assert.ok(fs.existsSync(path.join(dest, 'a.md')), 'the file before the missing one was lost');
    assert.ok(fs.existsSync(path.join(dest, 'c.md')), 'one missing file took the rest of the run down');
    assert.strictEqual(notes.length, 1, `expected one note, got: ${notes.join(' | ')}`);
    assert.match(notes[0], /b-missing\.md/);
});

test('install-copy: a missing source file never removes the copy that is already there', () =>
{
    const { src, dest } = fixture({ 'a.md': 'a\n' });
    run(src, dest, ['a.md']);
    fs.rmSync(path.join(src, 'a.md'));
    const { notes } = run(src, dest, ['a.md']);
    assert.strictEqual(fs.readFileSync(path.join(dest, 'a.md'), 'utf8'), 'a\n',
        'a source that could not be read deleted the working copy');
    assert.strictEqual(notes.length, 1);
});

test('install-copy: a nested path keeps its shape under the destination', () =>
{
    const { src, dest } = fixture({ 'refs/deep/note.md': 'deep\n' });
    run(src, dest, ['refs/deep/note.md']);
    assert.ok(fs.existsSync(path.join(dest, 'refs', 'deep', 'note.md')));
});

// ------------------------------------------------------------------ the docs-root stamp

const rule = (body) => `---\npaths: []\n---\n\n${body}\n`;

test('install-copy: __DOCS_ROOT__ is stamped with the value in settings.json', () =>
{
    const { base } = fixture();
    const rulesDir = path.join(base, '.claude', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    const file = path.join(rulesDir, 'alfred-docs-root.md');
    fs.writeFileSync(file, rule('Docs live under `__DOCS_ROOT__/architecture`.'));
    fs.writeFileSync(path.join(base, '.claude', 'settings.json'),
        JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: 'docs/agent' } }));

    stampDocsRoot(base, { log: () => {}, note: () => {} });
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!text.includes('__DOCS_ROOT__'), 'the placeholder survived the stamp');
    assert.ok(text.includes('docs/agent/architecture'), text);
});

test('install-copy: with no setting, the stamp writes the DEFAULT rather than leaving a placeholder', () =>
{
    const { base } = fixture();
    const rulesDir = path.join(base, '.claude', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    const file = path.join(rulesDir, 'alfred-docs-root.md');
    fs.writeFileSync(file, rule('Docs live under `__DOCS_ROOT__`.'));

    stampDocsRoot(base, { log: () => {}, note: () => {} });
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!text.includes('__DOCS_ROOT__'), 'a project with no env keeps an unresolved placeholder');
    assert.ok(text.includes('.alfred/docs'), text);
});

test('install-copy: COPY THEN STAMP is what makes the rule track a changed env', () =>
{
    // The stamp replaces the placeholder in place, so on its own it can only ever run once. What
    // makes an update re-stamp is the copy that runs first: the destination now reads 'docs/first'
    // while the source still reads '__DOCS_ROOT__', so the contents differ, the pristine rule is
    // copied back, and the stamp writes the CURRENT value over a fresh placeholder. The two halves
    // are one behaviour and this is the test that says so.
    const { base, src } = fixture({ 'alfred-docs-root.md': rule('Docs live under `__DOCS_ROOT__/architecture`.') });
    const rulesDir = path.join(base, '.claude', 'rules');
    const settings = path.join(base, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settings), { recursive: true });

    const cycle = (value) =>
    {
        fs.writeFileSync(settings, JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: value } }));
        run(src, rulesDir, ['alfred-docs-root.md']);
        stampDocsRoot(base, { log: () => {}, note: () => {} });
        return fs.readFileSync(path.join(rulesDir, 'alfred-docs-root.md'), 'utf8');
    };

    assert.ok(cycle('docs/first').includes('docs/first/architecture'));
    const second = cycle('docs/second');
    assert.ok(second.includes('docs/second/architecture'), `the re-stamp did not take: ${second}`);
    assert.ok(!second.includes('docs/first'), 'the old value is still in the rule');
});

test('install-copy: the stamp alone is once-only - the placeholder is gone after it runs', () =>
{
    const { base } = fixture();
    const rulesDir = path.join(base, '.claude', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    const file = path.join(rulesDir, 'alfred-docs-root.md');
    fs.writeFileSync(file, rule('Docs live under `__DOCS_ROOT__`.'));
    fs.writeFileSync(path.join(base, '.claude', 'settings.json'),
        JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: 'docs/one' } }));
    stampDocsRoot(base, { log: () => {}, note: () => {} });
    fs.writeFileSync(path.join(base, '.claude', 'settings.json'),
        JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: 'docs/two' } }));
    stampDocsRoot(base, { log: () => {}, note: () => {} });
    assert.ok(fs.readFileSync(file, 'utf8').includes('docs/one'),
        'the stamp rewrote an already-stamped value - it must only ever replace the placeholder');
});

test('install-copy: a malformed settings.json is not a failure - the default answers', () =>
{
    const { base } = fixture();
    const rulesDir = path.join(base, '.claude', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    const file = path.join(rulesDir, 'alfred-docs-root.md');
    fs.writeFileSync(file, rule('Docs live under `__DOCS_ROOT__`.'));
    fs.writeFileSync(path.join(base, '.claude', 'settings.json'), '{ not json');

    const notes = [];
    stampDocsRoot(base, { log: () => {}, note: (m) => notes.push(m) });
    assert.ok(fs.readFileSync(file, 'utf8').includes('.alfred/docs'));
    assert.deepStrictEqual(notes, [], 'a garbage settings file was treated as a failure');
});

test('install-copy: an absent rule file is a no-op, not an error', () =>
{
    const { base } = fixture();
    const notes = [];
    assert.doesNotThrow(() => stampDocsRoot(base, { log: () => {}, note: (m) => notes.push(m) }));
    assert.deepStrictEqual(notes, []);
});

// Phase 8 T4: a --drop removes the COPY of what it names, or the next --installed-only read-back
// finds the file on disk and puts the item straight back. Only a name the stack ships, and never an
// engine - the two engines are no hook line and must survive every drop.
test('removeDropped: deletes the copied skill, agent, rule and hook a --drop names, nothing else', () =>
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drop-'));
    try
    {
        const dirs = { skill: path.join(root, 'skills'), agent: path.join(root, 'agents'), rule: path.join(root, 'rules'), hook: path.join(root, 'hooks') };
        for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
        fs.mkdirSync(path.join(dirs.skill, 'csharp')); fs.writeFileSync(path.join(dirs.skill, 'csharp', 'SKILL.md'), 'x');
        fs.mkdirSync(path.join(dirs.skill, 'mine')); fs.writeFileSync(path.join(dirs.skill, 'mine', 'SKILL.md'), 'x');
        fs.writeFileSync(path.join(dirs.agent, 'evidence-gatherer.md'), 'x');
        fs.writeFileSync(path.join(dirs.rule, 'sql-conventions.md'), 'x');
        fs.writeFileSync(path.join(dirs.hook, 'guard-stop-contract.js'), 'x');
        fs.writeFileSync(path.join(dirs.hook, 'docs.js'), 'x');
        const logged = [];
        copy.removeDropped({
            drop: ['skill csharp', 'skill mine', 'agent evidence-gatherer', 'rule sql-conventions', 'hook guard-stop-contract', 'hook docs', 'mcp serena'],
            dirs,
            shipped: { skill: ['csharp'], agent: ['evidence-gatherer'], rule: ['sql-conventions'], hook: ['guard-stop-contract'] },
            log: (l) => logged.push(l),
        });
        assert.ok(!fs.existsSync(path.join(dirs.skill, 'csharp')));
        assert.ok(fs.existsSync(path.join(dirs.skill, 'mine')), 'a name the stack does not ship is the user\'s own');
        assert.ok(!fs.existsSync(path.join(dirs.agent, 'evidence-gatherer.md')));
        assert.ok(!fs.existsSync(path.join(dirs.rule, 'sql-conventions.md')));
        assert.ok(!fs.existsSync(path.join(dirs.hook, 'guard-stop-contract.js')));
        assert.ok(fs.existsSync(path.join(dirs.hook, 'docs.js')), 'an engine is never a dropped hook');
        assert.strictEqual(logged.length, 4);
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// R98 / R99 (Task 18b fix round 2): the read-back lays the stack keys settings.local.json holds over
// settings.json at every scope, but the docs root is not one of its readers - at project and user
// scope the stamped rule names settings.json's root, the shared one, even where a local key shadows it.
test('install-copy: at project and user scope the docs root is settings.json\'s alone; at local scope the local file wins (R98)', () =>
{
    const { base } = fixture();
    fs.mkdirSync(path.join(base, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(base, '.claude', 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: 'docs/shared' } }));
    fs.writeFileSync(path.join(base, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: 'docs/mine' } }));
    const { resolveDocsRoot } = require('./install/copy.js');
    assert.strictEqual(resolveDocsRoot(base, 'project'), 'docs/shared');
    assert.strictEqual(resolveDocsRoot(base, 'user'), 'docs/shared');
    assert.strictEqual(resolveDocsRoot(base, 'local'), 'docs/mine');
});

// A `"type": "module"` project makes Node load every `.js` beneath it as ESM, `.claude/hooks/` included,
// so the copied CommonJS hooks crash (a guard with exit 1 lets its call through). The marker scopes
// the folder back - and is the stack's only while it says exactly that.
test('commonJsScope: marks a folder of stack copies, keeps the user\'s own, prunes its own when the copies leave', () =>
{
    const dir = path.join(TMP, `cjs-${++seq}`);
    fs.mkdirSync(dir, { recursive: true });
    const stackFiles = ['docs.js', 'memory.js', 'model-windows.json'];
    const marker = path.join(dir, 'package.json');

    assert.strictEqual(copy.commonJsScope({ dir, stackFiles }), 'none', 'an empty folder gets no marker');
    assert.ok(!fs.existsSync(marker));

    fs.writeFileSync(path.join(dir, 'docs.js'), "'use strict';\n");
    assert.strictEqual(copy.commonJsScope({ dir, stackFiles }), 'written');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(marker, 'utf8')), { type: 'commonjs' });
    const before = fs.statSync(marker).mtimeMs;
    assert.strictEqual(copy.commonJsScope({ dir, stackFiles }), 'current', 'a re-run leaves the marker as it is');
    assert.strictEqual(fs.statSync(marker).mtimeMs, before);

    fs.rmSync(path.join(dir, 'docs.js'));
    fs.writeFileSync(path.join(dir, 'mine.js'), "'use strict';\n");
    assert.strictEqual(copy.commonJsScope({ dir, stackFiles }), 'pruned', 'no stack copy left - the marker goes');
    assert.ok(!fs.existsSync(marker));

    const notes = [];
    fs.writeFileSync(path.join(dir, 'memory.js'), "'use strict';\n");
    fs.writeFileSync(marker, '{ "type": "module", "private": true }\n');
    assert.strictEqual(copy.commonJsScope({ dir, stackFiles, note: (m) => notes.push(m) }), 'user');
    assert.strictEqual(fs.readFileSync(marker, 'utf8'), '{ "type": "module", "private": true }\n', 'the user\'s package.json is never rewritten');
    assert.match(notes.join('\n'), /hooks\/package\.json/);
    fs.rmSync(path.join(dir, 'memory.js'));
    assert.strictEqual(copy.commonJsScope({ dir, stackFiles }), 'none', 'nor pruned');
    assert.ok(fs.existsSync(marker));

    fs.rmSync(marker);
    fs.writeFileSync(path.join(dir, 'memory.js'), "'use strict';\n");
    fs.writeFileSync(path.join(dir, 'mine.js'), "import fs from 'node:fs';\nexport const x = 1;\n");
    const esmNotes = [];
    assert.strictEqual(copy.commonJsScope({ dir, stackFiles, note: (m) => esmNotes.push(m) }), 'user-esm', 'a marker would break the user\'s own ES-module hook');
    assert.ok(!fs.existsSync(marker));
    assert.match(esmNotes.join('\n'), /mine\.js/);

    fs.writeFileSync(marker, 'not json');
    assert.strictEqual(copy.commonJsScope({ dir, stackFiles, note: () => {} }), 'user', 'an unreadable package.json is the user\'s too');
    assert.strictEqual(fs.readFileSync(marker, 'utf8'), 'not json');
});
