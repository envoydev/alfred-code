'use strict';
// The three rule fixtures of the G2 rule-adherence A/B (native rules against the loader): a JavaScript path rule,
// the markdown path rule and the navigation rule's large-JSON clause, each graded offline on synthetic transcripts.
const test = require('node:test');
const assert = require('node:assert');
const sc = require('./skill-comply.js');

let seq = 0;
const call = (name, input) => ({ name, input, id: `t${++seq}` });
const tool = (name, input) => row([call(name, input)]);
const row = (calls) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', content: calls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.input })) } });
const say = (text) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'text', text }] } });
const denied = (r) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: r.message.content[0].id, is_error: true, content: 'blocked' }] } });
const result = (text) => ({ type: 'result', result: text });
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

const P = '/work/project';
const verdict = (name, rows, step) =>
{
    const r = sc.grade(sc.loadExpectation(name).data, jsonl(rows), { level: 'plain' });
    return r.steps.find((s) => s.id === step).verdict;
};
const js = (rows) => verdict('rule-javascript-load', rows, 'javascript-before-edit');
const md = (rows) => verdict('rule-markdown-load', rows, 'markdown-style-before-write');
const nav = (rows) => verdict('rule-navigation-large-json', rows, 'queried-not-read-whole');
const edit = (file) => tool('Edit', { file_path: `${P}/${file}`, old_string: 'a', new_string: 'b' });
const ANSWER = [say('There are 37 products with stock 0.'), result('There are 37 products with stock 0.')];
const PROJECT = tool('Bash', { command: "node -e \"console.log(require('./data/catalog.json').filter((p) => p.stock === 0).length)\"" });

test('javascript: the skill before the first .js write is a hit', () =>
{
    assert.strictEqual(js([tool('Read', { file_path: `${P}/src/cart.js` }), tool('Skill', { skill: 'javascript' }), edit('src/money.js'), say('Fixed.')]), 'PASS');
});

test('javascript: a plugin-qualified skill name is a hit', () =>
{
    assert.strictEqual(js([tool('Skill', { skill: 'alfred-code:javascript' }), edit('src/money.js'), say('Fixed.')]), 'PASS');
});

test('javascript: a write before the load is a miss', () =>
{
    assert.strictEqual(js([edit('src/money.js'), tool('Skill', { skill: 'javascript' }), say('Fixed.')]), 'FAIL');
});

test('javascript: one message, the Skill listed first, is a hit; listed second, a miss', () =>
{
    const skill = () => call('Skill', { skill: 'javascript' });
    const write = () => call('Edit', { file_path: `${P}/src/money.js`, old_string: 'a', new_string: 'b' });
    assert.strictEqual(js([row([skill(), write()]), say('Fixed.')]), 'PASS');
    assert.strictEqual(js([row([write(), skill()]), say('Fixed.')]), 'FAIL');
});

test('javascript: a run with no .js write is a miss', () =>
{
    assert.strictEqual(js([tool('Read', { file_path: `${P}/src/cart.js` }), say('The cause is in money.js.')]), 'FAIL');
});

test('markdown: markdown-style before the README write is a hit, after it a miss', () =>
{
    const write = () => edit('README.md');
    assert.strictEqual(md([tool('Skill', { skill: 'markdown-style' }), write(), say('Added.')]), 'PASS');
    assert.strictEqual(md([write(), tool('Skill', { skill: 'markdown-style' }), say('Added.')]), 'FAIL');
});

test('markdown: a write to another .md does not stand in for the README', () =>
{
    assert.strictEqual(md([tool('Skill', { skill: 'markdown-style' }), tool('Write', { file_path: `${P}/NOTES.md`, content: '# Notes' }), say('Added.')]), 'FAIL');
});

test('navigation: a projection and the right count is a hit', () =>
{
    assert.strictEqual(nav([PROJECT, ...ANSWER]), 'PASS');
});

test('navigation: a whole Read of the catalog is a miss, a ranged Read is not', () =>
{
    assert.strictEqual(nav([tool('Read', { file_path: `${P}/data/catalog.json` }), ...ANSWER]), 'FAIL');
    assert.strictEqual(nav([tool('Read', { file_path: `${P}/data/catalog.json`, offset: 1, limit: 40 }), PROJECT, ...ANSWER]), 'PASS');
});

test('navigation: a bare cat of the catalog is a miss', () =>
{
    assert.strictEqual(nav([tool('Bash', { command: 'cat data/catalog.json' }), ...ANSWER]), 'FAIL');
});

test('navigation: a denied whole Read is still a miss', () =>
{
    const whole = tool('Read', { file_path: `${P}/data/catalog.json` });
    assert.strictEqual(nav([whole, denied(whole), PROJECT, ...ANSWER]), 'FAIL');
});

test('navigation: the wrong count is a miss', () =>
{
    assert.strictEqual(nav([PROJECT, say('12 products'), result('12 products')]), 'FAIL');
});

test('the three fixtures pass the expectation check', () =>
{
    for (const name of ['rule-javascript-load', 'rule-markdown-load', 'rule-navigation-large-json'])
        assert.deepStrictEqual(sc.checkExpectation(sc.loadExpectation(name)), [], name);
});
