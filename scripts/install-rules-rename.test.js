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
const seeds = require('./install/seeds.js');

// alfred-git retired on 2026-10-21 (its lines are the seeded GIT-PREFERENCES.md); baseline-git's successor is the preferences rule.
const SHIPPED = ['docs-root', 'interaction', 'memory', 'navigation', 'preferences', 'quality-gates', 'security'];
const SEL = `skill markdown-style\nrule markdown-docs\n${SHIPPED.map((n) => `rule alfred-${n}`).join('\n')}\n`;
// The install is the walk's; the update is what /alfred-code:update runs - the read-back of what is on disk.
const UPDATE = (scope = 'project') => ['--scope', scope, '--installed-only'];
const GENERATED = ['agent-capabilities', 'related-context', 'architecture', 'run-book'];
// The name each generated pointer carries since the 2026-10-13 rename (selection.js GENERATED_RULES).
const NOW = { 'agent-capabilities': 'alfred-agent-awareness', 'related-context': 'alfred-related-context', architecture: 'alfred-architecture', 'run-book': 'alfred-project-awareness' };
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
        const m = /^alfred-(docs-root|interaction|memory|navigation|quality-gates|security)$/.exec(name);
        if (!m) return [name, hash];
        const old = `baseline-${m[1]}`;
        fs.renameSync(path.join(dir, `${name}.md`), path.join(dir, `${old}.md`));
        return [old, hashItem(path.join(dir, `${old}.md`))];
    }).filter(([name]) => name !== 'alfred-preferences');
    // 2.1.5 had no preferences rule and shipped the git rule as baseline-git: its real text, recorded.
    fs.rmSync(path.join(dir, 'alfred-preferences.md'));
    fs.writeFileSync(path.join(dir, 'baseline-git.md'), SHIPPED_OLD['baseline-git']);
    moved.push(['baseline-git', hashItem(path.join(dir, 'baseline-git.md'))]);
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
            assert.strictEqual(r.files[`${NOW[g]}.md`], body(g), `${NOW[g]}.md is not the old content`);
        }
        assert.strictEqual(r.files['baseline-mine.md'], 'my own rule\n', "the user's own baseline- file was touched");
    assert.strictEqual(r.files['baseline-project-notes.md'], 'my own project rule\n', "the user's own baseline-project- file was moved or touched");
        assert.strictEqual(r.files['project-code-style.md'], body('code-style'));
        assert.ok(!/not found in the stack source|drift|unlisted/.test(out), `noise from the update: ${out}`);
        assert.ok(/rule pruned \(retired upstream\): baseline-git\.md/.test(out), `no prune line: ${out}`);
        assert.ok(/alfred-project-awareness\.md/.test(out), `no move line: ${out}`);
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
    assert.ok('alfred-preferences.md' in r.files, 'the successor is written beside it');
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

// A garbled line, or a stamp from before library-rules (0.2.x / 1.x), records no hash: an old copy is still the stack's
// when it opens with its alfred-* successor's first line, so it goes - a file under the old name that opens
// otherwise is the project's own and stays, named. (2.2.0: a 0.2.87 install's seven baseline-* copies were all kept.)
for (const [label, unstamp] of [['a garbled library-rules line', (t) => t.replace(/^library-rules: .*$/m, 'library-rules: garbage')],
    ['a stamp from before library-rules', (t) => t.replace(/^library-rules: .*\n/m, '')]])
{
    test(`${label} records nothing: old copies that open with their successor's line are pruned, one that does not is kept`, POSIX_ONLY, () =>
    {
        const { result: r, outs } = seedRun(['install', 'update'], SEL, {
            args: [[], UPDATE()], inspect: snap,
            each: (repo, i) =>
            {
                if (i !== 0) return;
                makeOld(repo);
                fs.writeFileSync(stampOf(repo), unstamp(fs.readFileSync(stampOf(repo), 'utf8')));
                fs.writeFileSync(path.join(rulesOf(repo), 'baseline-security.md'), '# My own security notes\n');
            },
        });
        for (const n of SHIPPED) assert.ok(`alfred-${n}.md` in r.files, `alfred-${n}.md missing`);
        for (const n of SHIPPED.filter((x) => x !== 'security')) assert.ok(!(`baseline-${n}.md` in r.files), `baseline-${n}.md survived: ${outs[1]}`);
        assert.strictEqual(r.files['baseline-security.md'], '# My own security notes\n', 'a copy that opens otherwise is the project\'s');
        assert.match(outs[1], /!! rule kept: baseline-security\.md.*yours/, 'the kept copy is named');
        assert.match(outs[1], /rule pruned \(retired upstream\): baseline-git\.md/, outs[1]);
        assert.strictEqual(r.files['baseline-mine.md'], 'my own rule\n', 'a retired-looking name with no successor is never touched');
        assert.strictEqual(r.files['alfred-project-awareness.md'], body('run-book'));
    });
}

// audit 2026-10-10 C10: a 0.2.x / 1.x install updated by 2.2.0 or 2.2.1 kept its seven baseline-* copies unjudged and the
// stamp that run wrote records the alfred-* rules, so the opening-line claim above (no rule recorded) never ran again and
// both sets loaded on every message (34,059 chars). The copies are real shipped texts (scripts/fixtures/retired-rules.js -
// three of the seven, whose history holds a text free of the retired 1.x name).
const SHIPPED_OLD = require('./fixtures/retired-rules.js');
const { shippedText } = require('./install/retired-rules.js');

function make220(repo, { edit = [], crlf = [], unrecord = [] } = {})
{
    for (const [name, text] of Object.entries(SHIPPED_OLD))
    {
        const n = name.replace(/^baseline-/, '');
        let t = crlf.includes(n) ? text.replace(/\n/g, '\r\n') : text;
        if (edit.includes(n)) t += 'a hand edit\n';
        fs.writeFileSync(path.join(rulesOf(repo), `${name}.md`), t);
    }
    if (!unrecord.length) return;
    const text = fs.readFileSync(stampOf(repo), 'utf8');
    const kept = Object.entries(stampRules(repo)).filter(([name]) => !unrecord.map((n) => `alfred-${n}`).includes(name));
    fs.writeFileSync(stampOf(repo), text.replace(/^library-rules: .*$/m, `library-rules: ${kept.map(([n, h]) => `${n}=${h}`).join(',')}`));
}

test('retired-rules.js knows a shipped old text, line endings aside, and nothing else', () =>
{
    for (const [name, text] of Object.entries(SHIPPED_OLD))
    {
        assert.ok(shippedText(name, text), `${name}: a shipped text is not known`);
        assert.ok(shippedText(name, text.replace(/\n/g, '\r\n')), `${name}: a CRLF copy is not known`);
        assert.ok(!shippedText(name, `${text}a hand edit\n`), `${name}: an edited copy reads as shipped`);
    }
    assert.ok(!shippedText('baseline-mine', 'x'), 'a name with no shipped text');
    assert.ok(!shippedText('baseline-git', null), 'an unreadable copy');
});

for (const scope of ['project', 'user', 'local'])
{
    test(`a 2.2.0-shaped stamp (${scope} scope): records the alfred-* rules, the shipped baseline-* copies beside them are pruned (audit C10)`, POSIX_ONLY, () =>
    {
        const { result: r, outs } = seedRun(['install', 'update'], SEL, {
            args: [['--scope', scope], UPDATE(scope)], each: (repo, i) => (i === 0 ? make220(repo) : null), inspect: snap,
        });
        for (const name of Object.keys(SHIPPED_OLD))
        {
            assert.ok(!(`${name}.md` in r.files), `${name}.md survived: ${outs[1]}`);
            assert.match(outs[1], new RegExp(`rule pruned \\(retired upstream\\): ${name}\\.md`));
        }
        for (const n of SHIPPED) assert.ok(`alfred-${n}.md` in r.files && `alfred-${n}` in r.stamp, `alfred-${n} lost`);
        assert.deepStrictEqual(Object.keys(r.stamp).filter((f) => /^baseline-/.test(f)), []);
    });
}

test('a 2.2.0-shaped stamp: an edited old copy stays and is named, a CRLF one goes, and a re-run changes nothing', POSIX_ONLY, () =>
{
    const { result: r, outs, steps } = seedRun(['install', 'update', 'update'], SEL, {
        args: [[], UPDATE(), UPDATE()], inspect: snap,
        each: (repo, i) =>
        {
            if (i === 0) make220(repo, { edit: ['git'], crlf: ['memory'] });
            return snap(repo).files;
        },
    });
    assert.match(r.files['baseline-git.md'], /a hand edit\n$/, 'the edited copy was deleted or changed');
    assert.match(outs[1], /!! rule kept: baseline-git\.md.*yours/, `no kept line: ${outs[1]}`);
    assert.ok(!('baseline-memory.md' in r.files), 'a CRLF copy of a shipped text survived');
    assert.ok(!('baseline-quality-gates.md' in r.files), 'an unedited copy survived');
    assert.deepStrictEqual(steps[2], steps[1], 'the re-run changed the rules folder');
    assert.ok(!/rule pruned/.test(outs[2]), `the re-run pruned again: ${outs[2]}`);
});

// 2026-10-21: alfred-git retired and baseline-git's successor became alfred-preferences. A 2.8.0 stamp records alfred-git,
// not the new successor, so the leftover claim follows the rename chain: the recorded git copy and a shipped baseline-git
// left beside it both go, and the read-back maps the git copy to the preferences rule.
test('a 2.8.0-shaped stamp records alfred-git: the git copy and a leftover shipped baseline-git both go', POSIX_ONLY, () =>
{
    const { result: r, outs } = seedRun(['install', 'update'], SEL, {
        args: [[], UPDATE()], inspect: snap,
        each: (repo, i) =>
        {
            if (i !== 0) return;
            const dir = rulesOf(repo);
            fs.renameSync(path.join(dir, 'alfred-preferences.md'), path.join(dir, 'alfred-git.md'));
            fs.writeFileSync(path.join(dir, 'baseline-git.md'), SHIPPED_OLD['baseline-git']);
            const rows = Object.entries(stampRules(repo)).filter(([name]) => name !== 'alfred-preferences');
            rows.push(['alfred-git', hashItem(path.join(dir, 'alfred-git.md'))]);
            const text = fs.readFileSync(stampOf(repo), 'utf8');
            fs.writeFileSync(stampOf(repo), text.replace(/^library-rules: .*$/m, `library-rules: ${rows.map(([n, h]) => `${n}=${h}`).join(',')}`));
        },
    });
    assert.ok(!('alfred-git.md' in r.files), `the recorded git copy survived: ${outs[1]}`);
    assert.ok(!('baseline-git.md' in r.files), `the shipped baseline-git survived: ${outs[1]}`);
    assert.ok('alfred-preferences.md' in r.files && 'alfred-preferences' in r.stamp && !('alfred-git' in r.stamp), 'the successor is written and recorded');
    assert.match(outs[1], /rule pruned \(retired upstream\): alfred-git\.md/);
    assert.match(outs[1], /rule pruned \(retired upstream\): baseline-git\.md/);
});

test('a stamp that records rules but not the old copy\'s successor: the copy stays, named', POSIX_ONLY, () =>
{
    const { result: r, outs } = seedRun(['install', 'update'], SEL, {
        args: [[], UPDATE()], inspect: snap, each: (repo, i) => (i === 0 ? make220(repo, { unrecord: ['quality-gates'] }) : null),
    });
    assert.strictEqual(r.files['baseline-quality-gates.md'], SHIPPED_OLD['baseline-quality-gates']);
    assert.match(outs[1], /!! rule kept: baseline-quality-gates\.md.*yours/, outs[1]);
    assert.ok(!('baseline-git.md' in r.files), 'a copy whose successor is recorded survived');
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
    assert.strictEqual(r.files['alfred-project-awareness.md'], body('run-book'));
    assert.ok(!('baseline-project-run-book.md' in r.files));
});

// The seeded .claude/CLAUDE.md of a 2.1.5 install: the template's table of rule paths, one row a user's own rule.
const OLD_TABLE = ['git', 'interaction', 'docs-root'].map((n) => `| \`.claude/rules/baseline-${n}.md\` | the ${n} rule |`)
    .concat(GENERATED.map((g) => `| \`.claude/rules/baseline-project-${g}.md\` (GENERATED) | the ${g} pointer |`), '| `.claude/rules/baseline-mine.md` | my own |').join('\n');

// An unedited seed is the stack's until init fills it in, so an update rewrites it from the release's template - the
// re-spell alone left the 2.5.0 seed's three capture steps as three lines naming the one capture that replaced them
// (the 2026-10-17 update matrix). An edited seed is the project's: kept byte for byte, its old names only named.
test('a seeded AGENTS.md the ledger still holds is rewritten from this release\'s template, an edited one is kept, and a re-run is quiet', POSIX_ONLY, () =>
{
    const seedAt = (repo) => path.join(repo, '.claude', 'AGENTS.md');
    const agentsMd = (repo) => fs.readFileSync(seedAt(repo), 'utf8');
    const ledgered = (repo) => (/AGENTS\.md=([0-9a-f]+)/.exec(fs.readFileSync(stampOf(repo), 'utf8')) || [])[1];
    // The 2.1.5 seed the ledger still holds: the old table appended, its ledger row moved to the new bytes.
    const plant = (repo, { edited = false } = {}) =>
    {
        fs.appendFileSync(seedAt(repo), `\n${OLD_TABLE}\n`);
        if (edited) return;
        const stamp = stampOf(repo);
        fs.writeFileSync(stamp, fs.readFileSync(stamp, 'utf8').replace(/AGENTS\.md=[0-9a-f]+/, `AGENTS.md=${hashItem(seedAt(repo))}`));
    };
    const template = (repo) => seeds.agentsMdBody({ projectRoot: repo, sourceDir: path.join(__dirname, '..') });
    const ours = seedRun(['install', 'update', 'update'], SEL, {
        args: [[], UPDATE(), UPDATE()],
        each: (repo, i) =>
        {
            if (i === 0) { makeOld(repo); plant(repo); }
            return { text: agentsMd(repo), template: template(repo), hash: hashItem(seedAt(repo)), ledgered: ledgered(repo) };
        },
    });
    const [, a, b] = ours.steps;
    assert.strictEqual(a.text, a.template, 'the held seed is not the release template after the update');
    assert.ok(!/baseline-|alfred-(agent-awareness|related-context|project-awareness)\.md/.test(a.text), 'an old name survived the refresh');
    assert.strictEqual(a.ledgered, a.hash, 'the ledger does not hold the refreshed seed');
    assert.match(ours.outs[1], /AGENTS\.md: the unfilled seed refreshed from this release's template/);
    assert.strictEqual(b.text, a.text);
    assert.ok(!/AGENTS\.md: the unfilled seed refreshed/.test(ours.outs[2]), 'the re-run refreshed again');
    const yours = seedRun(['install', 'update', 'update'], SEL, {
        args: [[], UPDATE(), UPDATE()],
        each: (repo, i) =>
        {
            if (i === 0) { makeOld(repo); plant(repo, { edited: true }); }
            return agentsMd(repo);
        },
    });
    assert.strictEqual(yours.steps[1], yours.steps[0], 'an edited seed was changed');
    assert.ok(yours.steps[1].includes('.claude/rules/baseline-mine.md') && yours.steps[1].includes('.claude/rules/baseline-git.md'), 'an edited seed lost its rows');
    assert.ok(!/unfilled seed refreshed/.test(yours.outs[1]), 'an edited seed was refreshed');
    assert.strictEqual(yours.steps[2], yours.steps[1]);
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
        const newF = path.join(rulesOf(repo), 'alfred-project-awareness.md');
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
        assert.strictEqual(r.files['alfred-project-awareness.md'], mode === 'same' ? body('run-book') : 'newer capture\n');
        assert.ok(/alfred-project-awareness\.md/.test(out) && /superseded/.test(out), `${mode}: the delete was not said: ${out}`);
    }
});

test('both generated files exist and the old one is NEWER and different: it is kept and named, both stay', POSIX_ONLY, () =>
{
    const { result: r, out } = bothExist('old-newer');
    assert.strictEqual(r.files['alfred-project-awareness.md'], 'newer capture\n');
    assert.strictEqual(r.files['baseline-project-run-book.md'], body('run-book'));
    assert.ok(/!!/.test(out) && /alfred-project-awareness\.md/.test(out), `the clash was not named: ${out}`);
});

// 2026-10-13: the alfred-project-<x> names (2.1.6 to 2.3.x) move to the user's new names on update, byte for byte, and a
// seeded AGENTS.md row naming one follows; a project's own alfred-project-notes.md is no file of ours.
test('update over a 2.3.x install: each alfred-project-<x>.md moves to its new name, byte for byte, the project\'s own file stays', POSIX_ONLY, () =>
{
    const { result: r, out } = seedRun(['install', 'update', 'update'], SEL, {
        args: [[], UPDATE(), UPDATE()], inspect: snap,
        each: (repo, i) =>
        {
            if (i !== 0) return;
            for (const g of GENERATED) fs.writeFileSync(path.join(rulesOf(repo), `alfred-project-${g}.md`), body(g));
            fs.writeFileSync(path.join(rulesOf(repo), 'alfred-project-notes.md'), 'my own project rule\n');
        },
    });
    for (const g of GENERATED)
    {
        assert.ok(!(`alfred-project-${g}.md` in r.files), `alfred-project-${g}.md was not moved`);
        assert.strictEqual(r.files[`${NOW[g]}.md`], body(g), `${NOW[g]}.md is not the old content`);
    }
    assert.strictEqual(r.files['alfred-project-notes.md'], 'my own project rule\n', "the user's own alfred-project- file was moved or touched");
    assert.ok(!/moved: rule/.test(out), `the second update moved again: ${out}`);
});

test('a project holding both legacy spellings: the 2.3.x file moves, the older 2.1.5 one is judged against it and removed', POSIX_ONLY, () =>
{
    const { result: r, out } = seedRun(['install', 'update'], SEL, {
        args: [[], UPDATE()], inspect: snap,
        each: (repo, i) =>
        {
            if (i !== 0) return;
            const old = path.join(rulesOf(repo), 'baseline-project-run-book.md');
            const mid = path.join(rulesOf(repo), 'alfred-project-run-book.md');
            fs.writeFileSync(old, body('run-book'));
            fs.writeFileSync(mid, 'the 2.3.x capture\n');
            const t = Date.now() / 1000;
            fs.utimesSync(old, t - 3600, t - 3600);
        },
    });
    assert.strictEqual(r.files['alfred-project-awareness.md'], 'the 2.3.x capture\n', 'the newer capture won');
    assert.ok(!('alfred-project-run-book.md' in r.files) && !('baseline-project-run-book.md' in r.files), Object.keys(r.files).join(', '));
    assert.ok(/superseded/.test(out), `the removal was not said: ${out}`);
});

test('the generated set is named, never a prefix: no shipped rule takes a generated name, and every generated name is excluded', () =>
{
    const { GENERATED_RULES, RULE_EXCLUDE } = require('./install/selection.js');
    assert.deepStrictEqual(GENERATED_RULES, NOW);
    for (const f of fs.readdirSync(path.join(__dirname, '..', 'stack', 'rules')))
        assert.ok(!RULE_EXCLUDE.test(f.replace(/\.md$/, '')), `${f} is a shipped rule under a generated name`);
    for (const n of [...Object.values(NOW), 'project-code-style', ...GENERATED.map((g) => `alfred-project-${g}`)]) assert.ok(RULE_EXCLUDE.test(n), n);
    for (const n of ['alfred-memory', 'alfred-project-notes', 'alfred-navigation']) assert.ok(!RULE_EXCLUDE.test(n), `${n} is not generated`);
});
