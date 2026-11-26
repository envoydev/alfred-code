'use strict';
// The verdict of which skills a workspace root holds only for its children (root-children-only-picks, Task 2): pure values in,
// names out. The catalog cases read the shipped meta files; every other case builds its own signals.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const childrenOnly = require('./install/children-only.js');
const { NAME_ONLY, ROOT_SKILLS, trimLogLine, CAP_LINE, catalogLine } = require('./install/children-only-constants.js');

const META = path.join(__dirname, '..', 'meta');
const evidence = require(path.join(META, 'evidence.json'));
const graph = require(path.join(META, 'stack-graph.json'));
const recommendations = require(path.join(META, 'recommendations.json'));

const SKILL = 'angular-conventions';
const signalsFor = (names) => childrenOnly.signalsOf({ names, evidence, graph, stacks: recommendations.stacks });
const base = () => ({
    linked: [SKILL, 'ionic'],
    locked: new Set(),
    children: [{ skills: [SKILL, 'ionic'], sameRepo: false }],
    signals: new Map([[SKILL, { evidence: false, globs: ['**/*.component.ts'] }], ['ionic', { evidence: false, globs: [] }]]),
    evidenceHits: new Set(),
    rootFiles: ['README.md'],
});
const trimmed = (change = {}) => childrenOnly.trimmedSkills({ ...base(), ...change });

test('the constants carry the value, the variable and the three lines', () =>
{
    assert.strictEqual(NAME_ONLY, 'name-only');
    assert.deepStrictEqual({ ...ROOT_SKILLS }, { key: 'ALFRED_CODE_ROOT_SKILLS', own: 'own', all: 'all' });
    assert.strictEqual(trimLogLine('typescript'), '  skills: typescript listed by name at the root - no root file needs it; to list it in full: set "skillOverrides": { "typescript": "on" } in .claude/settings.local.json');
    assert.strictEqual(CAP_LINE, '!! workspace: the root\'s file walk stopped at depth 6 - no skill is trimmed to its name this run');
    assert.strictEqual(catalogLine('meta/evidence.json'), '!! workspace: meta/evidence.json could not be read - no skill is trimmed to its name this run');
});

test('the base case trims the one skill that has a signal, and only it', () =>
{
    assert.deepStrictEqual(trimmed(), [SKILL]);
});

test('a skill the root does not link is not trimmed', () =>
{
    assert.deepStrictEqual(trimmed({ linked: ['ionic'] }), []);
});

test('a locked skill is never trimmed', () =>
{
    assert.deepStrictEqual(trimmed({ locked: new Set([SKILL]) }), []);
});

test('a skill no child holds is not trimmed', () =>
{
    assert.deepStrictEqual(trimmed({ children: [{ skills: ['ionic'], sameRepo: false }] }), []);
    assert.deepStrictEqual(trimmed({ children: [] }), []);
});

test('any same-repository child stops all trimming, whatever it links', () =>
{
    const children = [{ skills: [SKILL], sameRepo: false }, { skills: [SKILL], sameRepo: true }];
    assert.deepStrictEqual(trimmed({ children }), []);
    assert.deepStrictEqual(trimmed({ children: [children[0], { skills: [], sameRepo: true }] }), [], 'its sessions read the root\'s bare keys');
    assert.deepStrictEqual(trimmed({ children: [children[0], { skills: [], sameRepo: false }] }), [SKILL]);
});

test('signalsOf skips a rule or a stack of the wrong shape', () =>
{
    const bad = { rules: { a: { skills: ['x'], paths: '**/*.ts' }, b: null, c: { skills: 'x', paths: ['**/*.cs'] }, d: { skills: ['x'], paths: ['**/*.js'] } } };
    const got = childrenOnly.signalsOf({ names: ['x'], evidence: {}, graph: bad, stacks: { s: null, t: { skills: ['x'], rules: 'a' }, u: { skills: 'x', rules: ['d'] } } });
    assert.deepStrictEqual(got.get('x'), { evidence: false, globs: ['**/*.js'] });
});

test('a no-signal skill is never trimmed', () =>
{
    assert.deepStrictEqual(trimmed({ signals: new Map([['ionic', { evidence: false, globs: [] }]]) }), []);
    assert.deepStrictEqual(trimmed({ signals: new Map() }), []);
});

test('an evidence signal alone makes a skill a candidate, and a scan hit at the root keeps it', () =>
{
    const signals = new Map([[SKILL, { evidence: true, globs: [] }]]);
    assert.deepStrictEqual(trimmed({ signals }), [SKILL]);
    assert.deepStrictEqual(trimmed({ signals, evidenceHits: new Set([SKILL]) }), []);
});

test('a root file matching a glob of the skill keeps it', () =>
{
    assert.deepStrictEqual(trimmed({ rootFiles: ['src/app/x.component.ts'] }), []);
    assert.deepStrictEqual(trimmed({ rootFiles: ['src/app/x.service.ts'] }), [SKILL]);
});

test('the result is sorted', () =>
{
    const signals = new Map([['b-skill', { evidence: true, globs: [] }], ['a-skill', { evidence: true, globs: [] }]]);
    const got = trimmed({ linked: ['b-skill', 'a-skill'], children: [{ skills: ['b-skill', 'a-skill'], sameRepo: false }], signals });
    assert.deepStrictEqual(got, ['a-skill', 'b-skill']);
});

test('a root src/app/x.component.ts keeps angular-conventions and typescript', () =>
{
    const names = ['angular-conventions', 'typescript', 'csharp'];
    const got = childrenOnly.trimmedSkills({
        linked: names, locked: new Set(), children: [{ skills: names, sameRepo: false }],
        signals: signalsFor(names), evidenceHits: new Set(), rootFiles: ['src/app/x.component.ts'],
    });
    assert.deepStrictEqual(got, ['csharp']);
});

test('a stack rule path keeps ionic-security', () =>
{
    const signals = signalsFor(['ionic-security']);
    assert.ok(signals.get('ionic-security').globs.includes('**/src/app/**/*.ts'), 'the glob comes from a rule of the ionic-angular stack');
    const run = (rootFiles) => childrenOnly.trimmedSkills({
        linked: ['ionic-security'], locked: new Set(), children: [{ skills: ['ionic-security'], sameRepo: false }],
        signals, evidenceHits: new Set(), rootFiles,
    });
    assert.deepStrictEqual(run(['src/app/a.ts']), []);
    assert.deepStrictEqual(run(['README.md']), ['ionic-security']);
});

test('a no-signal skill of the real catalog (ionic) is never trimmed', () =>
{
    const signals = signalsFor(['ionic']);
    assert.deepStrictEqual(signals.get('ionic'), { evidence: false, globs: [] });
    const got = childrenOnly.trimmedSkills({
        linked: ['ionic'], locked: new Set(), children: [{ skills: ['ionic'], sameRepo: false }],
        signals, evidenceHits: new Set(), rootFiles: [],
    });
    assert.deepStrictEqual(got, []);
});

test('signalsOf reads evidence.skills and unions the globs of the rules and the stacks', () =>
{
    const got = signalsFor(['angular-material', 'typescript', 'dotnet-testing']);
    assert.strictEqual(got.get('angular-material').evidence, true);
    assert.deepStrictEqual(got.get('dotnet-testing'), { evidence: false, globs: ['**/*.cs'] });
    assert.ok(got.get('typescript').globs.includes('**/*.ts') && got.get('typescript').globs.includes('**/angular.json'));
});
