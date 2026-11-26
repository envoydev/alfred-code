'use strict';
// What a root hides of its children's (workspace-include/hide.js): pure, plain values and no fake.
const test = require('node:test');
const assert = require('node:assert');
const hide = require('./workspace-include/hide.js');

const keys = (children, listed) => hide.hiddenSkillKeys({ children, listed });

test('a child\'s linked stack skill the root lists gets a key', () =>
{
    const children = [{ rel: 'web-app', skills: hide.stackSkillNames([{ path: 'skills/npm', kind: 'symlink', hash: '' }], []) }];
    assert.deepStrictEqual(keys(children, ['npm', 'typescript']), ['web-app:npm']);
});

test('a child\'s stack skill the root does not list gets no key', () =>
{
    const children = [{ rel: 'web-app', skills: ['angular-core', 'npm'] }];
    assert.deepStrictEqual(keys(children, ['npm']), ['web-app:npm']);
    assert.deepStrictEqual(keys(children, ['typescript']), []);
});

test('a hand-made child folder no record names gets no key: the names come from the links and library lines alone', () =>
{
    assert.deepStrictEqual(hide.stackSkillNames([], []), []);
    assert.deepStrictEqual(hide.stackSkillNames([{ path: 'agents/seat', kind: 'symlink', hash: '' }], []), [], 'a seat link is no skill');
});

test('a copy-route child gets a key for each skill its library line names, once when its links name it too', () =>
{
    const skills = hide.stackSkillNames([{ path: 'skills/npm', kind: 'copy', hash: 'a'.repeat(64) }], ['npm', 'typescript']);
    assert.deepStrictEqual(skills, ['npm', 'typescript']);
    assert.deepStrictEqual(keys([{ rel: 'api', skills }], ['npm', 'typescript']), ['api:npm', 'api:typescript']);
});

test('a grandchild\'s key carries its whole path from the root', () =>
{
    assert.deepStrictEqual(keys([{ rel: 'child/grand', skills: ['npm'] }], ['npm']), ['child/grand:npm']);
});

test('belowRows keeps every project below the top, set aside or included, and leaves out the top and a gone child', () =>
{
    const rows = [
        { rel: '.', depth: 0, parentRel: null, state: 'ok' },
        { rel: 'api', depth: 1, parentRel: '.', state: 'ok' },
        { rel: 'old', depth: 1, parentRel: '.', state: 'gone' },
        { rel: 'api/tool', depth: 2, parentRel: 'api', state: 'ok' },
    ];
    assert.deepStrictEqual(hide.belowRows(rows).map((row) => row.rel), ['api', 'api/tool'], 'the top and a gone child are left out');
});

test('keptRuleNames reads only rule lines and leaves the rules the root lists itself', () =>
{
    assert.deepStrictEqual(hide.keptRuleNames(['rule b', 'skill s', 'rule a', 'rule own', 'rule a'], ['own']), ['a', 'b']);
});

test('ruleKeepers puts a middle root\'s keeper under its path from the top', () =>
{
    const records = [
        { rel: '.', view: { keptFor: { api: ['rule r', 'skill s'] } } },
        { rel: 'api', view: { keptFor: { tool: ['rule q'] } } },
        { rel: 'web', view: {} },
    ];
    assert.deepStrictEqual(hide.ruleKeepers(records), [{ name: 'r', rel: 'api' }, { name: 'q', rel: 'api/tool' }]);
});

test('ruleVerdicts hides a rule only while no keeper shares the root\'s settings, and leaves one no record names', () =>
{
    const keepers = [{ name: 'a', rel: 'api' }, { name: 'b', rel: 'api' }, { name: 'b', rel: 'web' }, { name: 'c', rel: 'web' }];
    const got = hide.ruleVerdicts({ rules: ['a', 'b', 'c', 'nobody'], keepers, shares: (rel) => rel === 'web' });
    assert.deepStrictEqual(got.hide, ['a']);
    assert.deepStrictEqual(got.stays, [{ name: 'b', rel: 'web' }, { name: 'c', rel: 'web' }]);
});
