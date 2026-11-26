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

// Layered native rules, Task 3: one --part 1 row per start event, no PostToolUse row.
test('rows: the plugin entry carries --part 1 for both start events, parts 2-5 for SessionStart only (Cursor), no PostToolUse row', () =>
{
    const core = JSON.parse(fs.readFileSync(ENTRIES, 'utf8')).entries.find((p) => p.name === 'alfred-code');
    const mine = (event) => (core.hooks[event] || []).flatMap((b) => b.hooks.map((h) => ({ matcher: b.matcher, args: h.args || [] })))
        .filter((r) => r.args[0] === '${CLAUDE_PLUGIN_ROOT}/stack/hooks/rules-session.js');
    assert.deepStrictEqual(mine('SessionStart').map((r) => r.args.slice(1)), [1, 2, 3, 4, 5].map((k) => ['--part', String(k)]));
    assert.deepStrictEqual(mine('SubagentStart').map((r) => r.args.slice(1)), [['--part', '1']]);
    assert.deepStrictEqual(mine('PostToolUse'), []);
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
const ROOM = (rules) => 9900 - OPEN(1, 1).length - CLOSE(1, 1).length - 2 * (rules.length + 1) - rules.reduce((s, r) => s + heading(r).length + 1, 0);
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

// The edit reminder matches a rule's paths the way Claude Code does (card: '**/', a leading '/', braces).
test('pathGlob: braces, a leading slash, ? and a class match; a negation gives null', () =>
{
    const { pathGlob } = loader();
    const m = (glob, file) => pathGlob(glob).test(file);
    assert.ok(m('**/*.{ts,tsx}', 'a/b.ts') && m('**/*.{ts,tsx}', 'b.tsx') && !m('**/*.{ts,tsx}', 'b.tsxx'));
    assert.ok(m('src/{api,web}/**', 'src/web/x/y.ts') && !m('src/{api,web}/**', 'src/cli/y.ts'));
    assert.ok(m('/src/*.cs', 'src/a.cs') && !m('/src/*.cs', 'x/src/a.cs'), 'a leading slash anchors at the rule\'s folder');
    assert.ok(m('a?.ts', 'ab.ts') && !m('a?.ts', 'a/.ts') && !m('a?.ts', 'abc.ts'));
    assert.ok(m('[ab].ts', 'a.ts') && !m('[ab].ts', 'c.ts'));
    assert.ok(m('**/*.{cs,{csproj,props}}', 'x/Directory.props'), 'nested braces');
    assert.strictEqual(pathGlob('!x.ts'), null);
    assert.strictEqual(pathGlob('{a,b'), null, 'an unclosed brace');
});

// The key line of a rule (card: the first sentence after HTML comments, multi-line ones included, and headings, ~240 chars).
test('keyLine: the first sentence past frontmatter, headings and multi-line HTML comments, capped', () =>
{
    const { keyLine } = loader();
    const rule = '---\npaths:\n  - "**/*.cs"\n---\n<!-- a comment\nover two lines. -->\n# C# conventions\n\nEditing C# - load `csharp` first. Then the rest.\n';
    assert.strictEqual(keyLine(rule), 'Editing C# - load `csharp` first.');
    assert.strictEqual(keyLine('# T\n<!-- one -->text <!-- inline -->runs on\nacross lines. Next.'), 'text runs on across lines.');
    assert.strictEqual(keyLine('Calls `node a.js` and e.g. stops here. Not this.'), 'Calls `node a.js` and e.g. stops here.', 'a dot inside code or before a letter is no end');
    const long = `${'word '.repeat(80)}end.`;
    const k = keyLine(long);
    assert.ok(k.length <= 240 && k.endsWith(', ...'), k);
    assert.strictEqual(keyLine('---\npaths: x\n---\n<!-- only -->\n# Heading\n'), '');
    assert.strictEqual(keyLine('```\ncode. block.\n```\nAfter the fence.'), 'After the fence.', 'a fenced block is no sentence');
});

test('parts: at PART_ROOM, one under, one over', () =>
{
    const { parts, PART_ROOM } = loader();
    assert.strictEqual(PART_ROOM, 9900);
    const r = rule('r1', ROOM([rule('r1', 1)]));
    assert.strictEqual(parts([r]).parts.length, 1);
    assert.strictEqual(parts([r]).parts[0].length, 9900);
    assert.strictEqual(parts([rule('r1', r.text.length - 1)]).parts[0].length, 9899);
    const over = parts([rule('r1', r.text.length + 1)]).parts;
    assert.strictEqual(over.length, 2);
    assert.ok(over[1].startsWith(`${OPEN(2, 2)}\n\n## r1 (.alfred/stack/rules/r1.md) - continued\n`), over[1].slice(0, 120));
    for (const p of over) assert.ok(p.length <= 9900, String(p.length));
});

test('parts: every part ends with its closing line and counts it', () =>
{
    const out = loader().parts(shippedPathless()).parts;
    out.forEach((p, i) =>
    {
        assert.ok(p.startsWith(OPEN(i + 1, out.length)), p.slice(0, 80));
        assert.ok(p.endsWith(CLOSE(i + 1, out.length)), p.slice(-60));
        assert.ok(p.length <= 9900, String(p.length));
    });
});

test('parts: the six shipped rules fit three parts', () =>
{
    const rules = shippedPathless();
    assert.strictEqual(rules.length, 6, rules.map((r) => r.name).join());
    const { parts: out, unsent } = loader().parts(rules, { natives: ['alfred-rules'] });   // an install's part 1 carries the canary's line
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

// 2026-11-22 (make room rather than cut a rule, the user's ruling): a cut rule's last chunk leaves room in its part, and a
// rule that fits there joins it - a 1,352-char tail held a whole part and pushed the shipped rules from 3 parts to 4.
test('parts: a cut rule\'s last chunk shares its part with a rule that fits beside it', () =>
{
    const big = rule('big', 11000);
    const small = rule('small', 3000);
    const out = loader().parts([big, small]).parts;
    assert.strictEqual(out.length, 2, 'the tail and the small rule share part 2');
    assert.ok(out[1].includes('## big (') && out[1].includes(' - continued\n') && out[1].includes('## small ('), out[1].slice(0, 300));
    for (const p of out) assert.ok(p.length <= 9900, String(p.length));
    const full = rule('full', 9000);
    const three = loader().parts([big, full]).parts;
    assert.strictEqual(three.length, 3, 'a rule with no room beside the tail opens its own part');
    assert.ok(!three[0].includes('## full (') && !three[1].includes('## full ('), 'the first chunk\'s part stays the chunk\'s alone');
});

test('parts: cut applies the lead room to the first chunk only', () =>
{
    const r = rule('big', 20000);
    const lead = 'y'.repeat(600);
    const out = loader().parts([r], { index: lead }).parts;
    assert.strictEqual(out.length, 3);
    for (const p of out) assert.ok(p.length <= 9900, String(p.length));
    assert.ok(out[0].length >= 9900 - 600 - 160 && out[0].length <= 9900, `part 1 holds the lead: ${out[0].length}`);
    assert.ok(out[1].length > 9900 - 200, `part 2 is a full chunk, no lead taken from it: ${out[1].length}`);
    const chunks = out.map((p) => p.split('\n\n').filter((b) => !b.startsWith('Project rules') && !b.startsWith('End of') && b !== lead).join('\n\n').replace(/^## big \([^)]*\)( - continued)?\n/, ''));
    assert.strictEqual(chunks.join('\n'), r.text);
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
    assert.ok(out[4].length <= 9900);
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

test('rulesFor: a rule the top keeps for a set-aside child loads in that child, and not in a sibling', () =>
{
    const t = W({ web: true });
    ws(t.root, { parent: 'root', children: ['api', 'web'], includeAsked: ['api'], keptFor: { api: ['rule angular-conventions'] } });
    stamp(t.root, ['member-picks: rule/angular-conventions']);
    store(t.root, 'angular-conventions');
    store(t.root, 'q');
    assert.deepStrictEqual(names(at(t.api).always), ['angular-conventions', 'q']);
    assert.deepStrictEqual(names(at(t.lib).always), ['angular-conventions', 'q'], 'a project below the child reads the same keep');
    assert.deepStrictEqual(names(at(t.web).always), ['q']);
    stamp(t.root, ['member-picks: rule/angular-conventions', 'kept-only: rule/angular-conventions']);
    assert.deepStrictEqual(names(at(t.root).always), ['q'], 'the root\'s own session sheds a kept-only rule');
    assert.deepStrictEqual(names(at(t.api).always), ['angular-conventions', 'q']);
});

test('rulesFor: a kept rule line is matched to its child the way the hook folds case', () =>
{
    const t = W({ web: true });
    ws(t.root, { parent: 'root', children: ['api', 'web'], includeAsked: ['api'], keptFor: { [process.platform === 'linux' ? 'api' : 'API']: ['rule p'] } });
    stamp(t.root, ['member-picks: rule/p']);
    store(t.root, 'p');
    assert.deepStrictEqual(names(at(t.api).always), ['p']);
    assert.deepStrictEqual(names(at(t.web).always), []);
});

test('rulesFor: a middle root\'s keep for its set-aside grandchild overrides its own ignore of the rule', () =>
{
    const t = W({ apiIgnore: ['x'], lib2: true });
    ws(t.api, { parent: '..', children: ['lib', 'lib2'], ignore: { rules: ['x'] }, includeAsked: ['lib'], keptFor: { lib: ['rule x'] } });
    stamp(t.root, ['member-picks: rule/x']);
    store(t.root, 'x');
    assert.deepStrictEqual(names(at(t.lib).always), ['x']);
    assert.deepStrictEqual(names(at(t.api).always), [], 'the middle root keeps its own ignore');
    assert.deepStrictEqual(names(at(t.lib2).always), [], 'a sibling grandchild is not kept for');
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

// W3 Task 1, P3 (F3's third walk): a folder the root's record marks ignored is sent nothing, though no install is in it.
test('rulesFor: a marked folder with no install below a stamped root is sent nothing', () =>
{
    const t = W();
    store(t.root, 'a');
    const tool = path.join(t.root, 'tool');
    fs.mkdirSync(path.join(tool, '.git'), { recursive: true });
    ws(t.root, { parent: 'root', children: ['api'], ignoredChildren: ['tool'] });
    const r = at(tool);
    assert.strictEqual(r.project, null);
    assert.deepStrictEqual(r.always, []);
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
    store(p, 'g', '---\npaths: ["!**/*.a", "**/*.c"]\n---\nglob rule');
    const r = at(p);
    assert.deepStrictEqual([names(r.always), names(r.scoped)], [[], ['g']]);
    assert.deepStrictEqual(r.scoped[0].globs, ['!**/*.a', '**/*.c']);
    assert.ok(r.notes.includes('glob not matched: !**/*.a in .alfred/stack/rules/g.md'), r.notes.join('|'));
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
    assert.strictEqual(part(project(), 1), ''));

test('start: the six shipped rules fill part 1 and the rest is named, never sent in a later part', () =>
{
    const p = project();
    const six = shippedPathless();
    for (const r of six) fs.copyFileSync(path.join(RULES_DIR, `${r.name}.md`), path.join(p, '.alfred', 'stack', 'rules', `${r.name}.md`));
    const got = part(p, 1);
    assert.ok(got.length <= 9900 && [2, 3, 4, 5].every((k) => part(p, k) === ''), String(got.length));
    const left = (/Not sent - past part 1: (.*)/.exec(got) || [])[1] || '';
    for (const r of six) assert.strictEqual(count(got, `${heading(r)}\n`) + (left.includes(r.rel) ? 1 : 0), 1, r.name);
});

test('start: resume and fork send like startup', () =>
{
    const p = project({ a: 'M-A' });
    for (const s of ['resume', 'fork', 'clear', 'compact', 'startup']) assert.ok(part(p, 1, START(s)).includes('M-A'), s);
});

test('start: a resume of a project with no store sends nothing', () =>
{
    const { api } = W();
    for (const k of [1, 2, 3, 4, 5]) assert.strictEqual(part(api, k, START('resume')), '', `part ${k}`);
});

test('start: the probe row of a resume push names its source', () =>
{
    const p = project({ a: 'M-A' });
    part(p, 1, START('resume'));
    const file = path.join(LAYOUT.statsPath(p, ['hook-blocks'], {}), `${SID}.jsonl`);
    const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.strictEqual(rows.length, 1);
    assert.deepStrictEqual([rows[0].kind, rows[0].source], ['rules-push', 'resume']);
});

// Task 6: a root's main-session start opens part 1 with the members index.
const MEMBERS_HEAD = 'Workspace members - before you plan or edit inside one, Read its instructions. Its rule files load natively when the session works in that folder; a Cursor start sends them here.';
const MEMBERS_API = '- api: instructions api/AGENTS.md; rules 1 file under api/.claude/rules';
const MEMBERS_WEB = '- web: instructions none; rules none';
const MEMBERS_MORE = (k) => `- and ${k} more (the workspace record lists them)`;
// A stamped root `ws` holding one store rule and the given children (a folder each, unless `as` says otherwise).
// A child folder holds its own record pointing back at the root (hop rule N1) unless `unlinked` names it, or `elsewhere`
// gives it a parent that is not this root.
function members(children, { ignored, as = {}, rules = { a: 'M-A' }, unlinked = [], elsewhere = [] } = {})
{
    const top = tree({ 'ws/.git/HEAD': 'x' });
    const root = path.join(top, 'ws');
    stamp(root);
    for (const [name, text] of Object.entries(rules)) store(root, name, text);
    for (const c of children)
    {
        if (as[c] === 'file') put(path.join(root, c), 'x');
        else if (as[c] !== 'missing')
        {
            fs.mkdirSync(path.join(root, c), { recursive: true });
            if (elsewhere.includes(c)) ws(path.join(root, c), { parent: '../..' });
            else if (!unlinked.includes(c)) ws(path.join(root, c), { parent: '..' });
        }
    }
    ws(root, { parent: 'root', children, ...(ignored ? { ignoredChildren: ignored } : {}) });
    return root;
}
const manyChildren = (n, size = 3) => Array.from({ length: n }, (_, i) => `c${String(i + 1).padStart(size, '0')}`);
const apiAndWeb = () =>
{
    const root = members(['api', 'web']);
    put(path.join(root, 'api', 'AGENTS.md'), 'x');
    put(path.join(root, 'api', '.claude', 'rules', 'r.md'), 'x');
    return root;
};
const indexLines = (text) => text.split('\n').filter((l) => l.startsWith('- '));

test('members: part 1 of a root opens with the index, after the natives line and before the first rule', () =>
{
    const root = apiAndWeb();
    native(root, 'n');
    const text = part(root, 1);
    const block = [MEMBERS_HEAD, MEMBERS_API, MEMBERS_WEB].join('\n');
    assert.ok(text.includes(block), text);
    assert.ok(text.indexOf('loaded natively: n') < text.indexOf(block) && text.indexOf(block) < text.indexOf('\n## '), text);
    for (const k of [2, 3, 4, 5]) assert.ok(!part(root, k).includes('Workspace members'), `part ${k}`);
});

test('members: a root with no child gets no index', () =>
{
    const root = members([]);
    assert.ok(!part(root, 1).includes('Workspace members'));
    assert.strictEqual(loader().memberIndex(root, ENV), '');
});

test('members: twelve children are twelve lines, thirteen are twelve and a count of the rest', () =>
{
    const twelve = members(manyChildren(12));
    const got12 = loader().memberIndex(twelve, ENV);
    assert.strictEqual(indexLines(got12).length, 12);
    assert.ok(!got12.includes(' more '), got12);
    const thirteen = members(manyChildren(13));
    const got13 = loader().memberIndex(thirteen, ENV).split('\n');
    assert.strictEqual(got13.length, 1 + 12 + 1);
    assert.strictEqual(got13[got13.length - 1], MEMBERS_MORE(1));
});

test('members: the index stops at 1500 characters and counts what it leaves out', () =>
{
    const root = members(manyChildren(12, 100));
    const got = loader().memberIndex(root, ENV);
    const lines = got.split('\n');
    assert.ok(got.length <= 1500, String(got.length));
    const left = 12 - (lines.length - 2);
    assert.ok(left > 0 && lines.length - 2 < 12, got);
    assert.strictEqual(lines[lines.length - 1], MEMBERS_MORE(left));
});

test('members: a child that is a file or is missing is left out', () =>
{
    const root = members(['api', 'gone', 'plain'], { as: { gone: 'missing', plain: 'file' } });
    const got = loader().memberIndex(root, ENV);
    assert.deepStrictEqual(indexLines(got), ['- api: instructions none; rules none']);
    assert.ok(part(root, 1).includes('- api:'));
});

test('members: a child the record ignores is left out', () =>
{
    const root = members(['api', 'web'], { ignored: ['web'] });
    assert.deepStrictEqual(indexLines(loader().memberIndex(root, ENV)), ['- api: instructions none; rules none']);
});

test('members: the instruction file is the first of the four spellings, and rules count by file', () =>
{
    const root = members(['a', 'b', 'c', 'd', 'e']);
    put(path.join(root, 'a', 'AGENTS.md'), 'x');
    put(path.join(root, 'a', 'CLAUDE.md'), 'x');
    put(path.join(root, 'b', 'CLAUDE.md'), 'x');
    put(path.join(root, 'c', '.claude', 'AGENTS.md'), 'x');
    put(path.join(root, 'd', '.claude', 'CLAUDE.md'), 'x');
    for (const n of ['x', 'y']) put(path.join(root, 'e', '.claude', 'rules', `${n}.md`), 'x');
    put(path.join(root, 'e', '.claude', 'rules', 'skip.txt'), 'x');
    assert.deepStrictEqual(indexLines(loader().memberIndex(root, ENV)), [
        '- a: instructions a/AGENTS.md; rules none',
        '- b: instructions b/CLAUDE.md; rules none',
        '- c: instructions c/.claude/AGENTS.md; rules none',
        '- d: instructions d/.claude/CLAUDE.md; rules none',
        '- e: instructions none; rules 2 files under e/.claude/rules']);
});

test('members: a garbage record gives no index and no throw', () =>
{
    const root = members(['api']);
    put(path.join(root, '.alfred', 'workspace.json'), '{ not json');
    assert.strictEqual(loader().memberIndex(root, ENV), '');
    assert.ok(!part(root, 1).includes('Workspace members'));
});

test('members: a child with a DIRECTORY named like the instruction file lists no instruction file', () =>
{
    const root = members(['api', 'web']);
    fs.mkdirSync(path.join(root, 'api', 'AGENTS.md'), { recursive: true });
    fs.mkdirSync(path.join(root, 'web', '.claude', 'CLAUDE.md'), { recursive: true });
    assert.deepStrictEqual(indexLines(loader().memberIndex(root, ENV)), ['- api: instructions none; rules none', '- web: instructions none; rules none']);
});

test('members: a folder named x.md under .claude/rules is no rule', () =>
{
    const root = members(['api']);
    put(path.join(root, 'api', '.claude', 'rules', 'real.md'), 'x');
    fs.mkdirSync(path.join(root, 'api', '.claude', 'rules', 'x.md'), { recursive: true });
    assert.deepStrictEqual(indexLines(loader().memberIndex(root, ENV)), ['- api: instructions none; rules 1 file under api/.claude/rules']);
    const only = members(['api']);
    fs.mkdirSync(path.join(only, 'api', '.claude', 'rules', 'x.md'), { recursive: true });
    assert.deepStrictEqual(indexLines(loader().memberIndex(only, ENV)), ['- api: instructions none; rules none']);
});

test('members: a garbage child record is skipped, the other children still listed', () =>
{
    const root = members(['api', 'bad', 'web']);
    put(path.join(root, 'bad', '.alfred', 'workspace.json'), '{ not json');
    let got;
    assert.doesNotThrow(() => { got = loader().memberIndex(root, ENV); });
    assert.deepStrictEqual(indexLines(got), ['- api: instructions none; rules none', '- web: instructions none; rules none']);
});

test('members: the ledger counts children only - 12 of 13 shown, the 13th in the and-1-more line', () =>
{
    const root = members(manyChildren(13));
    part(root, 1);
    const file = path.join(LAYOUT.statsPath(root, ['hook-blocks'], {}), `${SID}.jsonl`);
    const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].members, 12, 'twelve lines are shown, the thirteenth is the "and 1 more" line');
});

test('members: the shipped rules and a thirteen-child index leave nothing unsent', () =>
{
    const root = members(manyChildren(13));
    const index = loader().memberIndex(root, ENV);
    const { parts: out, unsent } = loader().parts(shippedPathless(), { index });
    assert.deepStrictEqual(unsent, []);
    assert.ok(out[0].includes(index), 'the index is whole in part 1');
    for (const p of out) assert.ok(p.length <= 9900, String(p.length));
});

test('members: an overflowing rule set keeps the index whole in part 1 and names what it cuts', () =>
{
    const index = loader().memberIndex(members(manyChildren(13)), ENV);
    const size = (n) => ROOM([rule(n, 1)]);
    const rs = [1, 2, 3, 4, 5, 6].map((k) => rule(`r${k}`, size(`r${k}`)));
    const { parts: out, unsent } = loader().parts(rs, { index });
    assert.strictEqual(out.length, 5);
    assert.ok(out[0].includes(index));
    assert.ok(unsent.length > 0);
    assert.ok(out[4].includes(`Not sent - past part 5: ${unsent.join(', ')}`), out[4].slice(-200));
    for (const p of out) assert.ok(p.length <= 9900, String(p.length));
});

test('members: parts with an empty index equal parts without one', () =>
{
    const rs = [rule('b', 5000), rule('a', 5000), rule('c', 3000)];
    assert.deepStrictEqual(loader().parts(rs, { natives: ['n'], index: '' }), loader().parts(rs, { natives: ['n'] }));
});

test('members: a seat started at the root gets no index', () =>
{
    const root = apiAndWeb();
    for (const k of [1, 2, 3, 4, 5]) assert.ok(!part(root, k, SEAT()).includes('Workspace members'), `part ${k}`);
});

test('members: the probe row of a root start counts its member lines', () =>
{
    const root = apiAndWeb();
    part(root, 1);
    const file = path.join(LAYOUT.statsPath(root, ['hook-blocks'], {}), `${SID}.jsonl`);
    const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepStrictEqual([rows[0].kind, rows[0].members], ['rules-push', 2]);
});

test('members: the probe row counts the member lines it sent, never the line naming the rest', () =>
{
    const root = members(manyChildren(13));
    part(root, 1);
    const file = path.join(LAYOUT.statsPath(root, ['hook-blocks'], {}), `${SID}.jsonl`);
    const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.strictEqual(rows[0].members, 12, 'twelve member lines and the line naming the rest');
});

test('members: with ALFRED_CODE_WORKSPACE at 0 no index is sent, whether the launch env or the project\'s own variables say so', () =>
{
    const root = apiAndWeb();
    assert.strictEqual(loader().memberIndex(root, { ...ENV, ALFRED_CODE_WORKSPACE: '0' }), '', 'the launch env');
    assert.ok(loader().memberIndex(root, { ...ENV, ALFRED_CODE_WORKSPACE: '1' }).includes('- api:'), 'a 1 changes nothing');
    assert.ok(!part(root, 1, START(), { ALFRED_CODE_WORKSPACE: '0' }).includes('Workspace members'), 'the hook run');
    put(path.join(root, '.alfred', '.variables'), 'ALFRED_CODE_WORKSPACE=0\n');
    assert.strictEqual(loader().memberIndex(root, ENV), '', 'the project\'s .variables');
});

test('members: a child whose own record does not point back at this root is not listed (hop rule N1)', () =>
{
    const root = members(['api', 'lost', 'other'], { unlinked: ['lost'], elsewhere: ['other'] });
    assert.deepStrictEqual(indexLines(loader().memberIndex(root, ENV)), ['- api: instructions none; rules none']);
    assert.ok(!part(root, 1).includes('- lost:') && !part(root, 1).includes('- other:'));
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

test('loader: the rules are sent with rules-session in ALFRED_CODE_HOOKS_OFF and under the minimal profile', () =>
{
    for (const off of [{ ALFRED_CODE_HOOKS_OFF: 'rules-session' }, { CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'minimal' }])
    {
        const p = project({ a: 'M-A' });
        assert.ok(part(p, 1, START(), off).includes('M-A'), JSON.stringify(off));
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

test('pathsOf: a block list written at column 0', () =>
    assert.deepStrictEqual(loader().pathsOf('---\npaths:\n- "**/*.ts"\n- src/**\n---\nx'), ['**/*.ts', 'src/**']));

// Task 4 of stage 4c: workspace.js status prints the loader's notes, its unsent rules and what stops it, one rules: line each.
const WS_CLI = path.join(ROOT, 'scripts', 'workspace.js');
const status = (dir, extra) => spawnSync(process.execPath, [WS_CLI, 'status', '--root', dir], { encoding: 'utf8', env: envFor(dir, extra) }).stdout;

test('status: a refused ignore of a locked rule, an unmatched glob, a skipped link and an unsent rule each print one rules: line', () =>
{
    const name = loader().LOCKED_RULES[0];
    const t = W({ apiIgnore: [name] });
    store(t.root, name);
    assert.match(status(t.api), new RegExp(`^rules: ignore rule ${name} not honoured: the rule is locked$`, 'm'));
    const g = project({ g: '---\npaths: ["!**/*.a"]\n---\nglob rule' });
    assert.match(status(g), /^rules: glob not matched: !\*\*\/\*\.a in \.alfred\/stack\/rules\/g\.md$/m);
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
    for (const r of rs.slice(1)) assert.match(out, new RegExp(`^rules: not sent - ${r.rel.replace(/\./g, '\\.')}$`, 'm'));
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

// W3 Task 2: the loader's own walk for a folder with no install below a stamped root.
test('rulesFor: an entry naming a folder above the start sends nothing', () =>
{
    const t = W();
    store(t.root, 'a');
    const tool = path.join(t.root, 'tools', 'tool');
    fs.mkdirSync(path.join(tool, '.git'), { recursive: true });
    ws(t.root, { parent: 'root', children: ['api'], ignoredChildren: ['tools'] });
    assert.strictEqual(at(tool).project, null);
});

test('rulesFor: a sibling whose name starts with the listed path is served', () =>
{
    const t = W();
    store(t.root, 'a');
    const old = path.join(t.root, 'tool-old');
    fs.mkdirSync(path.join(old, '.git'), { recursive: true });
    ws(t.root, { parent: 'root', children: ['api'], ignoredChildren: ['tool'] });
    const r = at(old);
    assert.strictEqual(r.project, t.root);
    assert.deepStrictEqual(names(r.always), ['a']);
});

test('rulesFor: a garbage record in the root sends a folder with no install nothing', () =>
{
    const t = W();
    store(t.root, 'a');
    const tool = path.join(t.root, 'tool');
    fs.mkdirSync(path.join(tool, '.git'), { recursive: true });
    put(path.join(t.root, '.alfred', 'workspace.json'), '{ not json');
    assert.strictEqual(at(tool).project, null);
});

test('start: a marked folder with no install prints nothing, on a Claude Code and a Cursor payload', () =>
{
    const t = W();
    store(t.root, 'a');
    const tool = path.join(t.root, 'tool');
    fs.mkdirSync(path.join(tool, '.git'), { recursive: true });
    put(path.join(tool, 'f.ts'), 'x');
    ws(t.root, { parent: 'root', children: ['api'], ignoredChildren: ['tool'] });
    for (const [args, payload] of [[['--part', '1'], START()], [['--part', '1'], { hook_event_name: 'sessionStart', cursor_version: '1.7.0' }], [[], READ(path.join(tool, 'f.ts'))]])
    {
        const r = run(tool, args, payload);
        assert.strictEqual(r.status, 0, JSON.stringify(payload));
        assert.strictEqual(r.stdout.trim(), '', JSON.stringify(payload));
    }
});

// W3 Task 6 [F12]: the installer hands the loader a stub prelude, so it walks with that and loads no hook-prelude.js.
test('rulesFor: a prelude handed in is the one it walks with', () =>
{
    const os = require('node:os');
    const top = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rules-prelude-')));
    const [a, b] = [path.join(top, 'a'), path.join(top, 'b')];
    for (const d of [path.join(a, '.alfred'), b]) fs.mkdirSync(d, { recursive: true });
    const loader = require(LOADER);
    const got = loader.rulesFor(b, {}, { prelude: { checkoutsOf: () => [a], INSTALL_RECORDS: [] } });
    assert.strictEqual(got.project, a);
});

// Layered native rules, Task 3: part 1 alone, the fallback for a rule not yet written natively, no rule text on a touch.
const { MARKER: NATIVE_MARKER } = require('./install/native-rules-constants.js');
const UPDATE_HINT = 'Rules not yet in .claude/rules - run /alfred-code:update so Claude Code loads them itself.';
const SEATS_MOVED = 'The stack\'s agents moved out of the plugin - run /alfred-code:update to link this project\'s picks; until then no alfred-code seat dispatches here.';
const markedNative = (dir, name, text) => native(dir, name, `---\n---\n${NATIVE_MARKER}\n${text}`);

test('a store rule with no native file is still sent, with the update hint', () =>
{
    const p = project({ a: 'M-A' });
    const text = part(p, 1);
    assert.ok(text.includes('## a (.alfred/stack/rules/a.md)') && text.includes('M-A'), text);
    assert.strictEqual(count(text, UPDATE_HINT), 1, text);
    assert.ok(text.startsWith(OPEN(1, 1)) && text.endsWith(CLOSE(1, 1)), text);
});

test('a rule written natively is not sent', () =>
{
    const p = project({ a: 'M-A', b: 'M-B' });
    markedNative(p, 'a', 'M-A');
    const text = part(p, 1);
    assert.ok(text.includes('M-B') && !text.includes('M-A') && !text.includes('loaded natively'), text);
    const only = project({ a: 'M-A' });
    markedNative(only, 'a', 'M-A');
    assert.strictEqual(part(only, 1), '', 'no fallback rule and no members: nothing');
});

test('part 1 past its room names what it left out', () =>
{
    const rs = [1, 2, 3].map((k) => rule(`r${k}`, 4000));
    const p = project(Object.fromEntries(rs.map((r) => [r.name, r.text])));
    const text = part(p, 1);
    assert.ok(text.length <= 9900, String(text.length));
    assert.ok(text.includes(`Not sent - past part 1: ${rs[2].rel}`), text.slice(-300));
    assert.strictEqual(count(text, heading(rs[2])), 0, 'the third rule is left out whole');
    assert.strictEqual(part(p, 2), '');
    const out = status(p);
    assert.match(out, new RegExp(`^rules: not sent - ${rs[2].rel.replace(/\./g, '\\.')}$`, 'm'));
    assert.doesNotMatch(out, new RegExp(`^rules: not sent - ${rs[0].rel.replace(/\./g, '\\.')}$`, 'm'));
});

test('PostToolUse and --part 2 print nothing', () =>
{
    const p = project({ a: 'M-A', ts: TS });
    assert.strictEqual(touch(p, path.join(p, 'a.ts')), '');
    assert.strictEqual(part(p, 2), '');
    assert.strictEqual(part(p, 2, SEAT()), '');
    assert.strictEqual(part(p, 5), '');
});

test('SubagentStart part 1 sends only the fallback rules, no members index', () =>
{
    const root = apiAndWeb();
    stamp(root, ['seats-route: plugin']);
    const text = part(root, 1, SEAT());
    assert.ok(text.includes('M-A') && text.includes(UPDATE_HINT), text);
    assert.ok(!text.includes('Workspace members') && !text.includes(SEATS_MOVED), text);
});

test('a plugin-route stamp with no linked seat gets the seats-moved line', () =>
{
    const p = project({ a: 'M-A' });
    stamp(p, ['seats-route: plugin']);
    assert.ok(part(p, 1).includes(SEATS_MOVED));
    stamp(p, ['seats-route: library']);
    assert.ok(!part(p, 1).includes(SEATS_MOVED), 'a library-route stamp');
    const bare = project();
    stamp(bare, ['seats-route: plugin']);
    assert.strictEqual(part(bare, 1), [OPEN(1, 1), SEATS_MOVED, CLOSE(1, 1)].join('\n\n'), 'no rule and no hint: the line alone');
    if (process.platform === 'win32') return;
    stamp(p, ['seats-route: plugin']);
    put(path.join(p, '.alfred', 'stack', 'agents', 'x', 'x.md'), 'seat');
    fs.mkdirSync(path.join(p, '.claude', 'agents'), { recursive: true });
    fs.symlinkSync(path.join('..', '..', '.alfred', 'stack', 'agents', 'x'), path.join(p, '.claude', 'agents', 'x'), 'dir');
    assert.ok(!part(p, 1).includes(SEATS_MOVED), 'a linked seat');
});

test('a Cursor payload gets every rule\'s text, native ones included, and member text at SessionStart', () =>
{
    const t = W();
    store(t.root, 'a', 'M-A');
    store(t.root, 'ts', TS);
    markedNative(t.root, 'a', 'M-A');
    store(t.api, 'own', 'M-API');
    const cursor = { hook_event_name: 'sessionStart', cursor_version: '1.7.0' };
    const text = part(t.root, 1, cursor);
    for (const m of ['M-A', 'M-TS', 'M-API']) assert.ok(text.includes(m), `${m}\n${text}`);
    assert.ok(text.includes('## own (api/.alfred/stack/rules/own.md)'), text);
    assert.ok(!text.includes(UPDATE_HINT), 'Cursor reads no .claude/rules');
    const claude = part(t.root, 1);
    assert.ok(!claude.includes('M-API') && !claude.includes('M-TS'), claude);
    const cursorTouch = { hook_event_name: 'postToolUse', cursor_version: '1.7.0', tool_name: 'Read', tool_input: { file_path: path.join(t.api, 'a.ts') } };
    assert.strictEqual(ctx(run(t.root, [], cursorTouch)), '');
});

test('parts: with a limit of one part a rule too long for it is left out whole, never cut, and the others still fit', () =>
{
    const long = rule('long', 12000);
    const out = loader().parts([long, rule('a', 3000), rule('b', 3000)], { limit: 1 });
    assert.strictEqual(out.parts.length, 1);
    assert.deepStrictEqual(out.unsent, [long.rel]);
    assert.ok(out.parts[0].includes(`Not sent - past part 1: ${long.rel}`) && !out.parts[0].includes(heading(long)), out.parts[0].slice(-200));
    assert.ok(out.parts[0].includes(heading(rule('a', 1))) && out.parts[0].includes(heading(rule('b', 1))));
    assert.deepStrictEqual(loader().parts([long], { limit: 5 }).unsent, [], 'five parts still cut it across parts');
});

// Fix round 1.
const CURSOR_START = { hook_event_name: 'sessionStart', cursor_version: '1.7.0' };

test('a Cursor payload gets the rest of its rules on part 2, a Claude Code payload on part 2 nothing', () =>
{
    const rs = [rule('r1', 6000), rule('r2', 6000)];
    const p = project(Object.fromEntries(rs.map((r) => [r.name, r.text])));
    const one = part(p, 1, CURSOR_START);
    const two = part(p, 2, CURSOR_START);
    assert.ok(one.startsWith(OPEN(1, 2)) && one.includes(heading(rs[0])) && !one.includes(heading(rs[1])), one.slice(0, 200));
    assert.ok(two.startsWith(OPEN(2, 2)) && two.includes(heading(rs[1])) && two.endsWith(CLOSE(2, 2)), two.slice(0, 200));
    assert.strictEqual(part(p, 3, CURSOR_START), '');
    for (const k of [2, 3, 5]) assert.strictEqual(part(p, k, START()), '', `Claude Code part ${k}`);
    assert.ok(part(p, 1, START()).includes(`Not sent - past part 1: ${rs[1].rel}`), 'Claude Code part 1 is one part');
});

test('a Cursor payload\'s path rule names its globs, and a member block opens with the binding line and the replaces note', () =>
{
    const t = W();
    store(t.root, 'ts', TS);
    store(t.root, 'same', 'M-ROOT-SAME');
    store(t.api, 'same', 'M-API-SAME');
    store(t.api, 'own', 'M-API-OWN');
    const text = part(t.root, 1, CURSOR_START);
    assert.ok(text.includes('## ts (.alfred/stack/rules/ts.md)\n- applies to: **/*.ts\nM-TS'), text);
    assert.ok(!/## same \(\.alfred[^\n]*\n- applies/.test(text), 'an always-on rule names no globs');
    const BINDING = 'Rules and data of api. Binding for work under api, in addition to the workspace\'s rules.';
    assert.ok(text.includes(`## own (api/.alfred/stack/rules/own.md)\n${BINDING}\nM-API-OWN`), text);
    assert.ok(text.includes(`## same (api/.alfred/stack/rules/same.md) - replaces the workspace's rule of this name for files under api\n${BINDING}\nM-API-SAME`), text);
    assert.ok(text.includes('## same (.alfred/stack/rules/same.md)\nM-ROOT-SAME'), 'the root rule carries neither');
});

test('the members index no longer promises a block on a touch', () =>
{
    const head = loader().memberIndex(apiAndWeb(), ENV).split('\n')[0];
    assert.doesNotMatch(head, /touch|sends its block/);
    assert.match(head, /load natively when the session works in that folder/);
    assert.match(head, /Cursor start sends them/);
});

test('part 1 at its room: at the room it fits, one over leaves the rule out whole, one under fits', () =>
{
    const block = (n) => [OPEN(1, 1), UPDATE_HINT, `## a (.alfred/stack/rules/a.md)\n${'x'.repeat(n)}`, CLOSE(1, 1)].join('\n\n');
    const fit = 9900 - block(0).length;
    for (const [n, fits] of [[fit - 1, true], [fit, true], [fit + 1, false]])
    {
        const text = part(project({ a: 'x'.repeat(n) }), 1);
        if (fits) assert.strictEqual(text, block(n), `${n} characters`);
        else assert.ok(!text.includes('xxx') && text.includes('Not sent - past part 1: .alfred/stack/rules/a.md') && text.length <= 9900, `${n}: ${text.slice(0, 200)}`);
        assert.ok(text.length <= 9900, String(text.length));
    }
});
