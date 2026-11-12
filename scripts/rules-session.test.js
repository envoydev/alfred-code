'use strict';
const test = require('node:test');
// No inherited stack env, entrypoint or project dir, and the suite fails on a stray write (hook-test-env.js).
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const ENTRIES = path.join(ROOT, 'meta', 'plugin-entries.json');
const LOADER = path.join(ROOT, 'stack', 'hooks', 'rules-session.js');

// Task 1: the eleven rows reach both routes, and the loader can be required with no side effect.
test('rows: the plugin entry carries five --part rows per start event and one PostToolUse row', () =>
{
    const core = JSON.parse(fs.readFileSync(ENTRIES, 'utf8')).entries.find((p) => p.name === 'alfred-code');
    const mine = (event) => (core.hooks[event] || []).flatMap((b) => b.hooks.map((h) => ({ matcher: b.matcher, args: h.args || [] })))
        .filter((r) => r.args[0] === '${CLAUDE_PLUGIN_ROOT}/stack/hooks/rules-session.js');
    for (const event of ['SessionStart', 'SubagentStart'])
        assert.deepStrictEqual(mine(event).map((r) => r.args.slice(1)), [1, 2, 3, 4, 5].map((k) => ['--part', String(k)]), event);
    const post = mine('PostToolUse');
    assert.strictEqual(post.length, 1);
    assert.strictEqual(post[0].matcher, 'Read|Edit|Write|MultiEdit|NotebookEdit');
    assert.strictEqual(post[0].args.length, 1, 'the script alone: no --part');
});

test('rows: the copy route carries the third slot in the command', () =>
    assert.strictEqual(require('./install/settings.js').hookCommand('rules-session.js', '--part 3').command,
        '"$CLAUDE_PROJECT_DIR/.claude/hooks/rules-session.js" --part 3'));

test('requiring the loader loads no prelude and no layout', () =>
{
    // A child process: this file's own process loads the prelude for other tests.
    const code = `require(${JSON.stringify(LOADER)}); process.stdout.write(Object.keys(require.cache)`
        + '.filter((f) => /hook-prelude\\.js$|layout\\.js$/.test(f)).join())';
    assert.strictEqual(execFileSync(process.execPath, ['-e', code], { encoding: 'utf8' }), '');
});

// Task 2: render, pathsOf, pathGlob, parts.
const RULES_DIR = path.join(ROOT, 'stack', 'rules');
const loader = () => require(LOADER);
const OPEN = (k, n) => `Project rules, part ${k} of ${n} - binding instructions for this project`;
const CLOSE = (k, n) => `End of project rules, part ${k} of ${n}`;
// A rule of `chars` characters in 80-character lines, never ending on a line break.
function rule(name, chars)
{
    const text = 'x'.repeat(79).concat('\n').repeat(Math.ceil(chars / 80) + 1).slice(0, chars).replace(/\n$/, 'x');
    return { name, rel: `.alfred/stack/rules/${name}.md`, text };
}
const heading = (r) => `## ${r.name} (${r.rel})`;
// The room a part leaves for the texts of n blocks named as the given rules.
const ROOM = (rules) => 9500 - OPEN(1, 1).length - CLOSE(1, 1).length - 2 * (rules.length + 1) - rules.reduce((s, r) => s + heading(r).length + 1, 0);
const shippedFiles = () => fs.readdirSync(RULES_DIR).filter((f) => f.endsWith('.md')).sort();
const shippedPathless = () => shippedFiles().map((f) => ({ f, text: fs.readFileSync(path.join(RULES_DIR, f), 'utf8') }))
    .filter(({ text }) => !loader().pathsOf(text).length)
    .map(({ f, text }) => ({ name: f.replace(/\.md$/, ''), rel: `.alfred/stack/rules/${f}`, text: loader().render(text) }));

test('render: equal to what check 33 counts', () =>
{
    const surface = require('./always-on-surface.js');
    for (const f of shippedFiles())
    {
        const text = fs.readFileSync(path.join(RULES_DIR, f), 'utf8');
        assert.strictEqual(loader().render(text), surface.injectedRuleText(text), f);
    }
    const text = '---\npaths: ["a"]\n---\n\nkeep\n<!-- a note -->\n```\n<!-- in a fence -->\n```\nend';
    assert.strictEqual(loader().render(text), 'keep\n```\n<!-- in a fence -->\n```\nend');
});

test('pathsOf: inline list, scalar, dash list, none', () =>
{
    const { pathsOf } = loader();
    assert.deepStrictEqual(pathsOf(fs.readFileSync(path.join(RULES_DIR, 'typescript-conventions.md'), 'utf8')), ['**/*.ts', '**/*.tsx']);
    assert.deepStrictEqual(pathsOf('---\npaths: "**/*.md"\n---\nx'), ['**/*.md']);
    assert.deepStrictEqual(pathsOf('---\npaths:\n  - "**/*.md"\n  - docs/*.txt\n---\nx'), ['**/*.md', 'docs/*.txt']);
    assert.deepStrictEqual(pathsOf(fs.readFileSync(path.join(RULES_DIR, 'alfred-security.md'), 'utf8')), []);
    assert.deepStrictEqual(pathsOf('no frontmatter'), []);
});

test('pathGlob: root-level, nested, zero folders in the middle', () =>
{
    const { pathGlob } = loader();
    const m = (glob, file) => pathGlob(glob).test(file);
    assert.ok(m('**/*.cs', 'a.cs') && m('**/*.cs', 'x/y/a.cs') && !m('**/*.cs', 'a.csx'));
    assert.ok(m('**/Migrations/**/*.cs', 'Migrations/a.cs') && m('**/Migrations/**/*.cs', 'p/Migrations/q/a.cs'));
    assert.ok(m('**/docker-compose*.yml', 'docker-compose.prod.yml') && !m('**/docker-compose*.yml', 'x/docker-compose/a.yml'));
    assert.ok(m('src/**', 'src/a/b.ts') && !m('src/**', 'src'));
    assert.ok(!m('**/a.b', 'axb'), 'a dot is literal');
});

test('pathGlob: every shipped rule\'s globs compile and match their own example', () =>
{
    const { pathGlob, pathsOf } = loader();
    for (const f of shippedFiles())
        for (const glob of pathsOf(fs.readFileSync(path.join(RULES_DIR, f), 'utf8')))
        {
            const re = pathGlob(glob);
            assert.ok(re instanceof RegExp, `${f}: ${glob}`);
            const example = glob.replace(/\*\*\//g, '').replace(/\*/g, 'x');
            assert.ok(re.test(example) && re.test(`a/b/${example}`), `${f}: ${glob} on ${example}`);
        }
});

test('pathGlob: an unsupported character gives null', () =>
{
    for (const glob of ['*.{ts,tsx}', '[ab].ts', 'a?.ts', '!x.ts']) assert.strictEqual(loader().pathGlob(glob), null, glob);
});

test('parts: at PART_ROOM, one under, one over', () =>
{
    const { parts, PART_ROOM } = loader();
    assert.strictEqual(PART_ROOM, 9500);
    const r = rule('r1', ROOM([rule('r1', 1)]));
    assert.strictEqual(parts([r]).parts.length, 1);
    assert.strictEqual(parts([r]).parts[0].length, 9500);
    assert.strictEqual(parts([rule('r1', r.text.length - 1)]).parts[0].length, 9499);
    const over = parts([rule('r1', r.text.length + 1)]).parts;
    assert.strictEqual(over.length, 2);
    assert.ok(over[1].startsWith(`${OPEN(2, 2)}\n\n## r1 (.alfred/stack/rules/r1.md) - continued\n`), over[1].slice(0, 120));
    for (const p of over) assert.ok(p.length <= 9500, String(p.length));
});

test('parts: every part ends with its closing line and counts it', () =>
{
    const out = loader().parts(shippedPathless()).parts;
    out.forEach((p, i) =>
    {
        assert.ok(p.startsWith(OPEN(i + 1, out.length)), p.slice(0, 80));
        assert.ok(p.endsWith(CLOSE(i + 1, out.length)), p.slice(-60));
        assert.ok(p.length <= 9500, String(p.length));
    });
});

test('parts: the six shipped rules fit three parts', () =>
{
    const rules = shippedPathless();
    assert.strictEqual(rules.length, 6, rules.map((r) => r.name).join());
    const { parts: out, unsent } = loader().parts(rules);
    assert.strictEqual(out.length, 3);
    assert.deepStrictEqual(unsent, []);
    for (const r of rules) assert.strictEqual(out.join('\n').split(`${heading(r)}\n`).length - 1, 1, r.name);
});

test('parts: largest first, ties by name, first part with room', () =>
{
    const out = loader().parts([rule('b', 5000), rule('a', 5000), rule('c', 3000)]).parts;
    assert.strictEqual(out.length, 2);
    assert.ok(out[0].indexOf('## a (') > 0 && out[0].indexOf('## c (') > out[0].indexOf('## a ('), 'part 1: a then c');
    assert.ok(out[1].includes('## b ('), 'part 2: b');
});

test('parts: a rule longer than one part is cut at line ends across parts of its own', () =>
{
    const r = rule('big', 20000);
    const out = loader().parts([r]).parts;
    assert.strictEqual(out.length, 3);
    const chunks = out.map((p) => p.split('\n\n').slice(1, -1).join('\n\n').replace(/^## big \([^)]*\)( - continued)?\n/, ''));
    assert.strictEqual(chunks.join('\n'), r.text);
    for (const c of chunks.slice(0, -1)) assert.strictEqual(c.length % 80, 79, 'each chunk but the last ends at a line end');
});

test('parts: five full parts and a sixth rule - two unsent', () =>
{
    const rs = [1, 2, 3, 4, 5, 6].map((k) => rule(`r${k}`, ROOM([rule(`r${k}`, 1)])));
    const { parts: out, unsent } = loader().parts(rs);
    assert.strictEqual(out.length, 5);
    assert.deepStrictEqual(unsent, [rs[4].rel, rs[5].rel]);
    assert.strictEqual(out[4], [OPEN(5, 5), `Not sent - past part 5: ${rs[4].rel}, ${rs[5].rel}`, CLOSE(5, 5)].join('\n\n'));
});

test('parts: five parts with room and a sixth rule - one unsent', () =>
{
    const size = (n) => ROOM([rule(n, 1)]);
    const rs = [rule('a', size('a')), ...['b', 'c', 'd', 'e', 'f'].map((n) => rule(n, size(n) - 200))];
    const { parts: out, unsent } = loader().parts(rs);
    assert.strictEqual(out.length, 5);
    assert.deepStrictEqual(unsent, [rs[5].rel]);
    assert.ok(out[4].includes('## e (') && out[4].endsWith(`Not sent - past part 5: ${rs[5].rel}\n\n${CLOSE(5, 5)}`), out[4].slice(-160));
    assert.ok(out[4].length <= 9500);
});

test('parts: no rule', () =>
{
    assert.deepStrictEqual(loader().parts([]), { parts: [[OPEN(1, 1), CLOSE(1, 1)].join('\n\n')], unsent: [] });
    assert.strictEqual(loader().parts([], { natives: ['a', 'b'] }).parts[0], [OPEN(1, 1), 'loaded natively: a, b', CLOSE(1, 1)].join('\n\n'));
});

test('parts: the same input gives the same output', () =>
{
    const rs = [rule('b', 5000), rule('a', 5000), rule('c', 3000), rule('d', 7000), rule('e', 1200)];
    assert.deepStrictEqual(loader().parts(rs), loader().parts([rs[3], rs[0], rs[4], rs[2], rs[1]]));
});

// Task 3: rulesFor.
const os = require('node:os');
function tree(spec = {})
{
    const top = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rules-')));
    for (const [rel, text] of Object.entries(spec))
    {
        const file = path.join(top, ...rel.split('/'));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        if (text !== null) fs.writeFileSync(file, text);
    }
    return top;
}
const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const ws = (dir, record) => put(path.join(dir, '.alfred', 'workspace.json'), JSON.stringify(record));
const stamp = (dir, lines = []) => put(path.join(dir, '.claude', 'alfred-code.stamp'), ['source: test', ...lines].join('\n') + '\n');
const store = (dir, name, text = `body of ${name}`) => put(path.join(dir, '.alfred', 'stack', 'rules', `${name}.md`), text);
const native = (dir, name, text = `native ${name}`) => put(path.join(dir, '.claude', 'rules', `${name}.md`), text);
const names = (list) => list.map((r) => r.name);
const ENV = { HOME: os.tmpdir() };
// The standard tree: a stamped root `ws`, a joined child `ws/api`, a joined leaf `ws/api/lib`, each a repository.
// `web` adds a second child `ws/web`, `lib2` a second grandchild `ws/api/lib2` (stage 5).
function W({ apiIgnore, libIgnore, web: withWeb, lib2: withLib2 } = {})
{
    const top = tree({ 'ws/.git/HEAD': 'x', 'ws/api/.git/HEAD': 'x', 'ws/api/lib/.git/HEAD': 'x' });
    const root = path.join(top, 'ws');
    const api = path.join(root, 'api');
    const lib = path.join(api, 'lib');
    const web = path.join(root, 'web');
    const lib2 = path.join(api, 'lib2');
    for (const d of [root, api, lib, ...(withWeb ? [web] : []), ...(withLib2 ? [lib2] : [])]) { put(path.join(d, '.git', 'HEAD'), 'x'); stamp(d); }
    ws(root, { parent: 'root', children: ['api', ...(withWeb ? ['web'] : [])] });
    ws(api, { parent: '..', children: ['lib', ...(withLib2 ? ['lib2'] : [])], ...(apiIgnore ? { ignore: { rules: apiIgnore } } : {}) });
    ws(lib, { parent: '..', ...(libIgnore ? { ignore: { rules: libIgnore } } : {}) });
    if (withWeb) ws(web, { parent: '..' });
    if (withLib2) ws(lib2, { parent: '..' });
    return { top, root, api, lib, web, lib2 };
}
const at = (dir, opts = {}) => loader().rulesFor(dir, opts.env || ENV, { host: opts.host || 'claude' });

test('rulesFor: a project in no workspace reads its own folder alone', () =>
{
    const top = tree({ 'p/.git/HEAD': 'x' });
    const p = path.join(top, 'p');
    stamp(p);
    store(p, 'b', '---\n---\nbee <!-- note -->');
    store(p, 'a', 'aye');
    const r = at(p);
    assert.strictEqual(r.project, p);
    assert.strictEqual(r.hasStore, true);
    assert.deepStrictEqual(names(r.always), ['a', 'b']);
    assert.strictEqual(r.always[0].rel, '.alfred/stack/rules/a.md');
    assert.strictEqual(r.always[0].text, 'aye');
});

test('rulesFor: no store folder anywhere', () =>
{
    const { api } = W();
    const r = at(api);
    assert.strictEqual(r.hasStore, false);
    assert.deepStrictEqual([r.always, r.scoped, r.notes], [[], [], []]);
});

test('rulesFor: the chain, root first, a child\'s rule replacing the root\'s', () =>
{
    const { root, api } = W();
    store(root, 'a');
    store(root, 'b', 'root b');
    store(api, 'b', 'child b');
    for (const f of ['alfred-docs-root.md', 'alfred-preferences.md'])
        for (const d of [root, api]) store(d, f.replace(/\.md$/, ''), fs.readFileSync(path.join(RULES_DIR, f), 'utf8') + (d === api ? '\nCHILD' : ''));
    const r = at(api);
    assert.deepStrictEqual(names(r.always), ['a', 'alfred-docs-root', 'alfred-preferences', 'b']);
    assert.strictEqual(r.always[0].rel, '../.alfred/stack/rules/a.md');
    assert.strictEqual(r.always.find((x) => x.name === 'b').text, 'child b');
    for (const n of ['alfred-docs-root', 'alfred-preferences']) assert.ok(r.always.find((x) => x.name === n).text.endsWith('CHILD'), n);
});

test('rulesFor: ignore rule in the start project and in a middle project above a leaf', () =>
{
    const t = W({ apiIgnore: ['a'] });
    store(t.root, 'a');
    assert.deepStrictEqual(names(at(t.api).always), []);
    assert.deepStrictEqual(names(at(t.lib).always), []);
    assert.deepStrictEqual(names(at(t.root).always), ['a']);
    const u = W({ libIgnore: ['a'] });
    store(u.root, 'a');
    assert.deepStrictEqual(names(at(u.lib).always), []);
    assert.deepStrictEqual(names(at(u.api).always), ['a']);
});

test('rulesFor: an ignore of a locked rule is refused and named', () =>
{
    const name = loader().LOCKED_RULES[0];
    const t = W({ apiIgnore: [name] });
    store(t.root, name);
    const r = at(t.api);
    assert.deepStrictEqual(names(r.always), [name]);
    assert.ok(r.notes.includes(`ignore rule ${name} not honoured: the rule is locked`), r.notes.join('|'));
});

test('rulesFor: a link and a file over 64 KB are skipped and named', () =>
{
    const top = tree({ 'p/.git/HEAD': 'x', 'other.md': 'linked' });
    const p = path.join(top, 'p');
    stamp(p);
    store(p, 'big', 'x'.repeat(65537));
    store(p, 'edge', 'x'.repeat(65536));
    if (process.platform !== 'win32') fs.symlinkSync(path.join(top, 'other.md'), path.join(p, '.alfred', 'stack', 'rules', 'link.md'));
    const r = at(p);
    assert.deepStrictEqual(names(r.always), ['edge']);
    assert.ok(r.notes.includes('rule skipped: .alfred/stack/rules/big.md - over 64 KB'), r.notes.join('|'));
    if (process.platform !== 'win32') assert.ok(r.notes.includes('rule skipped: .alfred/stack/rules/link.md - a link'), r.notes.join('|'));
});

test('rulesFor: a member-held rule reaches the root and the member that picked it only', () =>
{
    const t = W();
    const web = path.join(t.root, 'web');
    fs.mkdirSync(path.join(web, '.git'), { recursive: true });
    stamp(web);
    ws(web, { parent: '..' });
    ws(t.root, { parent: 'root', children: ['api', 'web'] });
    stamp(t.root, ['member-picks: rule/p']);
    stamp(t.api, ['own-picks: rule/p']);
    store(t.root, 'p');
    store(t.root, 'q');
    assert.deepStrictEqual(names(at(t.root).always), ['p', 'q']);
    assert.deepStrictEqual(names(at(t.api).always), ['p', 'q']);
    assert.deepStrictEqual(names(at(t.lib).always), ['p', 'q']);
    assert.deepStrictEqual(names(at(web).always), ['q']);
});

test('rulesFor: a stamp that cannot be read keeps a member-held rule out', () =>
{
    const t = W();
    const web = path.join(t.root, 'web');
    fs.mkdirSync(path.join(web, '.git'), { recursive: true });
    ws(web, { parent: '..' });
    ws(t.root, { parent: 'root', children: ['api', 'web'] });
    stamp(t.root, ['member-picks: rule/p']);
    fs.mkdirSync(path.join(web, '.claude', 'alfred-code.stamp'), { recursive: true });
    store(t.root, 'p');
    const r = at(web);
    assert.deepStrictEqual(names(r.always), []);
    assert.ok(r.notes.some((n) => n.startsWith('stamp not read')), r.notes.join('|'));
    fs.rmSync(path.join(t.root, '.claude', 'alfred-code.stamp'));
    fs.mkdirSync(path.join(t.root, '.claude', 'alfred-code.stamp'));
    const s = at(t.api);
    assert.deepStrictEqual(names(s.always), ['p']);
    assert.ok(s.notes.some((n) => n.startsWith('stamp not read')), s.notes.join('|'));
});

test('rulesFor: the nearest holder, two levels, Claude Code', () =>
{
    const t = W();
    store(t.root, 'a');
    native(t.api, 'a');
    let r = at(t.api);
    assert.deepStrictEqual([names(r.always), r.natives], [[], ['a']]);
    const u = W();
    native(u.root, 'a');
    store(u.api, 'a', 'child a');
    r = at(u.api);
    assert.deepStrictEqual([names(r.always), r.natives, r.always[0].text], [['a'], [], 'child a']);
    const v = W();
    native(v.root, 'a');
    store(v.root, 'a');
    for (const d of [v.root, v.api]) assert.deepStrictEqual([names(at(d).always), at(d).natives], [[], ['a']], d);
});

test('rulesFor: the nearest holder, three levels', () =>
{
    const t = W();
    store(t.root, 'a');
    native(t.api, 'a');
    assert.deepStrictEqual(at(t.lib).natives, ['a']);
    assert.deepStrictEqual(at(t.api).natives, ['a']);
    assert.deepStrictEqual(names(at(t.root).always), ['a']);
    const u = W();
    store(u.api, 'a', 'middle a');
    native(u.root, 'a');
    for (const d of [u.lib, u.api]) assert.deepStrictEqual([at(d).always.map((x) => x.text), at(d).natives], [['middle a'], []], d);
});

test('rulesFor: native files count for nothing on Cursor', () =>
{
    const t = W();
    store(t.root, 'a');
    native(t.api, 'a');
    const r = at(t.api, { host: 'cursor' });
    assert.deepStrictEqual([names(r.always), r.natives], [['a'], []]);
    const u = W();
    native(u.root, 'a');
    store(u.root, 'a');
    assert.deepStrictEqual(names(at(u.root, { host: 'cursor' }).always), ['a']);
});

test('rulesFor: a garbage workspace.json', () =>
{
    const t = W();
    store(t.root, 'a');
    store(t.api, 'b');
    fs.writeFileSync(path.join(t.api, '.alfred', 'workspace.json'), '{');
    assert.deepStrictEqual(names(at(t.api).always), ['b']);
});

test('rulesFor: a start in a sub-folder and in a linked worktree', () =>
{
    const t = W();
    store(t.api, 'x');
    const deep = path.join(t.api, 'src', 'deep');
    fs.mkdirSync(deep, { recursive: true });
    const r = at(deep);
    assert.strictEqual(r.project, t.api);
    assert.strictEqual(r.always[0].rel, '../../.alfred/stack/rules/x.md');
    const wt = path.join(t.top, 'wt');
    const gitdir = path.join(t.api, '.git', 'worktrees', 'wt');
    fs.mkdirSync(gitdir, { recursive: true });
    fs.writeFileSync(path.join(gitdir, 'commondir'), '../..');
    put(path.join(wt, '.git'), `gitdir: ${gitdir}\n`);
    assert.strictEqual(at(wt).project, t.api);
});

test('rulesFor: a repository never set up below a stamped root is served', () =>
{
    const t = W();
    store(t.root, 'a');
    const tool = path.join(t.root, 'tool');
    fs.mkdirSync(path.join(tool, '.git'), { recursive: true });
    fs.mkdirSync(path.join(tool, 'src'));
    for (const d of [tool, path.join(tool, 'src')])
    {
        const r = at(d);
        assert.strictEqual(r.project, t.root, d);
        assert.deepStrictEqual(names(r.always), ['a']);
    }
    const lone = tree({ 'r/.git/HEAD': 'x' });
    assert.strictEqual(at(path.join(lone, 'r')).project, null);
});

// Review I3 (4c): a joined child holds no copy of what its parent holds, so the switch off must not strip it of those
// rules - off freezes the chain the records name, it does not cut it.
test('rulesFor: the workspace switched off still reads the recorded chain, so a joined child keeps its inherited rules', () =>
{
    const t = W();
    store(t.root, 'a');
    store(t.api, 'b');
    assert.deepStrictEqual(names(at(t.api, { env: { ...ENV, ALFRED_CODE_WORKSPACE: '0' } }).always), ['a', 'b']);
});

test('rulesFor: an unsupported glob is named and the rule\'s other globs still match', () =>
{
    const top = tree({ 'p/.git/HEAD': 'x' });
    const p = path.join(top, 'p');
    stamp(p);
    store(p, 'g', '---\npaths: ["**/*.{a,b}", "**/*.c"]\n---\nglob rule');
    const r = at(p);
    assert.deepStrictEqual([names(r.always), names(r.scoped)], [[], ['g']]);
    assert.deepStrictEqual(r.scoped[0].globs, ['**/*.{a,b}', '**/*.c']);
    assert.ok(r.notes.includes('glob not matched: **/*.{a,b} in .alfred/stack/rules/g.md'), r.notes.join('|'));
});

// Task 4: the row handlers, the record and the probe row.
const { spawnSync, spawn } = require('node:child_process');
const { scrubbed } = require('./hook-test-env');
const LAYOUT = require('../stack/hooks/layout.js');
const SID = 'sess-1';
// A home of the suite's own: never a folder of a test tree, which the project walk stops at.
const HOME_DIR = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rules-home-')));
const envFor = (dir, extra = {}) => ({ ...scrubbed(), HOME: HOME_DIR, CLAUDE_CONFIG_DIR: path.join(HOME_DIR, '.claude'), CLAUDE_PROJECT_DIR: dir, ...extra });
function run(dir, args, payload, extra)
{
    const input = typeof payload === 'string' ? payload : JSON.stringify({ session_id: SID, cwd: dir, ...payload });
    return spawnSync(process.execPath, [LOADER, ...args], { input, encoding: 'utf8', env: envFor(dir, extra) });
}
function ctx(res)
{
    assert.strictEqual(res.status, 0, res.stderr);
    if (!res.stdout) return '';
    const j = JSON.parse(res.stdout);
    return j.hookSpecificOutput ? j.hookSpecificOutput.additionalContext : j.additional_context;
}
const START = (source = 'startup') => ({ hook_event_name: 'SessionStart', source });
const SEAT = (type = 'general-purpose', id = 'agent-a1') => ({ hook_event_name: 'SubagentStart', agent_type: type, agent_id: id });
const READ = (file, extra = {}) => ({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: file }, ...extra });
const part = (dir, k, payload = START(), extra) => ctx(run(dir, ['--part', String(k)], payload, extra));
const touch = (dir, file, extra = {}, env) => ctx(run(dir, [], READ(file, extra), env));
const count = (text, s) => text.split(s).length - 1;
// A stamped repository holding the given store rules.
function project(rules = {})
{
    const p = path.join(tree({ 'p/.git/HEAD': 'x' }), 'p');
    stamp(p);
    fs.mkdirSync(path.join(p, '.alfred', 'stack', 'rules'), { recursive: true });
    for (const [name, text] of Object.entries(rules)) store(p, name, text);
    return p;
}
const TS = '---\npaths: ["**/*.ts"]\n---\nM-TS';
const listing = (dir) => fs.readdirSync(dir, { recursive: true }).sort();

test('start: no .alfred/stack/rules folder in the chain', () =>
{
    const { api } = W();
    const before = listing(path.dirname(api));
    for (const k of [1, 2, 3, 4, 5])
        for (const p of [START(), SEAT()]) assert.strictEqual(part(api, k, p), '', `part ${k} ${p.hook_event_name}`);
    assert.strictEqual(touch(api, path.join(api, 'a.ts')), '');
    assert.deepStrictEqual(listing(path.dirname(api)), before);
});

test('start: part 1 carries the rules between its opening and closing line', () =>
{
    const p = project({ a: 'M-A' });
    const res = run(p, ['--part', '1'], START());
    assert.strictEqual(JSON.parse(res.stdout).hookSpecificOutput.hookEventName, 'SessionStart');
    const text = ctx(res);
    assert.ok(text.startsWith(OPEN(1, 1)) && text.endsWith(CLOSE(1, 1)), text);
    assert.ok(text.includes('## a (.alfred/stack/rules/a.md)') && count(text, 'M-A') === 1, text);
    assert.strictEqual(part(p, 2), '');
});

test('start: a folder with no rule to send', () =>
    assert.strictEqual(part(project(), 1), [OPEN(1, 1), CLOSE(1, 1)].join('\n\n')));

test('start: every rule held natively', () =>
{
    const p = project();
    native(p, 'a');
    assert.strictEqual(part(p, 1), [OPEN(1, 1), 'loaded natively: a', CLOSE(1, 1)].join('\n\n'));
});

test('start: the six shipped rules arrive in three parts', () =>
{
    const p = project();
    const six = shippedPathless();
    for (const r of six) fs.copyFileSync(path.join(RULES_DIR, `${r.name}.md`), path.join(p, '.alfred', 'stack', 'rules', `${r.name}.md`));
    const got = [1, 2, 3, 4, 5].map((k) => part(p, k));
    assert.ok(got.slice(0, 3).every(Boolean) && !got[3] && !got[4]);
    for (const r of six) assert.strictEqual(count(got.join('\n'), `${heading(r)}\n`), 1, r.name);
});

test('start: resume and fork send nothing; clear and compact send', () =>
{
    const p = project({ a: 'M-A' });
    for (const s of ['resume', 'fork']) assert.strictEqual(part(p, 1, START(s)), '', s);
    for (const s of ['clear', 'compact', 'startup']) assert.ok(part(p, 1, START(s)).includes('M-A'), s);
});

test('start: nothing is sent to Explore and Plan', () =>
{
    const p = project({ a: 'M-A' });
    for (const t of ['Explore', 'Plan']) assert.strictEqual(part(p, 1, SEAT(t)), '', t);
    const res = run(p, ['--part', '1'], SEAT());
    assert.strictEqual(JSON.parse(res.stdout).hookSpecificOutput.hookEventName, 'SubagentStart');
    assert.ok(ctx(res).includes('M-A'));
});

test('start: the Cursor payload\'s reply shape', () =>
{
    const t = W();
    store(t.root, 'a', 'M-A');
    native(t.api, 'a');
    const res = run(t.api, ['--part', '1'], { hook_event_name: 'sessionStart', cursor_version: '1.7.0' });
    const j = JSON.parse(res.stdout);
    assert.deepStrictEqual(Object.keys(j), ['additional_context']);
    assert.ok(j.additional_context.includes('M-A'));
    assert.strictEqual(part(t.api, 1, { hook_event_name: 'subagentStart', cursor_version: '1.7.0' }), '');
});

test('start: the probe row', () =>
{
    const p = project({ a: 'M-A' });
    const file = path.join(LAYOUT.statsPath(p, ['hook-blocks'], {}), `${SID}.jsonl`);
    const sent = part(p, 1);
    const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.strictEqual(rows.length, 1);
    assert.deepStrictEqual([rows[0].hook, rows[0].kind, rows[0].mode, rows[0].parts, rows[0].chars, rows[0].unsent, rows[0].agent],
        ['rules-session.js', 'rules-push', 'probe', 1, sent.length, 0, 'main']);
    part(p, 2);
    assert.strictEqual(fs.readFileSync(file, 'utf8').trim().split('\n').length, 1);
});

test('start: a repository never set up below a stamped root', () =>
{
    const t = W();
    store(t.root, 'a', 'M-A');
    const tool = path.join(t.root, 'tool');
    fs.mkdirSync(path.join(tool, '.git'), { recursive: true });
    const before = listing(tool);
    const text = part(tool, 1, START(), { CLAUDE_PLUGIN_ROOT: ROOT });
    assert.ok(text.includes('## a (../.alfred/stack/rules/a.md)') && text.includes('M-A'), text);
    assert.deepStrictEqual(listing(tool), before);
});

test('path rule: sent once for a matching file, not for a file outside its globs', () =>
{
    const p = project({ ts: TS });
    const res = run(p, [], READ(path.join(p, 'src', 'a.ts')));
    assert.strictEqual(JSON.parse(res.stdout).hookSpecificOutput.hookEventName, 'PostToolUse');
    const text = ctx(res);
    assert.ok(text.startsWith('Project path rules - binding instructions for this project\n') && count(text, 'M-TS') === 1, text);
    assert.strictEqual(touch(p, path.join(p, 'src', 'b.ts')), '');
    assert.strictEqual(touch(p, path.join(p, 'a.md')), '');
});

test('path rule: again after a compaction and after a clear', () =>
{
    const p = project({ ts: TS });
    assert.ok(touch(p, path.join(p, 'a.ts')).includes('M-TS'));
    for (const s of ['compact', 'clear'])
    {
        assert.strictEqual(touch(p, path.join(p, 'a.ts')), '', `recorded before ${s}`);
        part(p, 1, START(s));
        assert.ok(touch(p, path.join(p, 'a.ts')).includes('M-TS'), `after ${s}`);
    }
    part(p, 1, START('resume'));
    assert.strictEqual(touch(p, path.join(p, 'a.ts')), '');
});

test('path rule: each actor has its own record', () =>
{
    const p = project({ ts: TS });
    assert.ok(touch(p, path.join(p, 'a.ts')).includes('M-TS'));
    assert.ok(touch(p, path.join(p, 'a.ts'), { agent_id: 'agent-a1' }).includes('M-TS'));
    assert.strictEqual(touch(p, path.join(p, 'a.ts'), { agent_id: 'agent-a1' }), '');
});

test('path rule: the record written, read, and unreadable', () =>
{
    const p = project({ ts: TS });
    touch(p, path.join(p, 'a.ts'));
    const record = LAYOUT.statePath(p, 'sessions', `rules-${SID}-main.json`, {});
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(record, 'utf8')), { sent: ['ts'] });
    fs.rmSync(record);
    fs.mkdirSync(record);
    for (const n of [1, 2]) assert.ok(touch(p, path.join(p, 'a.ts')).includes('M-TS'), String(n));
});

test('path rule: two calls in parallel', async () =>
{
    const p = project({ ts: TS });
    const input = JSON.stringify({ session_id: SID, cwd: p, ...READ(path.join(p, 'a.ts')) });
    const one = () => new Promise((resolve) =>
    {
        const c = spawn(process.execPath, [LOADER], { env: envFor(p) });
        let out = '';
        c.stdout.on('data', (d) => { out += d; });
        c.on('close', () => resolve(out));
        c.stdin.end(input);
    });
    const outs = await Promise.all([one(), one()]);
    assert.ok(count(outs.join(''), 'M-TS') >= 1);
    const record = LAYOUT.statePath(p, 'sessions', `rules-${SID}-main.json`, {});
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(record, 'utf8')).sent, ['ts']);
});

test('path rule: a file under the rule\'s project is matched from that root, another from its own checkout', () =>
{
    const t = W();
    store(t.root, 'src', '---\npaths: ["**/src/*.ts"]\n---\nM-SRC');
    assert.ok(touch(t.api, path.join(t.api, 'src', 'a.ts')).includes('M-SRC'));
    const u = W();
    store(u.root, 'src', '---\npaths: ["src/*.ts"]\n---\nM-SRC');
    const other = path.join(tree({ 'o/.git/HEAD': 'x' }), 'o');
    assert.ok(touch(u.api, path.join(other, 'src', 'a.ts')).includes('M-SRC'));
    const loose = path.join(fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'loose-'))), 'src', 'a.ts');
    const v = W();
    store(v.root, 'src', '---\npaths: ["**/*.ts"]\n---\nM-SRC');
    assert.strictEqual(touch(v.api, loose), '');
    assert.strictEqual(touch(v.api, path.join(v.api, 'gone', 'x.md')), '');
});

test('path rule: at most PART_ROOM per call, the rest on the next touch', () =>
{
    const body = (m) => `---\npaths: ["**/*.ts"]\n---\n${m}\n${'y'.repeat(3990)}`;
    const p = project({ r1: body('M-1'), r2: body('M-2'), r3: body('M-3') });
    const first = touch(p, path.join(p, 'a.ts'));
    assert.ok(first.length <= 9500 && ['M-1', 'M-2', 'M-3'].filter((m) => first.includes(m)).length === 2, String(first.length));
    const second = touch(p, path.join(p, 'b.ts'));
    assert.strictEqual(['M-1', 'M-2', 'M-3'].filter((m) => second.includes(m)).length, 1);
});

test('path rule: a rule larger than the room is cut and marked sent', () =>
{
    const p = project({ big: `---\npaths: ["**/*.ts"]\n---\n${rule('big', 20000).text}` });
    const text = touch(p, path.join(p, 'a.ts'));
    assert.ok(text.length <= 9500, String(text.length));
    assert.ok(text.endsWith('(cut at 9500 characters - read .alfred/stack/rules/big.md for the rest)'), text.slice(-120));
    assert.strictEqual(touch(p, path.join(p, 'b.ts')), '');
});

test('loader: the rules are sent with rules-session in ALFRED_CODE_HOOKS_OFF and under the minimal profile', () =>
{
    for (const off of [{ ALFRED_CODE_HOOKS_OFF: 'rules-session' }, { CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'minimal' }])
    {
        const p = project({ a: 'M-A', ts: TS });   // a fresh session record each: a path rule goes once per session
        assert.ok(part(p, 1, START(), off).includes('M-A'), JSON.stringify(off));
        assert.ok(touch(p, path.join(p, `${Object.keys(off)[0]}.ts`), {}, off).includes('M-TS'), JSON.stringify(off));
    }
});

test('handler: garbage or empty stdin, an unknown event, --part 9', () =>
{
    const p = project({ a: 'M-A' });
    for (const input of ['', '{', '[]', 'null']) assert.strictEqual(ctx(run(p, ['--part', '1'], input)), '', JSON.stringify(input));
    assert.strictEqual(part(p, 1, { hook_event_name: 'Stop' }), '');
    assert.strictEqual(part(p, 9), '');
});

// Review 1 fixes.
test('rulesFor: an unreadable rule is skipped and named, the others still load', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () =>
{
    const p = project({ a: 'M-A', b: 'M-B' });
    fs.chmodSync(path.join(p, '.alfred', 'stack', 'rules', 'b.md'), 0);
    const r = at(p);
    assert.deepStrictEqual(names(r.always), ['a']);
    assert.ok(r.notes.includes('rule skipped: .alfred/stack/rules/b.md - not read'), r.notes.join('|'));
    assert.ok(part(p, 1).includes('M-A'));
});

test('path rule: a Cursor postToolUse keys its record by the conversation', () =>
{
    const p = project({ ts: TS });
    const cursorRead = { hook_event_name: 'postToolUse', cursor_version: '1.7.0', conversation_id: 'conv-1', tool_name: 'Read', tool_input: { file_path: path.join(p, 'a.ts') } };
    const send = () => ctx(run(p, [], JSON.stringify({ cwd: p, ...cursorRead })));
    assert.ok(send().includes('M-TS'));
    assert.strictEqual(send(), '');
});

test('pathsOf: a block list written at column 0', () =>
    assert.deepStrictEqual(loader().pathsOf('---\npaths:\n- "**/*.ts"\n- src/**\n---\nx'), ['**/*.ts', 'src/**']));

// Review 2 fix.
test('path rule: a project with no .git reached through a symlinked path', { skip: process.platform === 'win32' }, () =>
{
    const top = tree({ 'real/p/.claude/alfred-code.stamp': 'source: test\n', 'real/p/.alfred/stack/rules/ts.md': '---\npaths: ["src/**"]\n---\nM-SRC' });
    const via = path.join(top, 'via');
    fs.symlinkSync(path.join(top, 'real'), via);
    const p = path.join(via, 'p');
    assert.ok(touch(p, path.join(p, 'src', 'a.ts')).includes('M-SRC'));
});

// Task 4 of stage 4c: workspace.js status prints the loader's notes, its unsent rules and what stops it, one rules: line each.
const WS_CLI = path.join(ROOT, 'scripts', 'workspace.js');
const status = (dir, extra) => spawnSync(process.execPath, [WS_CLI, 'status', '--root', dir], { encoding: 'utf8', env: envFor(dir, extra) }).stdout;

test('status: a refused ignore of a locked rule, an unmatched glob, a skipped link and an unsent rule each print one rules: line', () =>
{
    const name = loader().LOCKED_RULES[0];
    const t = W({ apiIgnore: [name] });
    store(t.root, name);
    assert.match(status(t.api), new RegExp(`^rules: ignore rule ${name} not honoured: the rule is locked$`, 'm'));
    const g = project({ g: '---\npaths: ["**/*.{a,b}"]\n---\nglob rule' });
    assert.match(status(g), /^rules: glob not matched: \*\*\/\*\.\{a,b\} in \.alfred\/stack\/rules\/g\.md$/m);
    if (process.platform !== 'win32')
    {
        const l = project();
        fs.writeFileSync(path.join(path.dirname(l), 'other.md'), 'linked');
        fs.symlinkSync(path.join(path.dirname(l), 'other.md'), path.join(l, '.alfred', 'stack', 'rules', 'link.md'));
        assert.match(status(l), /^rules: rule skipped: \.alfred\/stack\/rules\/link\.md - a link$/m);
    }
    const rs = [1, 2, 3, 4, 5, 6].map((k) => rule(`r${k}`, ROOM([rule(`r${k}`, 1)])));
    const u = project(Object.fromEntries(rs.map((r) => [r.name, r.text])));
    const out = status(u);
    for (const r of rs.slice(4)) assert.match(out, new RegExp(`^rules: not sent - ${r.rel.replace(/\./g, '\\.')}$`, 'm'));
});

test('status: rules-session in the off-list prints its line, and a disableAllHooks true in the project, the local and the user settings file prints one line naming each file', () =>
{
    const p = project({ a: 'M-A' });
    assert.match(status(p, { ALFRED_CODE_HOOKS_OFF: 'rules-session' }),
        /^rules: rules-session is named in the off-list - it carries the project's rules and still runs; leave a rule out with ignore rule$/m);
    assert.doesNotMatch(status(p), /^rules: /m, 'a clean project prints none');
    const user = path.join(HOME_DIR, '.claude', 'settings.json');
    const local = ['.claude', 'settings.local.json'];
    for (const f of [path.join(p, '.claude', 'settings.json'), path.join(p, ...local), user])
    {
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, JSON.stringify({ disableAllHooks: true }));
    }
    try
    {
        const out = status(p);
        for (const f of ['.claude/settings.json', local.join('/'), user])
            assert.ok(out.split('\n').includes(`rules: disableAllHooks is true in ${f}`), `${f}\n${out}`);
    }
    finally { fs.unlinkSync(user); }
});

// ---- stage 5: a joined member's block on the first touch under it ----------------------------------------------------
const mkey = (rel) => require('node:crypto').createHash('sha256').update(rel).digest('hex').slice(0, 12);
const sessionsDir = (root) => LAYOUT.statePath(root, 'sessions', '', {});
const marker = (root, rel, k, actor = 'main', sid = SID) => path.join(sessionsDir(root), `rules-${sid}-${actor}-m-${mkey(rel)}-${k}`);
const memberMarkers = (root) => { try { return fs.readdirSync(sessionsDir(root)).filter((f) => f.includes('-m-')); } catch { return []; } };
const LINE1 = (t) => `Rules and data of ${t}. Binding for work under ${t}, in addition to the workspace's rules.`;
const DONE = (t, k) => `End of project ${t}, part ${k} - complete`;
const MORE = (t, k) => `End of project ${t}, part ${k} - more follows on the next file touch under ${t}`;
const big = (n, mark) => `${mark}\n${'y'.repeat(99).concat('\n').repeat(Math.ceil(n / 100))}`.slice(0, n);
function M(opts = {})
{
    const w = W(opts);
    store(w.root, 'base', 'M-BASE');
    return w;
}

test('member: nothing of a child is sent at the root\'s start', () =>
{
    const w = M();
    store(w.api, 'own', 'M-API');
    for (let k = 1; k <= 5; k++) assert.ok(!part(w.root, k).includes('M-API'), `part ${k}`);
});

test('member: the first touch under a child sends its block once, lines in order', () =>
{
    const w = M();
    put(path.join(w.api, 'AGENTS.md'), 'agents');
    native(w.api, 'gen');
    fs.mkdirSync(path.join(w.api, '.alfred', 'docs', 'preferences'), { recursive: true });
    store(w.api, 'own', 'M-API');
    const text = touch(w.root, path.join(w.api, 'src', 'a.txt'));
    assert.strictEqual(text, ['Project api, part 1', [LINE1('api'),
        'Instructions of this project: api/AGENTS.md - Read it before working here, unless it is already in your context.',
        'Rule files of this project: api/.claude/rules/gen.md - Read each one that is not already in your context before working here.',
        'Docs of this project: api/.alfred/docs - read its map before designing or editing here.',
        'Preferences of this project: api/.alfred/docs/preferences - for files under api they come before the workspace\'s.'].join('\n'),
    '## own (api/.alfred/stack/rules/own.md)\nM-API', DONE('api', 1)].join('\n\n'));
    assert.deepStrictEqual(fs.readFileSync(marker(w.root, 'api', 1), 'utf8').trim().split('\n'), [`/ api ${text.length} ${SID} main`, '#head', 'own']);
    assert.strictEqual(touch(w.root, path.join(w.api, 'src', 'b.txt')), '');
});

test('member: a bare member sends the opening, line 1 and the closing only; CLAUDE.md is named when there is no AGENTS.md', () =>
{
    const w = M();
    fs.mkdirSync(path.join(w.api, '.alfred', 'stack', 'rules'), { recursive: true });
    assert.strictEqual(touch(w.root, path.join(w.api, 'a.txt')), ['Project api, part 1', LINE1('api'), DONE('api', 1)].join('\n\n'));
    const v = M();
    put(path.join(v.api, 'CLAUDE.md'), 'claude');
    assert.ok(touch(v.root, path.join(v.api, 'a.txt')).includes('Instructions of this project: api/CLAUDE.md - Read it'));
});

test('member: no skill or agent is named', () =>
{
    const w = M();
    put(path.join(w.api, '.alfred', 'stack', 'skills', 'x', 'SKILL.md'), 'skill');
    put(path.join(w.api, '.alfred', 'stack', 'agents', 'y.md'), 'agent');
    const text = touch(w.root, path.join(w.api, 'a.txt'));
    assert.ok(text.includes('Project api, part 1') && !text.includes('SKILL.md') && !text.includes('stack/agents'), text);
});

test('member: a grandchild\'s touch sends its parent\'s block, then its own', () =>
{
    const w = M();
    const text = touch(w.root, path.join(w.lib, 'a.txt'));
    assert.strictEqual(count(text, 'Project api, part 1'), 1);
    assert.strictEqual(count(text, 'Project api/lib, part 1'), 1);
    assert.ok(text.indexOf('Project api, part 1') < text.indexOf('Project api/lib, part 1'));
    assert.strictEqual(touch(w.root, path.join(w.api, 'b.txt')), '');
});

test('member: two grandchildren under one child send the child\'s block once', () =>
{
    const w = M({ lib2: true });
    assert.ok(touch(w.root, path.join(w.lib, 'a.txt')).includes('Project api, part 1'));
    const second = touch(w.root, path.join(w.lib2, 'a.txt'));
    assert.ok(!second.includes('Project api,') && second.includes('Project api/lib2, part 1'), second);
});

test('member: a same-named rule takes the replaces heading', () =>
{
    const w = M();
    store(w.api, 'base', 'M-API-BASE');
    assert.ok(touch(w.root, path.join(w.api, 'a.txt'))
        .includes('## base (api/.alfred/stack/rules/base.md) - replaces the workspace\'s rule of this name for files under api\nM-API-BASE'));
});

test('member: a rule the child leaves out is named on line 6, a locked one never', () =>
{
    const w = M({ apiIgnore: ['base', 'alfred-security'] });
    store(w.root, 'alfred-security', 'M-SEC');
    const text = touch(w.root, path.join(w.api, 'a.txt'));
    assert.ok(text.includes('This project leaves out: base - do not apply them to files under api.'), text);
});

test('member: a block of two parts goes over two touches, nothing twice', () =>
{
    const w = M();
    store(w.api, 'a', big(6000, 'M-A'));
    store(w.api, 'b', big(6000, 'M-B'));
    const one = touch(w.root, path.join(w.api, '1.txt'));
    const two = touch(w.root, path.join(w.api, '2.txt'));
    assert.ok(one.endsWith(MORE('api', 1)), one.slice(-120));
    assert.ok(two.startsWith('Project api, part 2') && two.endsWith(DONE('api', 2)), two.slice(-120));
    assert.strictEqual(touch(w.root, path.join(w.api, '3.txt')), '');
    assert.strictEqual(count(one + two, 'M-A'), 1);
    assert.strictEqual(count(one + two, 'M-B'), 1);
});

test('member: a rule added between two parts is sent, none twice', () =>
{
    const w = M();
    store(w.api, 'a', big(6000, 'M-A'));
    store(w.api, 'b', big(6000, 'M-B'));
    touch(w.root, path.join(w.api, '1.txt'));
    store(w.api, 'c', 'M-C');
    const rest = touch(w.root, path.join(w.api, '2.txt')) + touch(w.root, path.join(w.api, '3.txt'));
    assert.strictEqual(count(rest, 'M-B'), 1);
    assert.strictEqual(count(rest, 'M-C'), 1);
});

test('member: part 5 with a rule left names it and stays inside the room', () =>
{
    const w = M();
    for (const n of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']) store(w.api, n, big(9000, `M-${n}`));
    const outs = [1, 2, 3, 4, 5, 6].map((k) => touch(w.root, path.join(w.api, `${k}.txt`)));
    assert.match(outs[4], /Not sent - past part 5: api\/\.alfred\/stack\/rules\/r\d\.md/);
    assert.ok(outs[4].length <= 9500, String(outs[4].length));
    assert.ok(outs[4].endsWith(DONE('api', 5)));
    assert.strictEqual(outs[5], '');
});

test('memberPart: at the room, one under, one over', () =>
{
    const { memberPart } = loader();
    const room = 2000;
    const fixed = 'Project api, part 1'.length + 2 + 'H'.length + 2 + 2 + DONE('api', 1).length;
    const items = (n) => [{ name: '#head', text: 'H' }, { name: 'r', rel: 'api/r.md', text: 'x'.repeat(n) }];
    for (const [n, left] of [[room - fixed, 0], [room - fixed - 1, 0], [room - fixed + 1, 1]])
    {
        const got = memberPart('api', items(n), null, room, `${SID} main`);
        assert.strictEqual(got.left, left, `${n}`);
        assert.ok(got.text.length <= room);
    }
});

test('member: a rule larger than a part is cut at a line end and counts as sent', () =>
{
    const w = M();
    store(w.api, 'huge', big(12000, 'M-HUGE'));
    const one = touch(w.root, path.join(w.api, '1.txt'));
    const two = touch(w.root, path.join(w.api, '2.txt'));
    assert.ok(one.includes(LINE1('api')) && one.endsWith(MORE('api', 1)) && !one.includes('M-HUGE'), one.slice(0, 300));
    assert.ok(two.endsWith(`(cut at 9500 characters - read api/.alfred/stack/rules/huge.md for the rest)\n\n${DONE('api', 2)}`), two.slice(-200));
    assert.ok(two.length <= 9500);
    assert.strictEqual(touch(w.root, path.join(w.api, '3.txt')), '');
});

test('member: a session started below the workspace root names the member from its own folder', () =>
{
    const w = M({ web: true });
    store(w.web, 'own', 'M-WEB');
    const text = touch(w.api, path.join(w.web, 'a.txt'));
    assert.ok(text.startsWith('Project ../web, part 1'), text.slice(0, 80));
    assert.ok(text.includes('## own (../web/.alfred/stack/rules/own.md)\nM-WEB'), text);
});

test('member: eight calls at once print part 1 exactly once', async () =>
{
    const w = M();
    store(w.api, 'own', 'M-API');
    const input = JSON.stringify({ session_id: SID, cwd: w.root, ...READ(path.join(w.api, 'a.txt')) });
    const one = () => new Promise((resolve) =>
    {
        const c = spawn(process.execPath, [LOADER], { env: envFor(w.root) });
        let out = '';
        c.stdout.on('data', (d) => { out += d; });
        c.on('close', () => resolve(out));
        c.stdin.end(input);
    });
    const outs = await Promise.all(Array.from({ length: 8 }, one));
    assert.strictEqual(count(outs.join(''), 'Project api, part 1'), 1);
    assert.deepStrictEqual(memberMarkers(w.root), [path.basename(marker(w.root, 'api', 1))]);
});

test('member: a marker found empty prints nothing and makes no second marker', () =>
{
    const w = M();
    put(marker(w.root, 'api', 1), '');
    assert.strictEqual(touch(w.root, path.join(w.api, 'a.txt')), '');
    assert.ok(!fs.existsSync(marker(w.root, 'api', 2)));
});

test('member: a marker folder that cannot be written still sends the part; no session id sends part 1 every touch', () =>
{
    const w = M();
    put(sessionsDir(w.root).replace(/[\\/]$/, ''), 'not a folder');
    for (const n of [1, 2]) assert.ok(touch(w.root, path.join(w.api, `${n}.txt`)).includes('Project api, part 1'), `touch ${n}`);
    const v = M();
    for (const n of [1, 2]) assert.ok(touch(v.root, path.join(v.api, `${n}.txt`), { session_id: undefined }).includes('Project api, part 1'));
    assert.deepStrictEqual(memberMarkers(v.root), []);
});

test('member: two members in one session; the main actor and an agent each get it once', () =>
{
    const w = M({ web: true });
    assert.ok(touch(w.root, path.join(w.api, 'a.txt')).includes('Project api, part 1'));
    assert.ok(touch(w.root, path.join(w.web, 'a.txt')).includes('Project web, part 1'));
    assert.ok(touch(w.root, path.join(w.api, 'b.txt'), { agent_id: 'agent-x1' }).includes('Project api, part 1'));
    assert.strictEqual(touch(w.root, path.join(w.api, 'c.txt'), { agent_id: 'agent-x1' }), '');
    assert.strictEqual(touch(w.root, path.join(w.api, 'd.txt')), '');
});

test('member: a session started in a child gets its sibling\'s block', () =>
{
    const w = M({ web: true });
    assert.ok(touch(w.api, path.join(w.web, 'a.txt')).includes('Project ../web, part 1'));
});

test('member: a touch outside the workspace, under an unjoined project and under a garbage child sends nothing and writes no marker', () =>
{
    const w = M({ web: true });
    const loose = path.join(w.root, 'loose');
    put(path.join(loose, '.git', 'HEAD'), 'x');
    stamp(loose);
    store(loose, 'own', 'M-LOOSE');
    fs.writeFileSync(path.join(w.web, '.alfred', 'workspace.json'), '{');
    for (const f of [path.join(os.tmpdir(), 'a.txt'), path.join(loose, 'a.txt'), path.join(w.web, 'a.txt')])
        assert.strictEqual(touch(w.root, f), '', f);
    assert.deepStrictEqual(memberMarkers(w.root), []);
});

test('member: a compact and a clear start delete the markers and the block is sent again; a resume keeps them', () =>
{
    const w = M();
    const send = (n) => touch(w.root, path.join(w.api, `${n}.txt`));
    assert.ok(send(1).includes('Project api, part 1'));
    part(w.root, 1, START('resume'));
    assert.strictEqual(send(2), '');
    for (const source of ['compact', 'clear'])
    {
        part(w.root, 1, START(source));
        assert.deepStrictEqual(memberMarkers(w.root), [], source);
        assert.ok(send(3).includes('Project api, part 1'), source);
    }
});

test('member: creating a marker sweeps the rules- prefix', () =>
{
    const w = M();
    const old = path.join(sessionsDir(w.root), 'rules-old-main-m-000000000000-1');
    put(old, '/ x 1 old main\n#head\n');
    const t = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    fs.utimesSync(old, t, t);
    assert.ok(touch(w.root, path.join(w.api, 'a.txt')).includes('Project api, part 1'));
    assert.ok(!fs.existsSync(old));
});

test('member: a Cursor payload prints the same text in Cursor\'s field', () =>
{
    const w = M();
    store(w.api, 'own', 'M-API');
    const claude = touch(w.root, path.join(w.api, 'a.txt'));
    const v = M();
    store(v.api, 'own', 'M-API');
    const cursorRead = { hook_event_name: 'postToolUse', cursor_version: '1.7.0', conversation_id: 'conv-1', tool_name: 'Read',
        tool_input: { file_path: path.join(v.api, 'a.txt') } };
    assert.strictEqual(ctx(run(v.root, [], JSON.stringify({ cwd: v.root, ...cursorRead }))), claude);
});

test('member: the ledger row\'s five fields', () =>
{
    const w = M();
    const text = touch(w.root, path.join(w.api, 'a.txt'));
    const rows = fs.readFileSync(LAYOUT.statsPath(w.root, ['hook-blocks', `${SID}.jsonl`], {}), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const row = rows[rows.length - 1];
    assert.deepStrictEqual([row.kind, row.member, row.part, row.chars, row.unsent, row.tool], ['member-push', 'api', 1, text.length, 0, 'Read']);
});

// ---- stage 5: a joined member's path rules -----------------------------------------------------------------------------
const scoped = (glob, mark, n = 0) => `---\npaths: ["${glob}"]\n---\n${mark}${n ? `\n${big(n, 'y')}` : ''}`;
const sentOf = (root) => JSON.parse(fs.readFileSync(LAYOUT.statePath(root, 'sessions', `rules-${SID}-main.json`, {}), 'utf8')).sent;

test('member path rule: sent on the first matching touch under the member, once, matched from the member\'s root', () =>
{
    const w = M();
    store(w.api, 'ts', scoped('src/**/*.ts', 'M-API-TS'));
    const one = touch(w.root, path.join(w.api, 'src', 'a.ts'));
    assert.ok(one.indexOf('Project api, part 1') < one.indexOf('## ts (api/.alfred/stack/rules/ts.md)\nM-API-TS'), one);
    assert.ok(one.indexOf('## ts (api/') > 0);
    assert.strictEqual(touch(w.root, path.join(w.api, 'src', 'b.ts')), '');
    assert.ok(!touch(w.root, path.join(w.root, 'src', 'a.ts')).includes('M-API-TS'));
});

test('member path rule: a middle member\'s rule is sent once over a grandchild\'s touch, then its parent\'s', () =>
{
    for (const order of [['lib', 'api'], ['api', 'lib']])
    {
        const w = M();
        store(w.api, 'ts', scoped('**/*.ts', 'M-API-TS'));
        const outs = order.map((d) => touch(w.root, path.join(w[d], 'a.ts')));
        assert.strictEqual(count(outs.join(''), 'M-API-TS'), 1, order.join());
        assert.deepStrictEqual(sentOf(w.root), [`${mkey('api')}/ts`], order.join());
    }
});

test('member path rule: a cut rule\'s tail line names the path from the start folder', () =>
{
    const w = M();
    store(w.api, 'ts', scoped('src/**/*.ts', 'M-API-TS', 12000));
    touch(w.root, path.join(w.api, 'a.txt'));
    assert.ok(touch(w.root, path.join(w.api, 'src', 'a.ts')).endsWith('(cut at 9500 characters - read api/.alfred/stack/rules/ts.md for the rest)'));
});

test('member path rule: a rule the child ignores is not sent for its file and still sent for the root\'s', () =>
{
    const w = M({ apiIgnore: ['ts'] });
    store(w.root, 'ts', scoped('**/*.ts', 'M-ROOT-TS'));
    assert.ok(!touch(w.root, path.join(w.api, 'a.ts')).includes('M-ROOT-TS'));
    assert.ok(touch(w.root, path.join(w.root, 'a.ts')).includes('M-ROOT-TS'));
});

test('member path rule: the child\'s own copy for its file, the root\'s for the root\'s, each once', () =>
{
    const w = M();
    store(w.root, 'ts', scoped('**/*.ts', 'M-ROOT-TS'));
    store(w.api, 'ts', scoped('**/*.ts', 'M-API-TS'));
    const a = touch(w.root, path.join(w.api, 'a.ts'));
    assert.ok(a.includes('M-API-TS') && !a.includes('M-ROOT-TS'), a);
    assert.ok(touch(w.root, path.join(w.root, 'a.ts')).includes('M-ROOT-TS'));
    assert.strictEqual(touch(w.root, path.join(w.api, 'b.ts')) + touch(w.root, path.join(w.root, 'b.ts')), '');
    assert.deepStrictEqual(sentOf(w.root), [`${mkey('api')}/ts`, 'ts']);
});

test('member path rule: block and path rule in one call stay inside PART_ROOM', () =>
{
    const w = M();
    store(w.api, 'own', big(9000, 'M-OWN'));
    store(w.api, 'ts', scoped('**/*.ts', 'M-API-TS', 2000));
    const one = touch(w.root, path.join(w.api, 'a.ts'));
    assert.ok(one.length <= 9500 && one.includes('M-OWN') && !one.includes('M-API-TS'), String(one.length));
    assert.ok(touch(w.root, path.join(w.api, 'b.ts')).includes('M-API-TS'));
});

test('path rule: a start-chain record written before this change still reads', () =>
{
    const w = M();
    store(w.root, 'ts', scoped('**/*.ts', 'M-ROOT-TS'));
    put(LAYOUT.statePath(w.root, 'sessions', `rules-${SID}-main.json`, {}), JSON.stringify({ sent: ['ts'] }));
    assert.strictEqual(touch(w.root, path.join(w.root, 'a.ts')), '');
});
