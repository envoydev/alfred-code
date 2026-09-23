'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load, armHash, resolve, ARMS_DIR } = require('./arms.js');

const COMMON = {
    model: 'claude-sonnet-5',
    effort: 'medium',
    permissionMode: 'acceptEdits',
    settings: 'harness.settings.json',
    env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' },
    graceSec: 10,
    auth: ['ANTHROPIC_API_KEY'],
    scrub: ['CONTEXT7_API_KEY'],
};
const ARM = { name: 'solo', pin: { kind: 'tag', value: 'v1.0.0' }, setup: [['git', 'clone', '{root}', '{src}']], onboarding: ['/init'], env: {} };

function armsDir(t, { common = COMMON, arms = [ARM] } = {})
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-arms-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, 'common.json'), JSON.stringify(common));
    fs.writeFileSync(path.join(dir, 'harness.settings.json'), JSON.stringify({ sandbox: { enabled: true } }));
    for (const a of arms) fs.writeFileSync(path.join(dir, `${a.name}.json`), JSON.stringify(a));
    return dir;
}

test('the four shipped arm files load against the shared session', () =>
{
    const { session, arms } = load({ dir: ARMS_DIR, names: ['ours', 'ecc', 'bare', 'baseline'] });
    assert.deepStrictEqual(arms.map((a) => a.name), ['ours', 'ecc', 'bare', 'baseline']);
    assert.strictEqual(session.model, 'claude-sonnet-5');
    assert.strictEqual(session.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS, '1');
    assert.strictEqual(session.settings.sandbox.enabled, true);
    for (const a of arms) assert.match(a.hash, /^[0-9a-f]{64}$/);
});

test('an arm naming a model, an effort or a permission mode is refused, by name', (t) =>
{
    for (const key of ['model', 'effort', 'permissionMode'])
    {
        const dir = armsDir(t, { arms: [{ ...ARM, [key]: 'x' }] });
        assert.throws(() => load({ dir, names: ['solo'] }), new RegExp(`solo.*${key}.*common\\.json`));
    }
});

test('a missing field is named', (t) =>
{
    for (const key of ['pin', 'setup', 'onboarding'])
    {
        const arm = { ...ARM };
        delete arm[key];
        const dir = armsDir(t, { arms: [arm] });
        assert.throws(() => load({ dir, names: ['solo'] }), new RegExp(`solo: missing ${key}`));
    }
    const dir = armsDir(t, { common: { ...COMMON, model: undefined } });
    assert.throws(() => load({ dir, names: ['solo'] }), /common\.json: missing model/);
});

test('an unknown key, a bad setup step and a name that is not the file are refused', (t) =>
{
    assert.throws(() => load({ dir: armsDir(t, { arms: [{ ...ARM, sttup: [] }] }), names: ['solo'] }), /solo: unknown key sttup/);
    assert.throws(() => load({ dir: armsDir(t, { arms: [{ ...ARM, setup: ['git clone x'] }] }), names: ['solo'] }), /solo: setup\[0\] is not a command/);
    const dir = armsDir(t);
    fs.writeFileSync(path.join(dir, 'other.json'), JSON.stringify(ARM));
    assert.throws(() => load({ dir, names: ['other'] }), /other\.json: name is 'solo'/);
    assert.throws(() => load({ dir, names: ['nope'] }), /no arm 'nope'/);
});

test('an arm env cannot override what the harness or common.json owns', (t) =>
{
    for (const key of ['CLAUDE_CONFIG_DIR', 'HOME', 'ANTHROPIC_API_KEY', 'CONTEXT7_API_KEY', 'CLAUDE_CODE_DISABLE_BACKGROUND_TASKS'])
    {
        const dir = armsDir(t, { arms: [{ ...ARM, env: { [key]: '1' } }] });
        assert.throws(() => load({ dir, names: ['solo'] }), new RegExp(`solo: env ${key} is the harness's`));
    }
});

test('the pin hash changes with the pin value and the session, never with a note', () =>
{
    const session = { model: 'claude-sonnet-5', effort: 'medium', permissionMode: 'acceptEdits', settings: {} };
    const h = armHash(ARM, session);
    assert.notStrictEqual(armHash({ ...ARM, pin: { kind: 'tag', value: 'v1.0.1' } }, session), h);
    assert.notStrictEqual(armHash(ARM, { ...session, model: 'claude-opus-5-5' }), h);
    assert.strictEqual(armHash({ _note: 'why', ...ARM }, session), h);
    assert.strictEqual(armHash({ env: {}, onboarding: ['/init'], setup: ARM.setup, pin: ARM.pin, name: 'solo' }, session), h);
});

test('a run-level override replaces model and effort for every arm, and is validated', (t) =>
{
    const dir = armsDir(t);
    const base = load({ dir, names: ['solo'] });
    const opus = load({ dir, names: ['solo'], override: { model: 'claude-opus-5-5', effort: 'high' } });
    assert.strictEqual(opus.session.model, 'claude-opus-5-5');
    assert.strictEqual(opus.session.effort, 'high');
    assert.notStrictEqual(opus.arms[0].hash, base.arms[0].hash);
    assert.throws(() => load({ dir, names: ['solo'], override: { effort: 'huge' } }), /effort 'huge'/);
});

test('an arm using a placeholder the template does not define is refused at load', (t) =>
{
    const dir = armsDir(t, { arms: [{ ...ARM, setup: [['cp', '{run}/x', '{src}']] }] });
    assert.throws(() => load({ dir, names: ['solo'] }), /solo: unknown placeholder \{run\}/);
});

test('resolve fills every placeholder in strings, arrays and objects, and names an unknown one', () =>
{
    const vars = { src: '/t/src', repo: '/t/repo' };
    assert.deepStrictEqual(resolve([['git', '-C', '{src}', 'log'], { cwd: '{repo}' }], vars), [['git', '-C', '/t/src', 'log'], { cwd: '/t/repo' }]);
    assert.strictEqual(resolve('{src}/a/{src}', vars), '/t/src/a//t/src');
    assert.throws(() => resolve('{home}/x', vars), /unknown placeholder \{home\}/);
});
