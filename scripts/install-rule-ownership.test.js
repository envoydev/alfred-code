'use strict';
// Who owns a rule file (the final review of layered native rules): an unmarked file the stamp does not record is the
// user's even under an `alfred-` name, kept byte for byte and named once as `kept, yours`; the stack takes one over only
// from a stamp that predates library rules. A marked file in `.claude/rules` is the stack's native copy, never the
// library copy - a joined child that lost its root still keeps the rule it picked, in its own store and natively.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const { SOURCE, CHILD, TOP, at, join, demote, runSteps } = require('./child-world-fixture.js');
const stampLib = require('./install/stamp.js');
const nativeRules = require('./install/native-rules.js');

const RULE = 'alfred-security';
const MINE = 'MY OWN RULE TEXT\n';
const OLD_TEXT = 'an older copy of the rule, edited long ago\n';
const SELECTION = `skill markdown-style\nrule ${RULE}\nrule alfred-interaction\n`;
const KEPT_LINE = new RegExp(`!! rule kept(, yours)?: (\\.claude/rules/)?${RULE}`);

const claudeRule = (repo, name = RULE) => path.join(repo, '.claude', 'rules', `${name}.md`);
const storeRule = (repo, name = RULE) => path.join(repo, '.alfred', 'stack', 'rules', `${name}.md`);
const stampOf = (repo) => path.join(repo, '.claude', 'alfred-code.stamp');
const readOr = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const named = (out, name) => out.split('\n').filter((l) => l.includes(name) && /!! rule/.test(l));
// the stamp as an older release wrote it: no library line of any kind
const stripLibrary = (repo) => { for (const key of ['library-skills', 'library-agents', 'library-rules']) stampLib.markLine(stampOf(repo), key, null); };
// the stamp as a library-rules release wrote it, but without one rule's record
const forget = (repo, name) => stampLib.markLine(stampOf(repo), 'library-rules',
    (new RegExp('^library-rules: (.*)$', 'm').exec(fs.readFileSync(stampOf(repo), 'utf8'))[1]).split(',').filter((s) => !s.trim().startsWith(`${name}=`)).join(','));
const clear = (repo) => { fs.rmSync(storeRule(repo), { force: true }); fs.rmSync(claudeRule(repo), { force: true }); };

test('an alfred- rule file the user wrote, unmarked and with no stamp record, stays theirs on a fresh install and every update', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update', 'update'], SELECTION, {
        prepare: (repo) => { fs.mkdirSync(path.dirname(claudeRule(repo)), { recursive: true }); fs.writeFileSync(claudeRule(repo), MINE); },
        each: (repo) => ({ text: readOr(claudeRule(repo)), store: readOr(storeRule(repo)) }),
    });
    for (const [i, s] of steps.entries())
    {
        assert.strictEqual(s.text, MINE, `step ${i}: the user's bytes stay`);
        assert.notStrictEqual(s.store, MINE, `step ${i}: the user's text is not in the store`);
        assert.strictEqual(named(outs[i], RULE).length, 1, `step ${i}: named once as kept, yours:\n${named(outs[i], RULE).join('\n')}`);
        assert.match(outs[i], KEPT_LINE);
        assert.doesNotMatch(outs[i], /taking over a copy the stamp did not record: rule/);
    }
});

test('an update over a stamp that records rules, but not this alfred- one, keeps the user\'s unmarked file', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update', 'update'], SELECTION, {
        each: (repo, i) =>
        {
            if (i === 0) { clear(repo); forget(repo, RULE); fs.writeFileSync(claudeRule(repo), MINE); }
            return { text: readOr(claudeRule(repo)) };
        },
    });
    for (const i of [1, 2])
    {
        assert.strictEqual(steps[i].text, MINE, `update ${i}: the user's bytes stay`);
        assert.strictEqual(named(outs[i], RULE).length, 1, `update ${i}: named once:\n${named(outs[i], RULE).join('\n')}`);
        assert.doesNotMatch(outs[i], /taking over a copy the stamp did not record: rule alfred-security/);
    }
});

test('a stamp that predates library rules still lets the stack take over its own alfred- copy', POSIX_ONLY, () =>
{
    const { out, result } = seedRun(['install', 'update'], SELECTION, {
        each: (repo, i) => { if (i === 0) { clear(repo); stripLibrary(repo); fs.writeFileSync(claudeRule(repo), OLD_TEXT); } return null; },
        inspect: (repo) => ({ native: readOr(claudeRule(repo)), store: readOr(storeRule(repo)) }),
    });
    assert.strictEqual(result.store, fs.readFileSync(path.join(SOURCE, 'stack', 'rules', `${RULE}.md`), 'utf8'), 'the store holds the stack\'s text');
    assert.ok(nativeRules.hasMarker(result.native), 'the native copy is the stack\'s, marked');
    assert.doesNotMatch(out, KEPT_LINE);
});

// the stamp as a release that recorded rules wrote it when none was picked: the `library-rules:` line is there and empty
const emptyRuleLine = (repo) => stampLib.markLine(stampOf(repo), 'library-rules', '');
const stackText = (name) => fs.readFileSync(path.join(SOURCE, 'stack', 'rules', `${name}.md`), 'utf8');
const EDIT = '\nMY EDIT BELOW THE STACK\'S FIRST LINE\n';
const editedCopy = (name) => `${stackText(name)}${EDIT}`;

test('a stamp with an empty library-rules line records rules, so an unmarked alfred- file stays the user\'s', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update', 'update'], SELECTION, {
        each: (repo, i) =>
        {
            if (i === 0) { clear(repo); emptyRuleLine(repo); fs.writeFileSync(claudeRule(repo), MINE); }
            return { text: readOr(claudeRule(repo)) };
        },
    });
    for (const i of [1, 2])
    {
        assert.strictEqual(steps[i].text, MINE, `update ${i}: the user's bytes stay`);
        assert.doesNotMatch(outs[i], /taking over a copy the stamp did not record: rule alfred-security/);
        assert.strictEqual(named(outs[i], RULE).length, 1, `update ${i}: named once:\n${named(outs[i], RULE).join('\n')}`);
    }
});

test('an edited copy that keeps a stack rule\'s first line is the user\'s on a fresh install and under a stamp that records rules', POSIX_ONLY, () =>
{
    const NAMES = [RULE, 'typescript-conventions'];
    const sel = `${SELECTION}rule typescript-conventions\n`;
    const fresh = seedRun(['install', 'update'], sel, {
        prepare: (repo) => { fs.mkdirSync(path.dirname(claudeRule(repo)), { recursive: true }); for (const n of NAMES) fs.writeFileSync(claudeRule(repo, n), editedCopy(n)); },
        each: (repo) => Object.fromEntries(NAMES.map((n) => [n, readOr(claudeRule(repo, n))])),
    });
    const recorded = seedRun(['install', 'update', 'update'], sel, {
        each: (repo, i) =>
        {
            if (i === 0) for (const n of NAMES) { fs.rmSync(storeRule(repo, n), { force: true }); fs.rmSync(claudeRule(repo, n), { force: true }); forget(repo, n); fs.writeFileSync(claudeRule(repo, n), editedCopy(n)); }
            return Object.fromEntries(NAMES.map((n) => [n, readOr(claudeRule(repo, n))]));
        },
    });
    for (const [label, run, from] of [['fresh', fresh, 0], ['recorded', recorded, 1]])
        for (const n of NAMES)
            for (let i = from; i < run.steps.length; i++)
            {
                assert.strictEqual(run.steps[i][n], editedCopy(n), `${label} step ${i}: ${n} keeps the user's edits`);
                assert.strictEqual(named(run.outs[i], n).length, 1, `${label} step ${i}: ${n} named once:\n${named(run.outs[i], n).join('\n')}`);
                assert.doesNotMatch(run.outs[i], new RegExp(`taking over a copy the stamp did not record: rule ${n}`));
            }
});

// ---- a joined child that lost its root ----
const PICK = 'wpf-conventions';
const SEL = { [TOP]: `skill markdown-style\nrule ${RULE}\n`, [CHILD]: `skill markdown-style\nrule ${RULE}\nrule ${PICK}\n` };
const childState = (work) => ({ native: readOr(claudeRule(at(work, CHILD), PICK)), store: readOr(storeRule(at(work, CHILD), PICK)) });

test('a joined child that lost its root keeps the rule it picked - in its own store and natively, with no kept or removed line', POSIX_ONLY, () =>
{
    const { outs, steps } = runSteps([
        { at: TOP, act: 'install', sel: SEL[TOP], after: join },
        { at: CHILD, act: 'install', sel: SEL[CHILD], after: demote },
        { at: CHILD, act: 'update', sel: SEL[CHILD], after: childState },
    ]);
    const source = fs.readFileSync(path.join(SOURCE, 'stack', 'rules', `${PICK}.md`), 'utf8');
    const after = steps[2];
    assert.strictEqual(after.store, source, `the child's store holds the rule:\n${outs[2]}`);
    assert.strictEqual(after.native, nativeRules.withMarker(source), 'the child\'s native file is the marked copy');
    assert.doesNotMatch(outs[2], new RegExp(`${PICK}.*kept`), 'no kept line for it');
    assert.doesNotMatch(outs[2], new RegExp(`removed: \\.claude/rules/${PICK}`), 'no removed line for it');
});
