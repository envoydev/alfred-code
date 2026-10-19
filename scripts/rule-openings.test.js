'use strict';
// meta/rule-openings.json and its generator (scripts/install/rule-openings.js): every opening line a stack rule has
// shipped, from git history and the working tree, append-only - the rule twin of meta/skill-headings.json, read by the
// installer's M3 rule claim (audit 2026-10-20 C23). The last case holds the shipped file to the working tree.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { openingOf, openingHash, pastOpenings, stackOpening, write } = require('./install/rule-openings.js');

const ROOT = path.join(__dirname, '..');
const roots = [];
test.after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });
const rule = (opening) => `---\npaths: ["**/*.md"]\n---\n\n${opening}\nmore text\n`;

function repo()
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-openings-'));
    roots.push(root);
    const git = (...a) => execFileSync('git', ['-C', root, ...a], { stdio: 'ignore' });
    git('init', '-q');
    git('config', 'user.email', 't@example.invalid');
    git('config', 'user.name', 't');
    git('config', 'commit.gpgsign', 'false');
    const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
    const commit = (msg) => { git('add', '-A'); git('commit', '-q', '-m', msg); };
    return { root, put, commit, git };
}

test('openingOf: the first non-blank line after any frontmatter, CRLF and trailing blanks dropped; null on an empty body', () =>
{
    assert.equal(openingOf(rule('Open here.')), 'Open here.');
    assert.equal(openingOf('---\r\npaths: x\r\n---\r\n\r\nOpen here.  \r\nmore\r\n'), 'Open here.');
    assert.equal(openingOf('No frontmatter.\n'), 'No frontmatter.');
    assert.equal(openingOf('---\npaths: x\n---\n\n\n'), null);
});

test('the generator records every opening a shipped rule had - the rules/ and claude/rules/ layouts, history, the working tree - keeps what the file held, and drops a name no longer shipped', () =>
{
    const r = repo();
    r.put('rules/demo.md', rule('first layout'));
    r.put('claude/rules/demo.md', rule('second layout'));
    r.put('rules/gone.md', rule('retired since'));
    r.commit('a');
    r.put('stack/rules/demo.md', rule('v1'));
    r.git('rm', '-q', '-r', 'rules', 'claude');
    r.commit('b');
    r.put('stack/rules/demo.md', rule('v2 uncommitted'));
    r.put('stack/rules/notes.txt', 'not a rule\n');
    fs.mkdirSync(path.join(r.root, 'meta'));
    fs.writeFileSync(path.join(r.root, 'meta', 'rule-openings.json'), JSON.stringify({ rules: { demo: ['00000000deadbeef'], gone: ['00000000cafef00d'] } }));

    assert.equal(write(r.root).changed, true);
    const past = pastOpenings(r.root);
    for (const o of ['first layout', 'second layout', 'v1', 'v2 uncommitted']) assert.ok(past.get('demo').has(openingHash(o)), o);
    assert.ok(past.get('demo').has('00000000deadbeef'), 'append-only: a hash the file held stays');
    assert.equal(past.has('gone'), false, 'a name no longer shipped is dropped');
    assert.equal(past.has('notes'), false, 'only .md files are rules');
    assert.equal(write(r.root).changed, false, 'a second run writes nothing');
});

test('pastOpenings: a missing or garbled file is an empty map, never a throw', () =>
{
    const r = repo();
    assert.equal(pastOpenings(r.root).size, 0);
    fs.mkdirSync(path.join(r.root, 'meta'));
    fs.writeFileSync(path.join(r.root, 'meta', 'rule-openings.json'), '{ not json');
    assert.equal(pastOpenings(r.root).size, 0);
});

test('stackOpening: the current opening or a past one claims; other words, an empty file or no file do not', () =>
{
    const past = new Map([['demo', new Set([openingHash('an older opening')])]]);
    const current = rule('the current opening');
    assert.equal(stackOpening('demo', rule('the current opening'), current, past), true);
    assert.equal(stackOpening('demo', rule('an older opening'), current, past), true);
    assert.equal(stackOpening('demo', rule('our own words'), current, past), false);
    assert.equal(stackOpening('demo', '', current, past), false);
    assert.equal(stackOpening('demo', null, current, past), false);
    assert.equal(stackOpening('other', rule('an older opening'), null, past), false, 'a past opening claims only under its own name');
});

test('meta/rule-openings.json holds every shipped rule\'s CURRENT opening - run `node scripts/install/rule-openings.js` after an opening changes', () =>
{
    const past = pastOpenings(ROOT);
    assert.ok(past.size, 'meta/rule-openings.json is missing or unreadable');
    const dir = path.join(ROOT, 'stack', 'rules');
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.md')))
    {
        const name = file.slice(0, -3);
        const opening = openingOf(fs.readFileSync(path.join(dir, file), 'utf8'));
        assert.ok(past.get(name) && past.get(name).has(openingHash(opening)), `stack/rules/${file}: its opening is not in meta/rule-openings.json`);
    }
});
