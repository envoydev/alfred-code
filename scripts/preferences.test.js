'use strict';
// The preferences engine (stack/skills/capture-preferences/scripts/preferences.js): `check` measures each entry's
// `Check:` regex over the changed files or the tree, `lint` holds the three docs to their shape and the 8,000-char cap,
// `rule` writes the generated rule carrying the docs' entries inline. A `Check:` is data - a regex and globs - never a command.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'stack', 'skills', 'capture-preferences', 'scripts', 'preferences.js');
const CAP = 8000;

const C3 = [
    '## C3 - No static classes',
    '<!-- id: c3 -->',
    '- Rule: model behaviour as instances behind an interface; a static class only where the language requires one.',
    '- Scope: src/**/*.cs',
    '- Why: testable and replaceable without touching callers.',
    '- Except: extension-method holders; source-generator output.',
    '- Check: regex `\\bstatic class\\b` in `src/**/*.cs`, excluding `**/*Extensions.cs`',
].join('\n');
const doc = (title, ...entries) => `# ${title}\n\nUpdated: 2026-10-20\n\n${entries.join('\n\n')}\n`;

function git(cwd, ...args)
{
    const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    return r.stdout;
}

// A git project with `files` committed, then `prefs` ({ CODE, ARCHITECTURE, GIT } doc texts) under the docs root.
function project({ files = {}, prefs = {}, docsRoot = '.alfred/docs', settings = null } = {})
{
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'preferences-')));
    const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
    git(dir, 'init', '-q', '-b', 'main');
    for (const [rel, text] of Object.entries(files)) put(rel, text);
    put('README.md', 'x\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'seed');
    if (settings) put('.claude/settings.json', JSON.stringify(settings));
    const prefDir = path.isAbsolute(docsRoot) ? path.join(docsRoot, 'preferences') : path.join(dir, docsRoot, 'preferences');
    for (const [area, text] of Object.entries(prefs))
    {
        fs.mkdirSync(prefDir, { recursive: true });
        fs.writeFileSync(path.join(prefDir, `${area}-PREFERENCES.md`), text);
    }
    // the skill writes the rule after every doc write, so a project holding docs holds their rule (a hand edit after
    // it is the stale case, tested on its own)
    if (Object.keys(prefs).length) run(dir, 'rule');
    return { dir, put, rm: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function run(dir, ...args)
{
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith('ALFRED_CODE_')) delete env[k];
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8', env });
    return { code: r.status, out: r.stdout, err: r.stderr, lines: r.stdout.split('\n').filter(Boolean) };
}

test('parseDoc reads the spec\'s C3 example into its fields', () =>
{
    const { parseDoc } = require(SCRIPT);
    const [entry, ...rest] = parseDoc(doc('Code preferences', C3));
    assert.deepStrictEqual(rest, []);
    assert.deepStrictEqual(entry, {
        id: 'C3',
        title: 'No static classes',
        rule: 'model behaviour as instances behind an interface; a static class only where the language requires one.',
        scope: ['src/**/*.cs'],
        why: 'testable and replaceable without touching callers.',
        except: ['extension-method holders', 'source-generator output.'],
        check: { regex: '\\bstatic class\\b', include: ['src/**/*.cs'], exclude: ['**/*Extensions.cs'] },
    });
});

test('parseDoc: an entry with no Check: carries check null, and several include globs are read', () =>
{
    const { parseDoc } = require(SCRIPT);
    const [a, b] = parseDoc(doc('Code preferences',
        '## C1 - Wrap external packages\n<!-- id: c1 -->\n- Rule: call a package only through our own adapter.\n- Scope: src/**',
        '## C2 - No console\n<!-- id: c2 -->\n- Rule: log through the logger.\n- Check: regex `console\\.log\\(` in `src/**/*.ts`, `lib/**/*.ts`'));
    assert.strictEqual(a.check, null);
    assert.deepStrictEqual(a.except, []);
    assert.deepStrictEqual(b.check, { regex: 'console\\.log\\(', include: ['src/**/*.ts', 'lib/**/*.ts'], exclude: [] });
});

test('runCheck matches line by line and honours the exclude glob', () =>
{
    const { parseDoc, runCheck } = require(SCRIPT);
    const p = project({ files: { 'src/a.cs': 'namespace A;\npublic static class A {}\n', 'src/AExtensions.cs': 'public static class AExtensions {}\n' } });
    try
    {
        const hits = runCheck(parseDoc(doc('Code preferences', C3)), ['src/a.cs', 'src/AExtensions.cs'].map((f) => ({ rel: f, abs: path.join(p.dir, f) })));
        assert.deepStrictEqual(hits, [{ id: 'C3', file: 'src/a.cs', line: 2, text: 'public static class A {}' }]);
    }
    finally { p.rm(); }
});

test('check --all finds static class in src/a.cs and not in src/AExtensions.cs', () =>
{
    const p = project({
        files: { 'src/a.cs': 'namespace A;\npublic static class A {}\n', 'src/AExtensions.cs': 'public static class AExtensions {}\n', 'docs/x.cs': 'static class D {}\n', '.gitignore': 'src/gen/\n', 'src/gen/G.cs': 'static class G {}\n' },
        prefs: { CODE: doc('Code preferences', C3) },
    });
    try
    {
        const r = run(p.dir, 'check', '--all');
        assert.strictEqual(r.code, 0);
        assert.deepStrictEqual(r.lines, ['violation: C3 src/a.cs:2 public static class A {}', 'checked: 1 entries, 1 violations']);
    }
    finally { p.rm(); }
});

test('check --diff reads only changed and untracked files', () =>
{
    const p = project({
        files: { 'src/old.cs': 'static class Old {}\n', 'src/b.cs': 'class B {}\n' },
        prefs: { CODE: doc('Code preferences', C3) },
    });
    try
    {
        p.put('src/b.cs', 'class B {}\nstatic class B2 {}\n');
        p.put('src/new.cs', 'static class N {}\n');
        const r = run(p.dir, 'check', '--diff');
        assert.strictEqual(r.code, 0);
        assert.deepStrictEqual(r.lines, ['violation: C3 src/b.cs:2 static class B2 {}', 'violation: C3 src/new.cs:1 static class N {}', 'checked: 1 entries, 2 violations']);
        assert.deepStrictEqual(run(p.dir, 'check').lines, r.lines, '--diff is the default');
    }
    finally { p.rm(); }
});

test('check --area runs one doc, and a long line is cut at 160 chars', () =>
{
    const long = `static class L {} // ${'y'.repeat(300)}`;
    const p = project({
        files: { 'src/a.cs': `${long}\n` },
        prefs: { CODE: doc('Code preferences', C3), GIT: doc('Git preferences', '## G1 - No WIP\n<!-- id: g1 -->\n- Rule: no WIP commits.\n- Check: regex `class` in `src/**/*.cs`') },
    });
    try
    {
        assert.deepStrictEqual(run(p.dir, 'check', '--all', '--area', 'code').lines, [`violation: C3 src/a.cs:1 ${long.slice(0, 160)}`, 'checked: 1 entries, 1 violations']);
        assert.deepStrictEqual(run(p.dir, 'check', '--all', '--area', 'git').lines, [`violation: G1 src/a.cs:1 ${long.slice(0, 160)}`, 'checked: 1 entries, 1 violations']);
    }
    finally { p.rm(); }
});

test('an uncompilable regex is skipped with one skipped: line and exit 0', () =>
{
    const p = project({
        files: { 'src/a.cs': 'static class A {}\n' },
        prefs: { CODE: doc('Code preferences', C3, '## C4 - Broken\n<!-- id: c4 -->\n- Rule: x.\n- Check: regex `static (class` in `src/**/*.cs`') },
    });
    try
    {
        const r = run(p.dir, 'check', '--all');
        assert.strictEqual(r.code, 0, 'a verifier judges; the script measures');
        assert.deepStrictEqual(r.lines.filter((l) => l.startsWith('skipped:')).length, 1);
        assert.match(r.out, /^skipped: C4 - the Check: regex does not compile/m);
        assert.match(r.out, /^violation: C3 src\/a\.cs:1 /m, 'the other entry still runs');
        assert.match(r.out, /^checked: 1 entries, 1 violations$/m);
    }
    finally { p.rm(); }
});

test('check with no preferences captured says so and exits 0', () =>
{
    const p = project();
    try { assert.deepStrictEqual(run(p.dir, 'check', '--all').lines, ['checked: 0 entries, 0 violations']); }
    finally { p.rm(); }
});

test('lint names a missing id, a duplicate id and the bad regex, exit 1', () =>
{
    const p = project({
        prefs: {
            CODE: doc('Code preferences', C3,
                '## C5 - No id line\n- Rule: x.',
                '## C3 - Same id again\n<!-- id: c3 -->\n- Rule: y.',
                '## C6 - Bad regex\n<!-- id: c6 -->\n- Rule: z.\n- Check: regex `a(b` in `src/**`',
                '## A1 - Wrong doc\n<!-- id: a1 -->\n- Rule: an architecture id in the code doc.'),
        },
    });
    try
    {
        const r = run(p.dir, 'lint');
        assert.strictEqual(r.code, 1);
        const problems = r.lines.filter((l) => l.startsWith('PROBLEM '));
        assert.strictEqual(problems.length, 4, r.out);
        assert.match(r.out, /PROBLEM \S*CODE-PREFERENCES\.md: C5 has no <!-- id: --> line/);
        assert.match(r.out, /PROBLEM \S*CODE-PREFERENCES\.md: C3 is used twice/);
        assert.match(r.out, /PROBLEM \S*CODE-PREFERENCES\.md: C6 Check: regex does not compile/);
        assert.match(r.out, /PROBLEM \S*CODE-PREFERENCES\.md: A1 is not a C<n> id - this doc's entries are C1, C2, \.\.\./);
        assert.match(r.out, /^lint: 4 problems$/m);
    }
    finally { p.rm(); }
});

test('lint passes a clean doc with exit 0', () =>
{
    const p = project({ prefs: { CODE: doc('Code preferences', C3) } });
    try
    {
        const r = run(p.dir, 'lint');
        assert.strictEqual(r.code, 0, r.out);
        assert.deepStrictEqual(r.lines, ['lint: 0 problems']);
    }
    finally { p.rm(); }
});

test('lint flags an entry that reuses a Retired: id and a retired id of another area', () =>
{
    const text = doc('Code preferences', C3, '## C1 - Back again\n<!-- id: c1 -->\n- Rule: x.').replace('Updated: 2026-10-20\n', 'Updated: 2026-10-20\nRetired: C1, A2\n');
    const p = project({ prefs: { CODE: text } });
    try
    {
        const r = run(p.dir, 'lint');
        assert.strictEqual(r.code, 1);
        assert.match(r.out, /PROBLEM \S*CODE-PREFERENCES\.md: C1 is retired - an id is never reused, take the next one/);
        assert.match(r.out, /PROBLEM \S*CODE-PREFERENCES\.md: Retired: A2 is not a C<n> id/);
        assert.match(r.out, /^lint: 2 problems$/m);
    }
    finally { p.rm(); }
});

test('next prints one past the highest id used or retired, C1 for an absent doc', () =>
{
    const text = doc('Code preferences', C3).replace('Updated: 2026-10-20\n', 'Updated: 2026-10-20\nRetired: C4, C7\n');
    const p = project({ prefs: { CODE: text, GIT: doc('Git preferences', '## G2 - Branches\n<!-- id: g2 -->\n- Rule: feature/<ticket>.') } });
    try
    {
        assert.deepStrictEqual(run(p.dir, 'next', '--area', 'code').lines, ['Next: C8']);
        assert.deepStrictEqual(run(p.dir, 'next', '--area', 'git').lines, ['Next: G3']);
        assert.deepStrictEqual(run(p.dir, 'next', '--area', 'architecture').lines, ['Next: A1']);
        const bad = run(p.dir, 'next');
        assert.strictEqual(bad.code, 2);
        assert.match(bad.err, /next needs --area code\|architecture\|git/);
    }
    finally { p.rm(); }
});

// One CODE doc padded to exactly `n` chars: the cap counts the three docs together.
const sized = (n) =>
{
    const base = doc('Code preferences', C3);
    return `${base}\n${'x'.repeat(n - base.length - 2)}\n`;
};
for (const [n, over] of [[CAP + 1, true], [CAP, false], [CAP - 1, false]])
{
    test(`lint ${over ? 'flags' : 'passes'} the docs at ${n} chars (the cap is ${CAP})`, () =>
    {
        const text = sized(n);
        assert.strictEqual(text.length, n);
        const p = project({ prefs: { CODE: text } });
        try
        {
            const r = run(p.dir, 'lint');
            assert.strictEqual(r.code, over ? 1 : 0, r.out);
            if (over) assert.match(r.out, new RegExp(`PROBLEM \\S*preferences/: the three docs are ${n} chars, over ${CAP}`));
            else assert.deepStrictEqual(r.lines, ['lint: 0 problems']);
        }
        finally { p.rm(); }
    });
}

test('a Check: holding $( or a pipe is rejected by lint as a command', () =>
{
    const p = project({
        prefs: {
            CODE: doc('Code preferences',
                '## C1 - Sub\n<!-- id: c1 -->\n- Rule: x.\n- Check: $(grep -rn static src)',
                '## C2 - Pipe\n<!-- id: c2 -->\n- Rule: y.\n- Check: grep -rn static src | wc -l',
                '## C3 - Alternation is a regex\n<!-- id: c3 -->\n- Rule: z.\n- Check: regex `a|b` in `src/**`'),
        },
    });
    try
    {
        const r = run(p.dir, 'lint');
        assert.strictEqual(r.code, 1);
        assert.match(r.out, /PROBLEM \S*CODE-PREFERENCES\.md: C1 Check: is a shell command - only regex `<pattern>` in `<glob>` is run/);
        assert.match(r.out, /PROBLEM \S*CODE-PREFERENCES\.md: C2 Check: is a shell command/);
        assert.doesNotMatch(r.out, /C3 Check:/, 'a | inside the regex is alternation, not a pipe');
        assert.match(r.out, /^lint: 2 problems$/m);
    }
    finally { p.rm(); }
    const { parseDoc } = require(SCRIPT);
    assert.strictEqual(parseDoc(doc('Code preferences', '## C1 - Sub\n<!-- id: c1 -->\n- Rule: x.\n- Check: $(rm -rf .)'))[0].check, null, 'a command is never parsed into a check');
});

test('rule carries each existing doc\'s entries inline, under a header naming the doc, and none for an absent one', () =>
{
    const G1 = '## G1 - No WIP\n<!-- id: g1 -->\n- Rule: no WIP commits.';
    const p = project({ prefs: { CODE: doc('Code preferences', C3), GIT: doc('Git preferences', G1) } });
    try
    {
        const r = run(p.dir, 'rule');
        assert.strictEqual(r.code, 0, r.err);
        const file = path.join(p.dir, '.claude', 'rules', 'alfred-preferences.md');
        const text = fs.readFileSync(file, 'utf8');
        assert.match(text, /^---\ndescription: Generated by \/capture-preferences/);
        assert.deepStrictEqual(text.split('\n').filter((l) => l.startsWith('@')), [], 'no @ import - a seat may not expand one');
        assert.deepStrictEqual(text.split('\n').filter((l) => /^## /.test(l)), [
            '## CODE-PREFERENCES.md - .alfred/docs/preferences/CODE-PREFERENCES.md',
            '## GIT-PREFERENCES.md - .alfred/docs/preferences/GIT-PREFERENCES.md',
        ]);
        assert.match(text, /^### C3 - No static classes$/m, 'an entry sits one level under its doc');
        assert.match(text, /^- Rule: model behaviour as instances behind an interface/m);
        assert.match(text, /^- Except: extension-method holders/m);
        assert.match(text, /^### G1 - No WIP$/m);
        assert.doesNotMatch(text, /^# Code preferences$|^Updated: /m, 'the doc\'s own title and date stay in the doc');
        assert.doesNotMatch(text, /ARCHITECTURE-PREFERENCES/);
        assert.match(text, /^<!-- preferences: [0-9a-f]{16} /m, 'the docs\' hash, for the stale check');
        const chars = doc('Code preferences', C3).length + doc('Git preferences', G1).length;
        assert.deepStrictEqual(r.lines, [`Rule: ${Buffer.byteLength(text)} bytes, 2 docs inline; preferences ${chars} chars of ${CAP}`]);
    }
    finally { p.rm(); }
});

test('a doc edited after the rule is named stale by lint and check, until rule runs again', () =>
{
    const p = project({ prefs: { CODE: doc('Code preferences', C3) } });
    try
    {
        run(p.dir, 'rule');
        const stale = (r) => r.lines.filter((l) => l.startsWith('stale:'));
        assert.deepStrictEqual(stale(run(p.dir, 'lint')), [], 'fresh');
        p.put('.alfred/docs/preferences/CODE-PREFERENCES.md', doc('Code preferences', C3.replace('testable', 'mockable')));
        const lint = run(p.dir, 'lint');
        assert.deepStrictEqual(stale(lint), ['stale: .claude/rules/alfred-preferences.md does not carry the docs as they stand - run preferences.js rule; a session loads the rule, not the docs']);
        assert.strictEqual(lint.code, 0, 'a stale rule is no shape problem');
        assert.strictEqual(stale(run(p.dir, 'check', '--all')).length, 1, 'check says it too - a verifier runs check on every review');
        run(p.dir, 'rule');
        assert.deepStrictEqual(stale(run(p.dir, 'lint')), []);
        p.put('.claude/rules/alfred-preferences.md', 'my own rule\n');
        assert.deepStrictEqual(stale(run(p.dir, 'lint')), ['stale: .claude/rules/alfred-preferences.md does not carry the docs as they stand - run preferences.js rule; a session loads the rule, not the docs'], 'a hand-written file carries no hash');
    }
    finally { p.rm(); }
});

test('rule is idempotent - a second run writes the same bytes', () =>
{
    const p = project({ prefs: { CODE: doc('Code preferences', C3) } });
    try
    {
        run(p.dir, 'rule');
        const file = path.join(p.dir, '.claude', 'rules', 'alfred-preferences.md');
        const first = fs.readFileSync(file);
        const again = run(p.dir, 'rule');
        assert.strictEqual(again.code, 0);
        assert.ok(fs.readFileSync(file).equals(first));
    }
    finally { p.rm(); }
});

test('rule with no doc writes nothing, keeps a file of the user\'s, and empties its own once every doc is gone', () =>
{
    const p = project();
    const file = path.join(p.dir, '.claude', 'rules', 'alfred-preferences.md');
    try
    {
        const r = run(p.dir, 'rule');
        assert.deepStrictEqual(r.lines, ['Rule: no preferences captured']);
        assert.ok(!fs.existsSync(file));
        p.put('.claude/rules/alfred-preferences.md', 'kept\n');
        run(p.dir, 'rule');
        assert.strictEqual(fs.readFileSync(file, 'utf8'), 'kept\n');
        fs.rmSync(file);
        p.put('.alfred/docs/preferences/CODE-PREFERENCES.md', doc('Code preferences', C3));
        run(p.dir, 'rule');
        fs.rmSync(path.join(p.dir, '.alfred', 'docs', 'preferences', 'CODE-PREFERENCES.md'));
        const again = run(p.dir, 'rule');
        assert.deepStrictEqual(again.lines, ['Rule: no preferences captured - the rule now carries none']);
        const text = fs.readFileSync(file, 'utf8');
        assert.doesNotMatch(text, /C3|^## /m, 'a removed preference never stays bound through the rule');
        assert.match(text, /^# The user's preferences$/m);
    }
    finally { p.rm(); }
});

test('the docs root comes from the settings env, settings.local.json over settings.json; an absolute one is named as it is', () =>
{
    const p = project({ docsRoot: 'shared/docs', settings: { env: { ALFRED_CODE_DOCS_PATH: 'shared/docs' } }, prefs: { CODE: doc('Code preferences', C3) } });
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pref docs-')));
    try
    {
        run(p.dir, 'rule');
        const heads = () => fs.readFileSync(path.join(p.dir, '.claude', 'rules', 'alfred-preferences.md'), 'utf8').split('\n').filter((l) => /^## /.test(l));
        assert.deepStrictEqual(heads(), ['## CODE-PREFERENCES.md - shared/docs/preferences/CODE-PREFERENCES.md']);
        fs.mkdirSync(path.join(outside, 'preferences'), { recursive: true });
        fs.writeFileSync(path.join(outside, 'preferences', 'CODE-PREFERENCES.md'), doc('Code preferences', C3));
        p.put('.claude/settings.local.json', JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: outside } }));
        run(p.dir, 'rule');
        assert.deepStrictEqual(heads(), [`## CODE-PREFERENCES.md - ${outside.replace(/\\/g, '/')}/preferences/CODE-PREFERENCES.md`]);
    }
    finally { p.rm(); fs.rmSync(outside, { recursive: true, force: true }); }
});
