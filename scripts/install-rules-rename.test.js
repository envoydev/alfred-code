'use strict';
// THE RULE RENAME (2.1.6): the seven shipped rules and the generated per-project rules moved from the
// `baseline-` prefix to `alfred-`. A fresh install writes only the new names; an update over an install
// written before it prunes the old library copies (`retired.rules`), writes the new ones, and MOVES each
// generated file with its content kept - its capture never re-runs by itself. End to end against the seed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const { hashItem } = require('./install/library.js');

const SHIPPED = ['docs-root', 'git', 'interaction', 'memory', 'navigation', 'quality-gates', 'security'];
const SEL = `skill markdown-style\nrule markdown-docs\n${SHIPPED.map((n) => `rule alfred-${n}`).join('\n')}\n`;
// The install is the walk's; the update is what /alfred-code:update runs - the read-back of what is on disk.
const UPDATE = (scope = 'project') => ['--scope', scope, '--installed-only'];
const GENERATED = ['agent-capabilities', 'related-context', 'architecture', 'run-book'];
const body = (n) => `---\ndescription: generated ${n}\n---\n\n${n} body - kept byte for byte\n`;

const rulesOf = (repo) => path.join(repo, '.claude', 'rules');
const stampOf = (repo) => path.join(repo, '.claude', 'alfred-code.stamp');
const stampRules = (repo) => Object.fromEntries((((/^library-rules: (.*)$/m.exec(fs.readFileSync(stampOf(repo), 'utf8')) || [])[1]) || '')
    .split(',').filter((s) => s.includes('=')).map((s) => s.split('=')));

// What a run left: the rule files with their bytes, and the stamp's library-rules names.
function snap(repo)
{
    const dir = rulesOf(repo);
    const files = {};
    for (const f of fs.readdirSync(dir).sort()) files[f] = fs.readFileSync(path.join(dir, f), 'utf8');
    return { files, stamp: stampRules(repo) };
}

// Turn a fresh (new-shape) install into what 2.1.5 left: the seven library copies under their old names with
// the stamp's hashes to match (the file name is part of a copy's hash), the generated files under theirs,
// and two files the stack never wrote.
function makeOld(repo, { edit = [] } = {})
{
    const dir = rulesOf(repo);
    const text = fs.readFileSync(stampOf(repo), 'utf8');
    const rows = Object.entries(stampRules(repo));
    const moved = rows.map(([name, hash]) =>
    {
        const m = /^alfred-(docs-root|git|interaction|memory|navigation|quality-gates|security)$/.exec(name);
        if (!m) return [name, hash];
        const old = `baseline-${m[1]}`;
        fs.renameSync(path.join(dir, `${name}.md`), path.join(dir, `${old}.md`));
        return [old, hashItem(path.join(dir, `${old}.md`))];
    });
    fs.writeFileSync(stampOf(repo), text.replace(/^library-rules: .*$/m, `library-rules: ${moved.map(([n, h]) => `${n}=${h}`).join(',')}`));
    for (const g of GENERATED) fs.writeFileSync(path.join(dir, `baseline-project-${g}.md`), body(g));
    fs.writeFileSync(path.join(dir, 'project-code-style.md'), body('code-style'));
    fs.writeFileSync(path.join(dir, 'baseline-mine.md'), 'my own rule\n');
    fs.writeFileSync(path.join(dir, 'baseline-project-notes.md'), 'my own project rule\n');
    for (const n of edit) fs.appendFileSync(path.join(dir, `baseline-${n}.md`), 'a hand edit\n');
}

test('a fresh install writes only alfred-* rule names, in the tree and in the stamp', POSIX_ONLY, () =>
{
    const { result: r } = seedRun('install', SEL, { inspect: snap });
    for (const n of SHIPPED) assert.ok(`alfred-${n}.md` in r.files, `alfred-${n}.md missing: ${Object.keys(r.files)}`);
    assert.deepStrictEqual(Object.keys(r.files).filter((f) => /^baseline-/.test(f)), []);
    for (const n of SHIPPED) assert.ok(`alfred-${n}` in r.stamp, `stamp lacks alfred-${n}`);
    assert.deepStrictEqual(Object.keys(r.stamp).filter((f) => /^baseline-/.test(f)), []);
});

for (const scope of ['project', 'user', 'local'])
{
    test(`update over an old install (${scope} scope): old copies pruned, new written, generated files moved byte for byte`, POSIX_ONLY, () =>
    {
        const { result: r, out } = seedRun(['install', 'update'], SEL, {
            args: [['--scope', scope], UPDATE(scope)], each: (repo, i) => (i === 0 ? makeOld(repo) : null), inspect: snap,
        });
        for (const n of SHIPPED)
        {
            assert.ok(!(`baseline-${n}.md` in r.files), `baseline-${n}.md survived`);
            assert.ok(`alfred-${n}.md` in r.files, `alfred-${n}.md was not written`);
            assert.ok(`alfred-${n}` in r.stamp && !(`baseline-${n}` in r.stamp), `the stamp still names baseline-${n}`);
        }
        for (const g of GENERATED)
        {
            assert.ok(!(`baseline-project-${g}.md` in r.files), `baseline-project-${g}.md was not moved`);
            assert.strictEqual(r.files[`alfred-project-${g}.md`], body(g), `alfred-project-${g}.md is not the old content`);
        }
        assert.strictEqual(r.files['baseline-mine.md'], 'my own rule\n', "the user's own baseline- file was touched");
    assert.strictEqual(r.files['baseline-project-notes.md'], 'my own project rule\n', "the user's own baseline-project- file was moved or touched");
        assert.strictEqual(r.files['project-code-style.md'], body('code-style'));
        assert.ok(!/not found in the stack source|drift|unlisted/.test(out), `noise from the update: ${out}`);
        assert.ok(/rule pruned \(retired upstream\): baseline-git\.md/.test(out), `no prune line: ${out}`);
        assert.ok(/alfred-project-run-book\.md/.test(out), `no move line: ${out}`);
    });
}

test('a second update over the migrated install changes nothing', POSIX_ONLY, () =>
{
    const { steps, outs } = seedRun(['install', 'update', 'update'], SEL, {
        args: [[], UPDATE(), UPDATE()], each: (repo, i) => (i === 0 ? makeOld(repo) : snap(repo)),
    });
    assert.deepStrictEqual(steps[2], steps[1]);
    assert.ok(!/rule pruned|moved: rule/.test(outs[2]), `the re-run still acted: ${outs[2]}`);
});

test('a hand-edited old copy is kept and named, never pruned with its edits (audit F2/F3)', POSIX_ONLY, () =>
{
    const { result: r, out, outs } = seedRun(['install', 'update', 'update'], SEL, {
        args: [[], UPDATE(), UPDATE()], each: (repo, i) => (i === 0 ? makeOld(repo, { edit: ['git'] }) : null), inspect: snap,
    });
    assert.ok('baseline-git.md' in r.files, 'the edited copy was deleted');
    assert.match(r.files['baseline-git.md'], /a hand edit/, 'its edit is intact');
    assert.ok('alfred-git.md' in r.files, 'the shipped rule is written beside it');
    assert.match(outs[1], /!! rule kept: baseline-git\.md.*edited/, `no kept line: ${outs[1]}`);
    assert.ok(!('baseline-interaction.md' in r.files), 'an unedited old copy is still pruned');
    assert.ok(/baseline-git\.md/.test(out), 'and a re-run keeps naming it');
});

test('a retired rule name the stamp does not record is the project\'s own: kept and named (audit F2/F3)', POSIX_ONLY, () =>
{
    const { result: r, outs } = seedRun(['install', 'update'], SEL, {
        args: [[], UPDATE()], inspect: snap,
        each: (repo, i) =>
        {
            if (i !== 0) return;
            for (const n of ['web-conventions', 'aspnet-conventions', 'house-baseline']) fs.writeFileSync(path.join(rulesOf(repo), `${n}.md`), `my own ${n}\n`);
        },
    });
    for (const n of ['web-conventions', 'aspnet-conventions', 'house-baseline']) assert.strictEqual(r.files[`${n}.md`], `my own ${n}\n`, `${n}.md was deleted`);
    assert.match(outs[1], /!! rule kept: web-conventions\.md.*yours/, outs[1]);
});

test('a garbled library-rules stamp line records nothing: the new names land, the old copies stay and are named', POSIX_ONLY, () =>
{
    const { result: r, outs } = seedRun(['install', 'update'], SEL, {
        args: [[], UPDATE()], inspect: snap,
        each: (repo, i) =>
        {
            if (i !== 0) return;
            makeOld(repo);
            fs.writeFileSync(stampOf(repo), fs.readFileSync(stampOf(repo), 'utf8').replace(/^library-rules: .*$/m, 'library-rules: garbage'));
        },
    });
    for (const n of SHIPPED)
    {
        assert.ok(`alfred-${n}.md` in r.files, `alfred-${n}.md missing`);
        assert.ok(`baseline-${n}.md` in r.files, `baseline-${n}.md was deleted with no record to say it is the stack's`);
    }
    assert.match(outs[1], /!! rule kept: baseline-git\.md/, 'each kept copy is named');
    assert.strictEqual(r.files['alfred-project-run-book.md'], body('run-book'));
});

// installer:F4 - a rule copy goes through the same claim test a skill does: a same-named file the stamp does not record is the
// project's own unless its opening line is the shipped rule's (an older copy of the stack's).
test('a project\'s own rule under a shipped name is kept and named, never overwritten; an older stack copy still updates (audit F4)', POSIX_ONLY, () =>
{
    const shipped = fs.readFileSync(path.join(__dirname, '..', 'stack', 'rules', 'sql-conventions.md'), 'utf8');
    const { result: r, out } = seedRun('install', `${SEL}rule csharp-conventions\nrule sql-conventions\n`, {
        inspect: snap,
        prepare: (repo) =>
        {
            fs.mkdirSync(rulesOf(repo), { recursive: true });
            fs.writeFileSync(path.join(rulesOf(repo), 'csharp-conventions.md'), 'MY OWN C# RULES\n');
            fs.writeFileSync(path.join(rulesOf(repo), 'sql-conventions.md'), `${shipped}\nan older tail\n`);
        },
    });
    assert.strictEqual(r.files['csharp-conventions.md'], 'MY OWN C# RULES\n', 'the project\'s rule was overwritten');
    assert.match(out, /!! rule kept: csharp-conventions/, out);
    assert.ok(!('csharp-conventions' in r.stamp), 'a kept rule is never recorded');
    assert.strictEqual(r.files['sql-conventions.md'], shipped, 'a copy that opens with the shipped rule is the stack\'s and is refreshed');
    assert.ok('sql-conventions' in r.stamp);
});

test('an empty rules folder holding only an old generated file: the file moves, nothing else is invented', POSIX_ONLY, () =>
{
    const { result: r } = seedRun(['install', 'update'], SEL, {
        args: [[], UPDATE()], inspect: snap,
        each: (repo, i) =>
        {
            if (i !== 0) return;
            fs.rmSync(rulesOf(repo), { recursive: true, force: true });
            fs.mkdirSync(rulesOf(repo));
            fs.writeFileSync(path.join(rulesOf(repo), 'baseline-project-run-book.md'), body('run-book'));
        },
    });
    assert.strictEqual(r.files['alfred-project-run-book.md'], body('run-book'));
    assert.ok(!('baseline-project-run-book.md' in r.files));
});

// The seeded .claude/CLAUDE.md of a 2.1.5 install: the template's table of rule paths, one row a user's own rule.
const OLD_TABLE = ['git', 'interaction', 'docs-root'].map((n) => `| \`.claude/rules/baseline-${n}.md\` | the ${n} rule |`)
    .concat(GENERATED.map((g) => `| \`.claude/rules/baseline-project-${g}.md\` (GENERATED) | the ${g} pointer |`), '| `.claude/rules/baseline-mine.md` | my own |').join('\n');

test('the seeded AGENTS.md rows naming the old rule files are re-spelled, the user\'s own rule row is not, and a re-run is quiet', POSIX_ONLY, () =>
{
    const seedAt = (repo) => path.join(repo, '.claude', 'AGENTS.md');
    const agentsMd = (repo) => fs.readFileSync(seedAt(repo), 'utf8');
    // The 2.1.5 seed the ledger still holds: the old table appended, its ledger row moved to the new bytes.
    const plant = (repo) =>
    {
        fs.appendFileSync(seedAt(repo), `\n${OLD_TABLE}\n`);
        const stamp = stampOf(repo);
        fs.writeFileSync(stamp, fs.readFileSync(stamp, 'utf8').replace(/AGENTS\.md=[0-9a-f]+/, `AGENTS.md=${hashItem(seedAt(repo))}`));
    };
    const { steps, outs } = seedRun(['install', 'update', 'update'], SEL, {
        args: [[], UPDATE(), UPDATE()],
        each: (repo, i) =>
        {
            if (i === 0) { makeOld(repo); plant(repo); }
            return agentsMd(repo);
        },
    });
    for (const n of ['git', 'interaction', 'docs-root']) assert.ok(steps[1].includes(`.claude/rules/alfred-${n}.md`), `alfred-${n}.md not written into AGENTS.md`);
    for (const g of GENERATED) assert.ok(steps[1].includes(`.claude/rules/alfred-project-${g}.md`), `alfred-project-${g}.md not written into AGENTS.md`);
    assert.ok(!/baseline-(git|interaction|docs-root|project-)/.test(steps[1]), 'an old stack rule path survived in AGENTS.md');
    assert.ok(steps[1].includes('.claude/rules/baseline-mine.md'), "the user's own rule row was re-spelled");
    assert.strictEqual(steps[2], steps[1]);
    assert.ok(!/renamed: \.claude\/AGENTS\.md/.test(outs[2]), 'the re-run re-spelled again');
});

test('an unreadable settings file on the migrating run keeps the root the OLD docs-root rule was stamped with', POSIX_ONLY, () =>
{
    const { result } = seedRun(['install', 'update'], SEL, {
        args: [[], UPDATE()], failOk: true,
        each: (repo, i) =>
        {
            if (i !== 0) return;
            makeOld(repo);
            const rule = path.join(rulesOf(repo), 'baseline-docs-root.md');
            fs.writeFileSync(rule, fs.readFileSync(rule, 'utf8').replace(/This install's root: `[^`]*`/, "This install's root: `.claude/docs`"));
            const f = path.join(repo, '.claude', 'settings.json');
            fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/\}\s*$/, ',}'));
        },
        inspect: (repo) => (/This install's root: `([^`]*)`/.exec(fs.readFileSync(path.join(rulesOf(repo), 'alfred-docs-root.md'), 'utf8')) || [])[1],
    });
    assert.strictEqual(result, '.claude/docs');
});

test('a run that dies after the old rules are pruned would leave none: the old copies go only once the new ones landed', POSIX_ONLY, () =>
{
    // .claude/hooks a FILE: the engine copy that follows the rule prune throws ENOTDIR.
    const { result, code } = seedRun(['install', 'update'], SEL, {
        args: [[], UPDATE()], failOk: true,
        each: (repo, i) =>
        {
            if (i !== 0) return;
            makeOld(repo);
            fs.rmSync(path.join(repo, '.claude', 'hooks'), { recursive: true, force: true });
            fs.writeFileSync(path.join(repo, '.claude', 'hooks'), 'not a folder\n');
        },
        inspect: (repo) => fs.readdirSync(rulesOf(repo)).filter((f) => /^(baseline|alfred)-(docs-root|git|interaction|memory|navigation|quality-gates|security)\.md$/.test(f)),
    });
    assert.notStrictEqual(code, 0, 'the injected failure did not stop the run');
    assert.ok(result.length >= SHIPPED.length, `no always-on rule is left after a failed run: ${result}`);
});

// A capture that ran before /alfred-code:update wrote the new-name file; the old one is what it superseded.
const bothExist = (mode) => seedRun(['install', 'update'], SEL, {
    args: [[], UPDATE()], inspect: snap,
    each: (repo, i) =>
    {
        if (i !== 0) return;
        makeOld(repo);
        const oldF = path.join(rulesOf(repo), 'baseline-project-run-book.md');
        const newF = path.join(rulesOf(repo), 'alfred-project-run-book.md');
        fs.writeFileSync(newF, mode === 'same' ? body('run-book') : 'newer capture\n');
        const t = Date.now() / 1000;
        fs.utimesSync(oldF, t - (mode === 'old-newer' ? 0 : 3600), t - (mode === 'old-newer' ? 0 : 3600));
        fs.utimesSync(newF, t - (mode === 'old-newer' ? 3600 : 0), t - (mode === 'old-newer' ? 3600 : 0));
    },
});

test('both generated files exist, the old byte-identical or older: the superseded old one is deleted, said', POSIX_ONLY, () =>
{
    for (const mode of ['same', 'old-older'])
    {
        const { result: r, out } = bothExist(mode);
        assert.ok(!('baseline-project-run-book.md' in r.files), `${mode}: the old file survived`);
        assert.strictEqual(r.files['alfred-project-run-book.md'], mode === 'same' ? body('run-book') : 'newer capture\n');
        assert.ok(/alfred-project-run-book\.md/.test(out) && /superseded/.test(out), `${mode}: the delete was not said: ${out}`);
    }
});

test('both generated files exist and the old one is NEWER and different: it is kept and named, both stay', POSIX_ONLY, () =>
{
    const { result: r, out } = bothExist('old-newer');
    assert.strictEqual(r.files['alfred-project-run-book.md'], 'newer capture\n');
    assert.strictEqual(r.files['baseline-project-run-book.md'], body('run-book'));
    assert.ok(/!!/.test(out) && /alfred-project-run-book\.md/.test(out), `the clash was not named: ${out}`);
});
