'use strict';
// D8 (spec docs/superpowers/specs/2026-11-03-d8-heavy-session-seats-design.md): the engine half - a model's family,
// tier and price multiple against the seats' own pins - and the hook half (appended by the next task).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const eng = require(path.join(ROOT, 'stack', 'hooks', 'fresh-session.js'));

test('modelFamily reads the family out of every Claude id form', () => {
    for (const [id, fam] of [['claude-opus-5-5', 'opus'], ['claude-sonnet-5-5-20261001', 'sonnet'], ['us.anthropic.claude-fable-5-1-v1:0', 'fable'],
        ['claude-opus-5-5[1m]', 'opus'], ['claude-haiku-5-5', 'haiku'], ['claude-mythos-5-1', 'mythos'], ['claude-3-5-haiku', 'haiku']])
        assert.equal(eng.modelFamily(id), fam, id);
    for (const id of [null, '', 'opus', 'claude-foo-9', 'gpt-5']) assert.equal(eng.modelFamily(id), null, String(id));
});
test('priceMultiple gives one ratio or a range, null for an unknown row', () => {
    assert.equal(eng.priceMultiple('claude-opus-5-5', 'claude-sonnet-5-5'), '2x');
    assert.equal(eng.priceMultiple('claude-fable-5-1', 'claude-sonnet-5-5'), '2.5x-5x');
    assert.equal(eng.priceMultiple('claude-fable-5-1', 'claude-opus-5-5'), '1.25x-2.5x');
    assert.equal(eng.priceMultiple('claude-opus-9', 'claude-sonnet-5-5'), null);
});
test('seatsFacts: designers only above opus', () => {
    assert.deepEqual(eng.seatsFacts('claude-opus-5-5'), { id: 'claude-opus-5-5', family: 'opus', tier: 3, multiple: '2x', designers: null });
    assert.equal(eng.seatsFacts('claude-fable-5-1').designers, '1.25x-2.5x');
    assert.equal(eng.seatsFacts('claude-foo-9'), null);
});
test('the tier table and the seat ids are frozen and ordered', () => {
    assert.ok(Object.isFrozen(eng.MODEL_TIER) && Object.isFrozen(eng.SEAT_IDS) && Object.isFrozen(eng.SEAT_PRICE));
    assert.deepEqual({ ...eng.MODEL_TIER }, { haiku: 1, sonnet: 2, opus: 3, fable: 4, mythos: 4 });
    assert.deepEqual({ ...eng.SEAT_IDS }, { sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' });
});
test('every seat pin matches the tier table', () => {
    const dir = path.join(ROOT, 'stack', 'agents');
    const seen = { implementer: 0, verifier: 0, resolver: 0 };
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.md'))) {
        const name = f.replace(/\.md$/, '');
        const fm = /^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
        const model = fm && /^model:\s*(\S+)/m.exec(fm[1]);
        assert.ok(model, `${name} has a model pin`);
        if (/-(implementer|verifier|resolver|analyzer)$|^evidence-gatherer$/.test(name)) assert.equal(model[1], 'sonnet', name);
        if (/-solution-designer$|^security-auditor$/.test(name)) assert.equal(model[1], 'opus', name);
        for (const k of Object.keys(seen)) if (name.endsWith('-' + k)) seen[k]++;
    }
    assert.ok(seen.implementer >= 10 && seen.verifier >= 10 && seen.resolver >= 4, JSON.stringify(seen));
});
