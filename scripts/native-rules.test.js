'use strict';
// Layered native rules, Task 2: the picked rules written to .claude/rules as marked files (install/native-rules.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MARKER, CHILD_WINS_LINE } = require('./install/native-rules-constants.js');
const native = require('./install/native-rules.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'native-rules-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let seq = 0;
const project = () => { const root = path.join(TMP, `p-${seq++}`); fs.mkdirSync(path.join(root, '.claude', 'rules'), { recursive: true }); return root; };
const rulesAt = (root, file = '') => path.join(root, '.claude', 'rules', file);
const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
// A store with the named rules; sourceOf reads from it.
function store(root, rules)
{
    const dir = path.join(root, '.alfred', 'stack', 'rules');
    for (const [name, text] of Object.entries(rules)) put(path.join(dir, `${name}.md`), text);
    return (name) => (fs.existsSync(path.join(dir, `${name}.md`)) ? path.join(dir, `${name}.md`) : null);
}

test('withMarker puts the line after the frontmatter and hasMarker reads it', () =>
{
    const text = native.withMarker('---\npaths: ["a"]\n---\nBody.');
    assert.ok(text.startsWith(`---\npaths: ["a"]\n---\n${MARKER}\n`), text);
    assert.ok(text.endsWith('Body.'));
    assert.strictEqual(native.hasMarker(text), true);
    const bare = native.withMarker('Body.\n');
    assert.strictEqual(bare, `${MARKER}\nBody.\n`);
    assert.strictEqual(native.hasMarker(bare), true);
    assert.strictEqual(native.hasMarker('---\npaths: ["a"]\n---\nBody.'), false);
    assert.strictEqual(native.hasMarker(`Body.\n${MARKER}\n`), false, 'the marker counts only as the first line after the frontmatter');
    assert.strictEqual(native.withMarker(text), text, 'a second call adds nothing');
});

test('withMarker keeps the text\'s own line endings', () =>
{
    const text = native.withMarker('---\r\npaths: ["a"]\r\n---\r\nBody.\r\n');
    assert.ok(text.startsWith(`---\r\npaths: ["a"]\r\n---\r\n${MARKER}\r\nBody.`), JSON.stringify(text));
    assert.strictEqual(native.hasMarker(text), true);
});

test('writeNative writes a picked rule with the marker and rewrites nothing on a re-run', () =>
{
    const root = project();
    const sourceOf = store(root, { 'typescript-conventions': '---\npaths: ["**/*.ts"]\n---\nUse strict.\n', 'alfred-security': 'Be safe.\n' });
    const logs = [];
    const names = ['typescript-conventions', 'alfred-security'];
    const first = native.writeNative({ projectRoot: root, names, sourceOf, log: (l) => logs.push(l) });
    assert.deepStrictEqual(first, { written: names, updated: [], kept: [] });
    assert.strictEqual(fs.readFileSync(rulesAt(root, 'alfred-security.md'), 'utf8'), `${MARKER}\nBe safe.\n`);
    assert.strictEqual(fs.readFileSync(rulesAt(root, 'typescript-conventions.md'), 'utf8'),
        `---\npaths: ["**/*.ts"]\n---\n${MARKER}\nUse strict.\n`);
    const before = fs.statSync(rulesAt(root, 'alfred-security.md')).mtimeMs;
    const second = native.writeNative({ projectRoot: root, names, sourceOf, log: (l) => logs.push(l) });
    assert.deepStrictEqual(second, { written: [], updated: [], kept: [] });
    assert.strictEqual(fs.statSync(rulesAt(root, 'alfred-security.md')).mtimeMs, before, 'the file is not rewritten');
    assert.deepStrictEqual(logs, []);
});

test('writeNative rewrites a marked file whose store text moved on and says updated', () =>
{
    const root = project();
    const sourceOf = store(root, { a: 'one\n' });
    native.writeNative({ projectRoot: root, names: ['a'], sourceOf, log: () => {} });
    fs.writeFileSync(sourceOf('a'), 'two\n');
    const result = native.writeNative({ projectRoot: root, names: ['a'], sourceOf, log: () => {} });
    assert.deepStrictEqual(result, { written: [], updated: ['a'], kept: [] });
    assert.strictEqual(fs.readFileSync(rulesAt(root, 'a.md'), 'utf8'), `${MARKER}\ntwo\n`);
});

test('a rule file without the marker is the user\'s: kept and named', () =>
{
    const root = project();
    const sourceOf = store(root, { 'typescript-conventions': 'stack text\n' });
    put(rulesAt(root, 'typescript-conventions.md'), 'mine');
    const logs = [];
    const result = native.writeNative({ projectRoot: root, names: ['typescript-conventions'], sourceOf, log: (l) => logs.push(l) });
    assert.deepStrictEqual(result, { written: [], updated: [], kept: ['typescript-conventions'] });
    assert.strictEqual(fs.readFileSync(rulesAt(root, 'typescript-conventions.md'), 'utf8'), 'mine');
    assert.strictEqual(logs.length, 1);
    assert.match(logs[0], /rule kept, yours: \.claude\/rules\/typescript-conventions\.md/);
    assert.strictEqual(logs[0], '  !! rule kept, yours: .claude/rules/typescript-conventions.md - it has no alfred-code marker, so the stack\'s typescript-conventions is not written over it');
});

test('writeNative skips a name the store has no file for', () =>
{
    const root = project();
    const result = native.writeNative({ projectRoot: root, names: ['ghost'], sourceOf: () => null, log: () => {} });
    assert.deepStrictEqual(result, { written: [], updated: [], kept: [] });
    assert.ok(!fs.existsSync(rulesAt(root, 'ghost.md')));
});

test('writeNative never writes through a link at a rule path', () =>
{
    const root = project();
    const sourceOf = store(root, { a: 'stack\n' });
    const elsewhere = path.join(TMP, `target-${seq++}.md`);
    fs.writeFileSync(elsewhere, 'outside');
    try { fs.symlinkSync(elsewhere, rulesAt(root, 'a.md')); } catch { return; }   // no link rights on this host
    const result = native.writeNative({ projectRoot: root, names: ['a'], sourceOf, log: () => {} });
    assert.deepStrictEqual(result.kept, ['a']);
    assert.strictEqual(fs.readFileSync(elsewhere, 'utf8'), 'outside');
});

test('pruneNative removes a marked rule no longer picked and leaves an unmarked one', () =>
{
    const root = project();
    put(rulesAt(root, 'old.md'), `${MARKER}\nold\n`);
    put(rulesAt(root, 'notes.md'), 'my notes\n');
    put(rulesAt(root, 'kept.md'), `${MARKER}\nstill picked\n`);
    const logs = [];
    const result = native.pruneNative({ projectRoot: root, keep: ['kept'], childName: null, shipped: [], sourceOf: () => null, log: (l) => logs.push(l) });
    assert.deepStrictEqual(result, { removed: ['old'], kept: [] });
    assert.ok(!fs.existsSync(rulesAt(root, 'old.md')));
    assert.strictEqual(fs.readFileSync(rulesAt(root, 'notes.md'), 'utf8'), 'my notes\n');
    assert.ok(fs.existsSync(rulesAt(root, 'kept.md')));
    assert.match(logs.join('\n'), /rule removed: \.claude\/rules\/old\.md/);
});

test('a <child>.<rule>.md that is not the stack\'s text stays', () =>
{
    const root = project();
    const sourceOf = store(root, { 'alfred-security': 'stack text\n' });
    put(rulesAt(root, 'api.alfred-security.md'), 'what the user wrote\n');
    const logs = [];
    const result = native.pruneNative({ projectRoot: root, keep: [], childName: 'api', shipped: ['alfred-security'], sourceOf, log: (l) => logs.push(l) });
    assert.deepStrictEqual(result, { removed: [], kept: ['api.alfred-security'] });
    assert.strictEqual(fs.readFileSync(rulesAt(root, 'api.alfred-security.md'), 'utf8'), 'what the user wrote\n');
    assert.match(logs.join('\n'), /rule kept, yours: \.claude\/rules\/api\.alfred-security\.md/);
});

test('a <child>.<rule>.md at the stack\'s text goes', () =>
{
    const root = project();
    const sourceOf = store(root, { 'alfred-security': 'stack text\n', 'alfred-navigation': 'nav\n' });
    put(rulesAt(root, 'api.alfred-security.md'), 'stack text\n');
    put(rulesAt(root, 'api.alfred-navigation.md'), `${MARKER}\nnav\n`);
    put(rulesAt(root, 'api.not-shipped.md'), 'stack text\n');
    const result = native.pruneNative({ projectRoot: root, keep: [], childName: 'api', shipped: ['alfred-security', 'alfred-navigation'], sourceOf, log: () => {} });
    assert.deepStrictEqual(result.removed.sort(), ['api.alfred-navigation', 'api.alfred-security']);
    assert.ok(!fs.existsSync(rulesAt(root, 'api.alfred-security.md')));
    assert.ok(!fs.existsSync(rulesAt(root, 'api.alfred-navigation.md')));
    assert.ok(fs.existsSync(rulesAt(root, 'api.not-shipped.md')), 'a rule the stack does not ship is not the stack\'s');
});

test('pruneNative leaves the <child>.<rule>.md alone in a project that is no child', () =>
{
    const root = project();
    const sourceOf = store(root, { 'alfred-security': 'stack text\n' });
    put(rulesAt(root, 'api.alfred-security.md'), 'stack text\n');
    const result = native.pruneNative({ projectRoot: root, keep: [], childName: null, shipped: ['alfred-security'], sourceOf, log: () => {} });
    assert.deepStrictEqual(result, { removed: [], kept: [] });
    assert.ok(fs.existsSync(rulesAt(root, 'api.alfred-security.md')));
});

test('nativeNames: a child writes only its own picks the root does not hold; a root leaves out member-only picks', () =>
{
    const top = project();
    const kid = project();
    put(rulesAt(top, 'shared.md'), `${MARKER}\nx\n`);
    const library = { rules: { 'alfred-security': 'h1', shared: 'h2', mine: 'h3', 'member-only': 'h4', both: 'h5' } };
    const asRoot = native.nativeNames({ projectRoot: top, library, ownPicks: ['rule/both'], memberPicks: ['rule/member-only', 'rule/both'], chainRoots: [] });
    assert.deepStrictEqual(asRoot.sort(), ['alfred-security', 'both', 'mine', 'shared']);
    const asKid = native.nativeNames({ projectRoot: kid, library, ownPicks: ['rule/shared', 'rule/mine', 'skill/x'], memberPicks: [], chainRoots: [top] });
    assert.deepStrictEqual(asKid, ['mine'], 'shared is held natively above, a skill pick is no rule, the inherited rules are the root\'s');
    const spaced = native.nativeNames({ projectRoot: kid, library, ownPicks: ['rule mine'], memberPicks: [], chainRoots: [top] });
    assert.deepStrictEqual(spaced, ['mine'], 'the stamp reader\'s `rule <name>` spelling reads too');
});

test('nativeNames: a rule only the child names but no store holds is not asked of the library', () =>
{
    const kid = project();
    const names = native.nativeNames({ projectRoot: kid, library: { rules: {} }, ownPicks: ['rule/mine'], memberPicks: [], chainRoots: [], child: true });
    assert.deepStrictEqual(names, ['mine'], 'the caller\'s sourceOf decides whether a store text exists');
});

test('the root awareness rule carries the child-wins line once', () =>
{
    const root = project();
    const file = rulesAt(root, 'alfred-awareness.md');
    put(file, '---\ndescription: Project awareness\n---\n\n# Project awareness\n\nBody.\n');
    assert.strictEqual(native.ensureChildWins({ projectRoot: root, hasChildren: true }), true);
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(text.startsWith(`---\ndescription: Project awareness\n---\n${CHILD_WINS_LINE}\n\n# Project awareness`), text);
    assert.strictEqual(native.ensureChildWins({ projectRoot: root, hasChildren: true }), false, 'a second call changes nothing');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), text);
    assert.strictEqual(text.split(CHILD_WINS_LINE).length - 1, 1);
    assert.strictEqual(native.ensureChildWins({ projectRoot: root, hasChildren: false }), true, 'the line goes when no child is listed');
    assert.ok(!fs.readFileSync(file, 'utf8').includes(CHILD_WINS_LINE));
    assert.strictEqual(fs.readFileSync(file, 'utf8'), '---\ndescription: Project awareness\n---\n\n# Project awareness\n\nBody.\n');
});

test('a standalone project\'s awareness rule has none', () =>
{
    const root = project();
    const file = rulesAt(root, 'alfred-awareness.md');
    const original = '---\ndescription: Project awareness\n---\n\n# Project awareness\n';
    put(file, original);
    assert.strictEqual(native.ensureChildWins({ projectRoot: root, hasChildren: false }), false);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), original);
    assert.strictEqual(native.ensureChildWins({ projectRoot: project(), hasChildren: true }), false, 'no awareness rule, nothing to do');
});

// The capture's writer and the installer write the same bytes, so a later capture keeps the line and an update adds it.
const AWARENESS_SCRIPT = path.join(__dirname, '..', 'stack', 'skills', 'capture-awareness', 'scripts', 'awareness-state.js');
function awarenessProject({ children })
{
    const root = project();
    put(path.join(root, '.alfred', 'docs', 'awareness', 'AGENTS-AWARENESS.md'), 'x\n');
    if (children) put(path.join(root, '.alfred', 'workspace.json'), JSON.stringify({ children }));
    return root;
}

test('the capture\'s rule writer adds the child-wins line when a child is listed, and the installer\'s bytes match it', () =>
{
    const { composeAwarenessRule } = require(AWARENESS_SCRIPT);
    const withKid = composeAwarenessRule({ projectRoot: awarenessProject({ children: ['api'] }), docs: '.alfred/docs' }).text;
    const alone = composeAwarenessRule({ projectRoot: awarenessProject({ children: [] }), docs: '.alfred/docs' }).text;
    const noRecord = composeAwarenessRule({ projectRoot: awarenessProject({ children: null }), docs: '.alfred/docs' }).text;
    assert.ok(withKid.startsWith(`---\ndescription: Project awareness - generated by /capture-awareness; edit via a re-run, not by hand.\n---\n${CHILD_WINS_LINE}\n\n# Project awareness`), withKid.slice(0, 260));
    assert.ok(!alone.includes(CHILD_WINS_LINE) && !noRecord.includes(CHILD_WINS_LINE));
    const root = project();
    put(rulesAt(root, 'alfred-awareness.md'), alone);
    assert.strictEqual(native.ensureChildWins({ projectRoot: root, hasChildren: true }), true);
    assert.strictEqual(fs.readFileSync(rulesAt(root, 'alfred-awareness.md'), 'utf8'), withKid, 'the installer adds the line where the writer would');
});
