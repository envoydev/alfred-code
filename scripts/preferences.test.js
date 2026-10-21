'use strict';
// The preferences engine (stack/skills/capture-preferences/scripts/preferences.js): `check` measures each entry's
// `Check:` regex over the changed files or the tree, `lint` holds the entry docs to their shape, each hold to its cap
// (5,000 for the edit hold's two docs, 5,000 for the git doc, 3,000 for the personal doc) and the git doc to its locked
// entries. No rule is written: alfred-preferences.md ships and points at the docs (2026-10-21). A `Check:` is data - a regex and globs - never a command.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'stack', 'skills', 'capture-preferences', 'scripts', 'preferences.js');
// Two caps, one per hold (the user's ruling S-Q3 of 2026-10-21): the edit hold's two docs together, the git doc alone.
const CAP = 5000;
const GIT_CAP = 5000;

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

// A git project with `files` committed, then `prefs` ({ 'PERSONAL-CODE', ARCHITECTURE, GIT, 'PROJECT-CODE' } doc texts)
// under the docs root.
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
        prefs: { 'PERSONAL-CODE': doc('Code preferences', C3) },
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
        prefs: { 'PERSONAL-CODE': doc('Code preferences', C3) },
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
        prefs: { 'PERSONAL-CODE': doc('Code preferences', C3), GIT: doc('Git preferences', '## G1 - No WIP\n<!-- id: g1 -->\n- Rule: no WIP commits.\n- Check: regex `class` in `src/**/*.cs`') },
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
        prefs: { 'PERSONAL-CODE': doc('Code preferences', C3, '## C4 - Broken\n<!-- id: c4 -->\n- Rule: x.\n- Check: regex `static (class` in `src/**/*.cs`') },
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

// Final review C4 (plan Review Focus 5): a violation cites its entry by id, so an entry with none, or one whose id another
// entry also holds, has nothing a verifier could cite - skipped with one line, never run under its heading.
test('an entry with no id, or an id two entries share, is skipped with one skipped: line and exit 0', () =>
{
    const bad = (heading, id) => `## ${heading}\n<!-- id: ${id} -->\n- Rule: x.\n- Check: regex \`static class\` in \`src/**/*.cs\``;
    const p = project({
        files: { 'src/a.cs': 'static class A {}\n' },
        prefs: { 'PERSONAL-CODE': doc('Code preferences', C3, bad('No id here', 'x'), bad('C5 - First', 'c5'), bad('C5 - Second', 'c5')) },
    });
    try
    {
        const r = run(p.dir, 'check', '--all');
        assert.strictEqual(r.code, 0);
        assert.deepStrictEqual(r.lines.filter((l) => l.startsWith('skipped:')), [
            'skipped: No id here - the heading names no entry id (`## C1 - <title>`, A1 or G1 by doc), so nothing is run',
            'skipped: C5 - more than one entry holds this id, so nothing is run for any of them',
        ], r.out);
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
            'PERSONAL-CODE': doc('Code preferences', C3,
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
    const p = project({ prefs: { 'PERSONAL-CODE': doc('Code preferences', C3) } });
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
    const p = project({ prefs: { 'PERSONAL-CODE': text } });
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
    const p = project({ prefs: { 'PERSONAL-CODE': text, GIT: doc('Git preferences', '## G2 - Branches\n<!-- id: g2 -->\n- Rule: feature/<ticket>.') } });
    try
    {
        assert.deepStrictEqual(run(p.dir, 'next', '--area', 'code').lines, ['Next: C8']);
        assert.deepStrictEqual(run(p.dir, 'next', '--area', 'git').lines, ['Next: G3']);
        assert.deepStrictEqual(run(p.dir, 'next', '--area', 'architecture').lines, ['Next: A1']);
        const bad = run(p.dir, 'next');
        assert.strictEqual(bad.code, 2);
        assert.match(bad.err, /next needs --area personal\|code\|architecture\|git/);
    }
    finally { p.rm(); }
});

// One CODE doc padded to exactly `n` chars: the edit hold's cap counts it with the architecture doc.
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
        const p = project({ prefs: { 'PERSONAL-CODE': text } });
        try
        {
            const r = run(p.dir, 'lint');
            assert.strictEqual(r.code, over ? 1 : 0, r.out);
            if (over) assert.match(r.out, new RegExp(`PROBLEM \\S*preferences/: the personal code and architecture docs are ${n} chars, over ${CAP} - the first edit's hold hands both over`));
            else assert.deepStrictEqual(r.lines, ['lint: 0 problems']);
        }
        finally { p.rm(); }
    });
}

test('a Check: holding $( or a pipe is rejected by lint as a command', () =>
{
    const p = project({
        prefs: {
            'PERSONAL-CODE': doc('Code preferences',
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

// The seed the installer writes, as a project holds it: the date filled in.
const SEED = path.join(ROOT, 'stack', 'skills', 'capture-preferences', 'references', 'git-seed.md');
const seeded = () => fs.readFileSync(SEED, 'utf8').replace(/__TODAY__/g, '2026-10-21');

test('lint passes the seeded git doc as it is, and fails one missing a locked entry, naming each key and the update that puts it back', () =>
{
    const p = project({ prefs: { GIT: seeded() } });
    try
    {
        assert.deepStrictEqual(run(p.dir, 'lint').lines, ['lint: 0 problems']);
        const gone = seeded().replace(/## G1 - [\s\S]*?(?=## G2 )/, '').replace(/## G4 - [\s\S]*?(?=## G5 )/, '');
        p.put('.alfred/docs/preferences/GIT-PREFERENCES.md', gone);
        const r = run(p.dir, 'lint');
        assert.strictEqual(r.code, 1);
        assert.match(r.out, /PROBLEM \S*GIT-PREFERENCES\.md: the locked entry 'consent' is missing - \/alfred-code:update puts it back/);
        assert.match(r.out, /PROBLEM \S*GIT-PREFERENCES\.md: the locked entry 'safety' is missing/);
        assert.match(r.out, /^lint: 2 problems$/m);
    }
    finally { p.rm(); }
});

test('lint fails a locked entry whose Rule: changed - a locked entry is never edited, only its id and title may differ', () =>
{
    const weakened = seeded().replace(/(<!-- locked: consent -->\n- Rule: )Do NOT commit or push until the user explicitly says to/, '$1Commit when the tests pass');
    const renumbered = seeded().replace('## G1 - Ask before any commit or push\n<!-- id: g1 -->', '## G9 - Consent first\n<!-- id: g9 -->');
    const p = project({ prefs: { GIT: weakened } });
    try
    {
        const r = run(p.dir, 'lint');
        assert.strictEqual(r.code, 1);
        assert.match(r.out, /PROBLEM \S*GIT-PREFERENCES\.md: G1 is the locked 'consent' entry and its Rule: was changed - a locked entry is never edited; restore it from the seed/);
        p.put('.alfred/docs/preferences/GIT-PREFERENCES.md', renumbered);
        assert.deepStrictEqual(run(p.dir, 'lint').lines, ['lint: 0 problems'], 'a merged entry takes a fresh id and keeps its text');
    }
    finally { p.rm(); }
});

test('no command writes a rule - alfred-preferences.md ships; `rule` is no command', () =>
{
    const p = project({ prefs: { 'PERSONAL-CODE': doc('Code preferences', C3), GIT: seeded() } });
    try
    {
        for (const args of [['lint'], ['check', '--all'], ['next', '--area', 'code']]) run(p.dir, ...args);
        assert.ok(!fs.existsSync(path.join(p.dir, '.claude', 'rules', 'alfred-preferences.md')));
        const r = run(p.dir, 'rule');
        assert.strictEqual(r.code, 2);
        assert.match(r.err, /^usage: preferences\.js check/m);
        assert.doesNotMatch(run(p.dir, 'lint').out, /stale:/);
    }
    finally { p.rm(); }
});

test('the old CODE-PREFERENCES.md name is a lint problem until the update renames it', () =>
{
    const p = project({ prefs: { CODE: doc('Code preferences', C3) } });
    try
    {
        const r = run(p.dir, 'lint');
        assert.strictEqual(r.code, 1);
        assert.match(r.out, /PROBLEM \S*preferences\/CODE-PREFERENCES\.md is the old name of PERSONAL-CODE-PREFERENCES\.md - \/alfred-code:update renames it/);
    }
    finally { p.rm(); }
});

test('PROJECT-CODE-PREFERENCES.md is the code-style capture\'s doc: never entry-linted, never counted in the cap, and next --area code is the personal doc', () =>
{
    const style = `# Code style\n\nCaptured: main@abc1234, 2026-10-21\n\n## C#\n<!-- id: c-sharp -->\n<!-- covers: src/**.cs -->\n${'x'.repeat(CAP)}\n`;
    const p = project({ prefs: { 'PROJECT-CODE': style, 'PERSONAL-CODE': doc('Code preferences', C3) } });
    try
    {
        assert.deepStrictEqual(run(p.dir, 'lint').lines, ['lint: 0 problems']);
        assert.deepStrictEqual(run(p.dir, 'next', '--area', 'code').lines, ['Next: C4']);
    }
    finally { p.rm(); }
});

test('the docs root comes from the settings env, settings.local.json over settings.json; an absolute one is named as it is', () =>
{
    const bad = doc('Code preferences', '## C1 - No id\n- Rule: x.');
    const p = project({ docsRoot: 'shared/docs', settings: { env: { ALFRED_CODE_DOCS_PATH: 'shared/docs' } }, prefs: { 'PERSONAL-CODE': bad } });
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pref docs-')));
    try
    {
        assert.match(run(p.dir, 'lint').out, /^PROBLEM shared\/docs\/preferences\/PERSONAL-CODE-PREFERENCES\.md: C1 has no <!-- id: --> line - /m);
        fs.mkdirSync(path.join(outside, 'preferences'), { recursive: true });
        fs.writeFileSync(path.join(outside, 'preferences', 'PERSONAL-CODE-PREFERENCES.md'), bad);
        p.put('.claude/settings.local.json', JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: outside } }));
        assert.ok(run(p.dir, 'lint').out.includes(`PROBLEM ${outside.replace(/\\/g, '/')}/preferences/PERSONAL-CODE-PREFERENCES.md: C1 has no`));
    }
    finally { p.rm(); fs.rmSync(outside, { recursive: true, force: true }); }
});

// 2026-10-21, the user's ruling: PERSONAL-PREFERENCES.md - how the user wants the assistant to work - is the fourth entry
// doc, pushed at every session start and after each compaction by preferences-session.js, so it has its own cap (an
// always-on cost) outside the 5,000 each of the edit and git holds hands over, and no `Check:` (there is no code to grep).
const P1 = '## P1 - Short answers\n<!-- id: p1 -->\n- Rule: lead with the verdict, at most two bullets.\n- Scope: every answer\n- Why: long answers bury the decision.';
test('the personal doc: next --area personal is P<n>, lint holds its ids and rejects a Check:', () =>
{
    const p = project({ prefs: { PERSONAL: doc('Personal preferences', P1) } });
    try
    {
        assert.deepStrictEqual(run(p.dir, 'lint').lines, ['lint: 0 problems']);
        assert.deepStrictEqual(run(p.dir, 'next', '--area', 'personal').lines, ['Next: P2']);
        assert.deepStrictEqual(run(p.dir, 'check', '--all', '--area', 'personal').lines, ['checked: 0 entries, 0 violations']);
        p.put('.alfred/docs/preferences/PERSONAL-PREFERENCES.md', doc('Personal preferences', `${P1}\n- Check: regex \`TODO\` in \`src/**\``, '## C9 - Wrong prefix\n<!-- id: c9 -->\n- Rule: x.'));
        const r = run(p.dir, 'lint');
        assert.strictEqual(r.code, 1, r.out);
        assert.match(r.out, /PERSONAL-PREFERENCES\.md: P1 carries a Check: - a personal entry has no code to grep/);
        assert.match(r.out, /C9 is not a P<n> id/);
    }
    finally { p.rm(); }
});

const PERSONAL_CAP = 3000;
const personalSized = (n) =>
{
    const base = doc('Personal preferences', P1);
    return `${base}\n${'x'.repeat(n - base.length - 2)}\n`;
};
for (const [n, over] of [[PERSONAL_CAP + 1, true], [PERSONAL_CAP, false], [PERSONAL_CAP - 1, false]])
{
    test(`lint ${over ? 'flags' : 'passes'} the personal doc at ${n} chars (its own cap is ${PERSONAL_CAP}, outside the ${CAP})`, () =>
    {
        const text = personalSized(n);
        assert.strictEqual(text.length, n);
        const p = project({ prefs: { PERSONAL: text, 'PERSONAL-CODE': sized(CAP) } });
        try
        {
            const r = run(p.dir, 'lint');
            assert.strictEqual(r.code, over ? 1 : 0, r.out);
            if (over) assert.match(r.out, new RegExp(`PROBLEM \\S*PERSONAL-PREFERENCES\\.md is ${n} chars, over ${PERSONAL_CAP}`));
            else assert.deepStrictEqual(r.lines, ['lint: 0 problems'], 'the personal doc never counts in the edit hold\'s cap');
        }
        finally { p.rm(); }
    });
}

// ---- audit 2026-10-21 (preferences.md PF-1, PF-4, PF-18, PF-19, PF-21, S-Q3, PF-T4-6) ------------------------------
test('S-Q3: the git doc has its own cap, apart from the edit hold\'s two docs', () =>
{
    for (const [n, over] of [[GIT_CAP + 1, true], [GIT_CAP, false]])
    {
        const base = seeded();
        const text = `${base}\n${'x'.repeat(n - base.length - 2)}\n`;
        const p = project({ prefs: { GIT: text, 'PERSONAL-CODE': sized(CAP) } });
        try
        {
            const r = run(p.dir, 'lint');
            assert.strictEqual(r.code, over ? 1 : 0, r.out);
            if (over) assert.match(r.out, new RegExp(`PROBLEM \\S*GIT-PREFERENCES\\.md is ${n} chars, over ${GIT_CAP} - the first git write's hold hands it over`));
        }
        finally { p.rm(); }
    }
});

test('PF-1: a doc that is a link is a lint problem, and its target is never read', (t) =>
{
    const p = project();
    try
    {
        p.put('.alfred/.sensitive-data', 'TOKEN=abc\n## C1 - x\n<!-- id: c1 -->\n- Rule: leaked-text\n');
        fs.mkdirSync(path.join(p.dir, '.alfred/docs/preferences'), { recursive: true });
        try { fs.symlinkSync(path.join(p.dir, '.alfred/.sensitive-data'), path.join(p.dir, '.alfred/docs/preferences/PERSONAL-CODE-PREFERENCES.md')); }
        catch { t.skip('no symlinks on this host'); return; }
        const r = run(p.dir, 'lint');
        assert.strictEqual(r.code, 1);
        assert.match(r.out, /PROBLEM \S*PERSONAL-CODE-PREFERENCES\.md is a link - the hooks never read a linked doc; put the file itself there/);
        assert.doesNotMatch(r.out, /leaked-text|TOKEN/);
    }
    finally { p.rm(); }
});

test('PF-4: lint compares every field of a locked entry, refuses an unknown locked key and a lock-less copy of a locked title', () =>
{
    const cases = [
        [seeded().replace(/(<!-- locked: consent -->\n[\s\S]*?- Scope: )every commit, push, merge and publish/, '$1commits only'), /G1 is the locked 'consent' entry and its Scope: was changed/],
        [seeded().replace(/(<!-- locked: consent -->\n- Rule: [^\n]*\n)/, '$1- Except: hotfix branches\n'), /G1 is the locked 'consent' entry and its Except: was changed/],
        [`${seeded()}\n## G9 - Mine\n<!-- id: g9 -->\n<!-- locked: mine -->\n- Rule: x.\n`, /G9 carries locked: mine - only the house keys \(consent, scope, checkpoint, safety\) are locked; drop the line/],
        [`${seeded()}\n## G9 - Ask before any commit or push\n<!-- id: g9 -->\n- Rule: just commit when done.\n`, /G9 repeats the locked 'consent' entry's title without its lock - a locked entry is never edited; remove G9/],
    ];
    for (const [text, problem] of cases)
    {
        const p = project({ prefs: { GIT: text } });
        try
        {
            const r = run(p.dir, 'lint');
            assert.strictEqual(r.code, 1, r.out);
            assert.match(r.out, problem);
        }
        finally { p.rm(); }
    }
});

test('PF-18: check --diff <base> reads the files changed since the base; outside git it says so', () =>
{
    const entry = '## C1 - No var\n<!-- id: c1 -->\n- Rule: no var.\n- Check: regex `\\bvar\\b` in `src/**`';
    const p = project({ files: { 'src/a.js': 'let a = 1;\n' }, prefs: { 'PERSONAL-CODE': doc('Code preferences', entry) } });
    try
    {
        const base = git(p.dir, 'rev-parse', 'HEAD').trim();
        p.put('src/a.js', 'var a = 1;\n');
        git(p.dir, 'commit', '-qam', 'var');
        const head = run(p.dir, 'check', '--diff');
        assert.match(head.out, /^checked: 1 entries, 0 violations$/m);
        assert.match(head.out, /^note: no file changed since HEAD is in an entry's scope - after a commit, pass --diff <base> or --all$/m);
        const since = run(p.dir, 'check', '--diff', base);
        assert.match(since.out, /violation: C1 src\/a\.js:1/);
        assert.doesNotMatch(since.out, /^note:/m);
    }
    finally { p.rm(); }
    const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'preferences-nogit-')));
    try
    {
        fs.mkdirSync(path.join(bare, '.alfred/docs/preferences'), { recursive: true });
        fs.writeFileSync(path.join(bare, '.alfred/docs/preferences/PERSONAL-CODE-PREFERENCES.md'), doc('Code preferences', entry));
        assert.match(run(bare, 'check', '--diff').out, /^note: not a git repo - use --all$/m);
    }
    finally { fs.rmSync(bare, { recursive: true, force: true }); }
});

test('PF-19: a fenced `## ` line is no entry, and a Retired: line inside an entry is not the doc\'s', () =>
{
    const text = doc('Code preferences', `${C3}\n\n\`\`\`\n## C9 - example only\n\`\`\``, '## C4 - Note\n<!-- id: c4 -->\n- Rule: as written.\n\nRetired: C8\n').replace(/## C3/, '## C3');
    const p = project({ prefs: { 'PERSONAL-CODE': text } });
    try
    {
        assert.deepStrictEqual(run(p.dir, 'lint').lines, ['lint: 0 problems']);
        assert.deepStrictEqual(run(p.dir, 'next', '--area', 'code').lines, ['Next: C5']);
    }
    finally { p.rm(); }
});

test('PF-21: with both the old and the new code doc, lint names the manual merge, or the update\'s delete when they are equal', () =>
{
    const text = doc('Code preferences', C3);
    const p = project({ prefs: { 'PERSONAL-CODE': text } });
    try
    {
        p.put('.alfred/docs/preferences/CODE-PREFERENCES.md', text);
        assert.match(run(p.dir, 'lint').out, /CODE-PREFERENCES\.md is an exact copy of PERSONAL-CODE-PREFERENCES\.md - \/alfred-code:update deletes it/);
        p.put('.alfred/docs/preferences/CODE-PREFERENCES.md', doc('Code preferences', '## C1 - Other\n<!-- id: c1 -->\n- Rule: y.'));
        assert.match(run(p.dir, 'lint').out, /CODE-PREFERENCES\.md and PERSONAL-CODE-PREFERENCES\.md both hold entries - merge the old one into the new by hand, then delete it; the update never overwrites either/);
    }
    finally { p.rm(); }
});

test('PF-T4-6: ALFRED_CODE_DATA_PATH ./ reads the docs where the hooks do (.alfred/docs)', () =>
{
    const p = project({ settings: { env: { ALFRED_CODE_DATA_PATH: './' } }, prefs: { 'PERSONAL-CODE': doc('Code preferences', '## C1 - x\n<!-- id: c1 -->\n- Rule: x.') } });
    try { assert.deepStrictEqual(run(p.dir, 'next', '--area', 'code').lines, ['Next: C2']); }
    finally { p.rm(); }
});

test('Q-1: in a linked worktree, check reads a doc git keeps out from the main checkout; the worktree\'s own copy wins', () =>
{
    const p = project({ files: { 'src/a.cs': 'namespace A;\n' }, prefs: { 'PERSONAL-CODE': doc('Code preferences', C3) } });
    const wt = `${p.dir}-wt`;
    try
    {
        git(p.dir, 'worktree', 'add', '-q', wt);
        fs.writeFileSync(path.join(wt, 'src', 'a.cs'), 'namespace A;\npublic static class A {}\n');
        assert.deepStrictEqual(run(wt, 'check', '--diff', '--area', 'code').lines, ['violation: C3 src/a.cs:2 public static class A {}', 'checked: 1 entries, 1 violations']);
        fs.mkdirSync(path.join(wt, '.alfred/docs/preferences'), { recursive: true });
        fs.writeFileSync(path.join(wt, '.alfred/docs/preferences/PERSONAL-CODE-PREFERENCES.md'), doc('Code preferences', '## C1 - x\n<!-- id: c1 -->\n- Rule: x.'));
        assert.deepStrictEqual(run(wt, 'check', '--diff', '--area', 'code').lines, ['checked: 0 entries, 0 violations']);
        fs.rmSync(path.join(wt, '.alfred/docs/preferences/PERSONAL-CODE-PREFERENCES.md'));
        fs.symlinkSync(path.join(p.dir, '.alfred/docs/preferences/PERSONAL-CODE-PREFERENCES.md'), path.join(wt, '.alfred/docs/preferences/PERSONAL-CODE-PREFERENCES.md'));
        assert.deepStrictEqual(run(wt, 'check', '--diff', '--area', 'code').lines, ['checked: 0 entries, 0 violations'], 'a link where the doc first sits is refused, never passed over');
        assert.deepStrictEqual(run(wt, 'next', '--area', 'code').lines, ['Next: C1']);
    }
    finally { fs.rmSync(wt, { recursive: true, force: true }); p.rm(); }
});
