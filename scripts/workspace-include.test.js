'use strict';
// workspace-include: the pure rules of `workspace.js include` - which joined children a root includes, which it sets aside, and
// what it keeps for the set-aside ones. Plain values, no fakes.
const test = require('node:test');
const assert = require('node:assert');
const { childStates, answerError, applyAnswer, setAsideRels, asideRows, skippedRows, asideHeads, withoutSkipped, lines, flagError, csvOf } = require('./workspace-include/select.js');
const { keepTargets, addKept, pruneKept, storeLines, backstopLines, mapKept, keepLines, keptNotes, settleKept, inheritKept } = require('./workspace-include/keep.js');

test('childStates: asked and included is included, asked only is set aside, not asked is unasked', () =>
    assert.deepStrictEqual(childStates({ children: ['api', 'web', 'docs'], includedChildren: ['api'], includeAsked: ['api', 'web'] }),
        [{ rel: 'api', state: 'included' }, { rel: 'web', state: 'set-aside' }, { rel: 'docs', state: 'unasked' }]));
test('answerError names a rel that is no joined child, and one named by both flags', () =>
{
    assert.match(answerError({ include: ['nope'], setAside: [] }, ['api']), /'nope' is no joined child/);
    assert.match(answerError({ include: ['api'], setAside: ['api'] }, ['api']), /'api' is named by both/);
    assert.strictEqual(answerError({ include: [], setAside: [] }, ['api']), 'include takes --include, --set-aside or --keep');
});
test('answerError refuses a rel named twice in one flag and passes a clean answer', () =>
{
    assert.match(answerError({ include: ['api', 'api'], setAside: [] }, ['api']), /'api' is named twice/);
    assert.strictEqual(answerError({ include: ['api'], setAside: ['web'] }, ['api', 'web']), null);
});
test('applyAnswer merges: an answer about a new child keeps an earlier set-aside one, and keeps its kept lines', () =>
{
    const rec = { children: ['api', 'docs'], includedChildren: [], includeAsked: ['api'], keptFor: { api: ['skill a'], gone: ['skill b'] } };
    applyAnswer(rec, { include: ['docs', 'api'], setAside: [] });
    assert.deepStrictEqual([rec.includedChildren, rec.includeAsked, rec.keptFor], [['docs', 'api'], ['api', 'docs'], { api: ['skill a'] }]);
});
test('applyAnswer sets a child aside without leaving a duplicate in either list', () =>
{
    const rec = { children: ['api', 'web'], includedChildren: ['api', 'web'], includeAsked: ['api', 'web'], keptFor: {} };
    applyAnswer(rec, { include: ['web'], setAside: ['api', 'api'] });
    assert.deepStrictEqual([rec.includedChildren, rec.includeAsked], [['web'], ['api', 'web']]);
});
test('asideRows: a row a middle root set aside is aside, and so is every row below it', () =>
{
    const rows = [{ rel: 'api', parentRel: '', depth: 1 }, { rel: 'api/tool', parentRel: 'api', depth: 2 }, { rel: 'api/tool/x', parentRel: 'api/tool', depth: 3 }];
    const views = { '': { children: ['api'], includedChildren: ['api'], includeAsked: ['api'] }, api: { children: ['tool'], includedChildren: [], includeAsked: ['tool'] } };
    assert.deepStrictEqual([...asideRows(rows, views)], ['api/tool', 'api/tool/x']);
});
test('asideRows reads the top row\'s children under the rel the subtree gives it, and a parent named like a prototype member as no view', () =>
{
    const rows = [{ rel: '.', parentRel: null, depth: 0 }, { rel: 'web', parentRel: '.', depth: 1 }, { rel: 'constructor', parentRel: '.', depth: 1 }, { rel: 'constructor/x', parentRel: 'constructor', depth: 2 }];
    const views = { '.': { children: ['web', 'constructor'], includedChildren: ['constructor'], includeAsked: ['web', 'constructor'] } };
    assert.deepStrictEqual([...asideRows(rows, views)], ['web']);
});
test('setAsideRels lists the set-aside children in order', () =>
    assert.deepStrictEqual(setAsideRels({ children: ['a', 'b', 'c'], includedChildren: ['b'], includeAsked: ['a', 'b'] }), ['a']));
test('lines print one row a child, the count, then each project below; a saved answer says saved', () =>
{
    const rows = [{ rel: 'api', state: 'included' }, { rel: 'web', state: 'set-aside' }, { rel: 'docs', state: 'unasked' }];
    assert.deepStrictEqual(lines(rows, ['api/tool']), ['included: api', 'set-aside: web', 'unasked: docs', 'include: 1 included, 1 set aside, 1 unasked', 'below: api/tool']);
    assert.strictEqual(lines(rows, [], true)[3], 'include: saved 1 included, 1 set aside, 1 unasked');
});
test('csvOf splits on commas and drops empty words; flagError refuses a flag with no value and --keep beside a list flag', () =>
{
    assert.deepStrictEqual([csvOf(undefined), csvOf(''), csvOf('a, b,,c')], [[], [], ['a', 'b', 'c']]);
    assert.match(flagError({ '--include': undefined }), /'--include' needs a value/);
    assert.match(flagError({ '--keep': 'skill a', '--set-aside': 'api' }), /--keep cannot be combined/);
    assert.strictEqual(flagError({ '--keep': 'skill a' }), null);
    assert.strictEqual(flagError({}), null);
});

test('keepTargets keeps a line for every set-aside child that does not ignore it, and refuses a bad line', () =>
{
    const view = { children: ['api', 'web', 'app'], includedChildren: ['web'], includeAsked: ['api', 'web', 'app'], keptFor: {} };
    assert.deepStrictEqual(keepTargets(view, 'skill a', { api: [{ category: 'skill', name: 'a' }] }), { error: null, kept: ['app'], ignoring: ['api'] });
    assert.deepStrictEqual(keepTargets(view, 'plugin typescript-lsp', {}), { error: null, kept: ['api', 'app'], ignoring: [] });
    assert.match(keepTargets(view, 'skill', {}).error, /no ignore entry/);
    assert.match(keepTargets(view, 'skill a b', {}).error, /no ignore entry/);
    assert.match(keepTargets(view, 'skill a', {}, () => false).error, /no ignore entry/);
});
test('keepTargets, addKept and pruneKept read a child named like a prototype member as an ordinary child', () =>
{
    const view = { children: ['constructor'], includedChildren: [], includeAsked: ['constructor'], keptFor: {} };
    assert.deepStrictEqual(keepTargets(view, 'skill a', {}), { error: null, kept: ['constructor'], ignoring: [] });
    const rec = { children: ['constructor'], keptFor: {} };
    addKept(rec, 'constructor', 'skill a');
    addKept(rec, 'constructor', 'skill a');
    assert.ok(Object.hasOwn(rec.keptFor, 'constructor'));
    assert.deepStrictEqual(rec.keptFor.constructor, ['skill a']);
    assert.strictEqual(Object.prototype.constructor, Object);
    assert.deepStrictEqual(pruneKept({ constructor: ['skill a'] }, {}, []), { constructor: ['skill a'] });
    assert.deepStrictEqual(pruneKept({ constructor: ['skill a', 'skill b'] }, { constructor: [{ category: 'skill', name: 'a' }] }, []), { constructor: ['skill b'] });
    assert.deepStrictEqual(storeLines({ children: ['toString'], keptFor: { toString: ['skill a'] } }), ['skill a']);
});
test('addKept adds a line once and drops an entry whose child is no longer joined', () =>
{
    const rec = { children: ['api', 'web'], keptFor: { api: ['skill a'], gone: ['skill b'] } };
    addKept(rec, 'web', 'rule r');
    addKept(rec, 'api', 'skill a');
    addKept(rec, 'api', 'agent g');
    assert.deepStrictEqual(rec.keptFor, { api: ['skill a', 'agent g'], web: ['rule r'] });
});
test('pruneKept drops a line the child ignores or the root holds, and an entry left empty', () =>
    assert.deepStrictEqual(
        pruneKept({ api: ['skill a', 'skill b'], web: ['skill c'], app: ['rule r'] }, { api: ['skill a'], web: [{ category: 'skill', name: 'c' }] }, ['rule r']),
        { api: ['skill b'] }));
test('mapKept renames through the manifest and drops a retired line', () =>
    assert.deepStrictEqual(mapKept(['skill old', 'rule gone', 'plugin p'], { skills: { old: 'new' } }, { rules: ['gone.md'] }),
        { lines: ['skill new', 'plugin p'], renamedPairs: [['skill old', 'skill new']], retiredLines: ['rule gone'] }));
test('mapKept compares a retired agent and rule without .md, a skill as written, and keeps a line once', () =>
    assert.deepStrictEqual(mapKept(['agent old', 'skill old', 'skill new', 'skill s.md'], { skills: { old: 'new' } }, { agents: ['old.md'], skills: ['s'] }),
        { lines: ['skill new', 'skill s.md'], renamedPairs: [['skill old', 'skill new']], retiredLines: ['agent old'] }));
test('backstopLines keeps each dropped own pick for a set-aside child that neither ignores nor already keeps it', () =>
    assert.deepStrictEqual(backstopLines(['skill a', 'skill b', 'rule old'], ['skill b'], { rules: ['old.md'] }, ['api', 'app'], { app: [{ category: 'skill', name: 'a' }] }, { api: [] }),
        { api: ['skill a'] }));
test('backstopLines leaves a line the child already keeps', () =>
    assert.deepStrictEqual(backstopLines(['skill a', 'skill b'], [], {}, ['api'], {}, { api: ['skill a'] }), { api: ['skill b'] }));
test('storeLines holds only skill, agent and rule lines of joined children', () =>
    assert.deepStrictEqual(storeLines({ children: ['api'], keptFor: { api: ['plugin p', 'skill b', 'rule r'], gone: ['skill z'] } }), ['rule r', 'skill b']));
test('keepLines say who kept a line and who ignores it', () =>
    assert.deepStrictEqual(keepLines('skill a', ['app'], ['api']), ['include: kept skill a for app', 'include: api ignores skill a - not kept']));

// A kept key is matched to its child through the caller's fold, as the hook's keptLinesFor does on a disk that folds case.
const fold = (text) => text.toLowerCase();
test('applyAnswer keeps a kept key that differs from its child only in case when the caller folds, and drops it when it does not', () =>
{
    const rec = () => ({ children: ['api'], includedChildren: [], includeAsked: [], keptFor: { API: ['skill a'] } });
    const folded = rec();
    applyAnswer(folded, { include: ['api'], setAside: [] }, fold);
    assert.deepStrictEqual(folded.keptFor, { API: ['skill a'] });
    const exact = rec();
    applyAnswer(exact, { include: ['api'], setAside: [] });
    assert.deepStrictEqual(exact.keptFor, {});
});
test('addKept writes into a case-variant key when the caller folds, and makes a second entry only when it does not', () =>
{
    const folded = { children: ['api'], keptFor: { API: ['skill a'] } };
    addKept(folded, 'api', 'skill b', fold);
    addKept(folded, 'api', 'skill a', fold);
    assert.deepStrictEqual(folded.keptFor, { API: ['skill a', 'skill b'] });
    const exact = { children: ['api'], keptFor: { API: ['skill a'] } };
    addKept(exact, 'api', 'skill b');
    assert.deepStrictEqual(exact.keptFor, { api: ['skill b'] });
});
test('storeLines counts a case-variant key as joined when the caller folds, and not when it does not', () =>
{
    const view = { children: ['api'], keptFor: { API: ['skill a'] } };
    assert.deepStrictEqual(storeLines(view, fold), ['skill a']);
    assert.deepStrictEqual(storeLines(view), []);
});
test('backstopLines reads a line kept under a case-variant key as kept when the caller folds', () =>
{
    const args = [['skill a'], [], {}, ['api'], {}, { API: ['skill a'] }];
    assert.deepStrictEqual(backstopLines(...args, fold), {});
    assert.deepStrictEqual(backstopLines(...args), { api: ['skill a'] });
});
test('withoutSkipped drops a rel a skipped row names, compared the way the caller folds, and keeps the others', () =>
{
    const skipped = new Set(['Api', 'web']);
    assert.deepStrictEqual(withoutSkipped(['api', 'stray', 'web'], skipped, (text) => text.toLowerCase()), ['stray']);
    assert.deepStrictEqual(withoutSkipped(['api', 'stray'], skipped, (text) => text), ['api', 'stray'], 'a caller that does not fold compares as written');
});
test('skippedRows keeps a gone head out and a gone row below an aside row in; asideHeads names only the top of each aside subtree', () =>
{
    const rows = [{ rel: 'api', parentRel: '.', state: 'ok' }, { rel: 'api/old', parentRel: 'api', state: 'gone' }, { rel: 'old', parentRel: '.', state: 'gone' }, { rel: 'api/tool', parentRel: 'api', state: 'ok' }];
    const skipped = skippedRows(rows, new Set(['api', 'api/old', 'old', 'api/tool']));
    assert.deepStrictEqual([...skipped], ['api', 'api/old', 'api/tool']);
    assert.deepStrictEqual(asideHeads(rows, skipped), ['api']);
});

test('settleKept adds the backstop, drops a line the child ignores or the root holds, reads a rename and drops a retired line', () =>
{
    const got = settleKept({
        keptFor: { api: ['skill old', 'skill held', 'skill ignored', 'skill gone'], web: ['skill held'] }, children: ['api', 'web'],
        backstop: { api: ['skill fresh'] }, childIgnores: { api: ['skill ignored'], web: [] }, rootLines: ['skill held'],
        renamed: { skills: { old: 'new' } }, retired: { skills: ['gone'] },
    });
    assert.deepStrictEqual(got.keptFor, { api: ['skill new', 'skill fresh'] });
    assert.deepStrictEqual(got.notes, ['kept line skill old read as skill new', 'kept line skill gone dropped: retired']);
    assert.strictEqual(got.changed, true);
});
test('settleKept reports no change for a record whose lines all stand, and never touches the record it was given', () =>
{
    const keptFor = { api: ['skill a'] };
    const got = settleKept({ keptFor, children: ['api'], childIgnores: { api: [] }, rootLines: [], renamed: {}, retired: {} });
    assert.deepStrictEqual([got.keptFor, got.changed, got.notes], [{ api: ['skill a'] }, false, []]);
    settleKept({ keptFor, children: ['api'], backstop: { api: ['skill b'] }, childIgnores: { api: [] }, rootLines: [], renamed: {}, retired: {} });
    assert.deepStrictEqual(keptFor, { api: ['skill a'] });
});
test('settleKept reads a prototype-member child key as an ordinary child', () =>
{
    const keptFor = Object.fromEntries([['constructor', ['skill a']]]);
    const got = settleKept({ keptFor, children: ['constructor'], childIgnores: { constructor: ['skill a'] }, rootLines: [], renamed: {}, retired: {} });
    assert.deepStrictEqual(got.keptFor, {});
});
test('inheritKept adds the kept lines to the parent\'s once, through the manifest', () =>
{
    const got = inheritKept(['skill a', 'skill b'], ['skill b', 'skill old', 'skill gone', 'plugin p'], { skills: { old: 'new' } }, { skills: ['gone'] });
    assert.deepStrictEqual(got.lines, ['skill a', 'skill b', 'skill new', 'plugin p']);
    assert.deepStrictEqual(got.notes, keptNotes({ renamedPairs: [['skill old', 'skill new']], retiredLines: ['skill gone'] }));
});
test('inheritKept with nothing kept is the parent\'s lines as they were', () =>
    assert.deepStrictEqual(inheritKept(['skill a'], [], {}, {}), { lines: ['skill a'], notes: [] }));

test('settleKept reads a rename before it prunes: a renamed line the root holds under its new name is gone in one run', () =>
{
    const got = settleKept({ keptFor: { api: ['skill old'] }, children: ['api'], childIgnores: { api: [] }, rootLines: ['skill new'], renamed: { skills: { old: 'new' } }, retired: {} });
    assert.deepStrictEqual([got.keptFor, got.changed, got.notes], [{}, true, ['kept line skill old read as skill new']]);
    const ignored = settleKept({ keptFor: { api: ['skill old'] }, children: ['api'], childIgnores: { api: ['skill new'] }, rootLines: [], renamed: { skills: { old: 'new' } }, retired: {} });
    assert.deepStrictEqual(ignored.keptFor, {}, 'a child that ignores the new name drops the line too');
});
test('settleKept drops an entry whose child left the workspace on every read, matching the child the way the caller folds', () =>
{
    const keptFor = { api: ['skill a'], gone: ['skill b'] };
    const got = settleKept({ keptFor, children: ['api'], childIgnores: { api: [], gone: [] }, rootLines: [], renamed: {}, retired: {} });
    assert.deepStrictEqual([got.keptFor, got.changed], [{ api: ['skill a'] }, true]);
    const folded = settleKept({ keptFor: { API: ['skill a'] }, children: ['api'], childIgnores: { API: [] }, rootLines: [], renamed: {}, retired: {}, low: (text) => text.toLowerCase() });
    assert.deepStrictEqual([folded.keptFor, folded.changed], [{ API: ['skill a'] }, false]);
});
