'use strict';
// workspace-include: the pure rules of `workspace.js include` - which joined children a root includes, which it sets aside, and
// what it keeps for the set-aside ones. Plain values, no fakes.
const test = require('node:test');
const assert = require('node:assert');
const { childStates, answerError, applyAnswer, setAsideRels, asideRows, lines, flagError, csvOf } = require('./workspace-include/select.js');
const { keepTargets, addKept, pruneKept, storeLines, backstopLines, mapKept, keepLines } = require('./workspace-include/keep.js');

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
