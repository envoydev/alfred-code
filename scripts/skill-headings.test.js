'use strict';
// meta/skill-headings.json and its generator: every SKILL.md heading the stack has shipped, from git history and the
// working tree, append-only - and lint check 64, which holds the current headings to it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { headingOf, headingHash, pastHeadings } = require('./install/skill-headings.js');
const { write } = require('./skill-headings.js');
const { lintSkillHeadings } = require('./lint-skills.js');

const roots = [];
test.after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });
const md = (name, description) => `---\nname: ${name}\ndescription: ${description}\n---\n\nbody\n`;

function repo()
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'headings-'));
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

test('headingOf: name and description as written, CRLF and trailing blanks dropped; null with no frontmatter or name', () =>
{
    assert.equal(headingOf(md('demo', '"Use when x."')), 'demo\n"Use when x."');
    assert.equal(headingOf('---\r\nname: demo  \r\ndescription: d \r\n---\r\nbody\r\n'), 'demo\nd');
    assert.equal(headingOf('# no frontmatter\n'), null);
    assert.equal(headingOf('---\ndescription: d\n---\n'), null);
    assert.equal(headingOf('---\nname: demo\n---\n'), 'demo\n', 'a missing description is an empty one');
});

test('the generator records every heading a shipped skill had - the old skills/ layout, history, the working tree - keeps what the file held, and drops a name no longer shipped', () =>
{
    const r = repo();
    r.put('skills/demo/SKILL.md', md('demo', 'first layout'));
    r.put('skills/gone/SKILL.md', md('gone', 'retired since'));
    r.commit('a');
    r.put('stack/skills/demo/SKILL.md', md('demo', 'v1'));
    r.git('rm', '-q', '-r', 'skills');
    r.commit('b');
    r.put('stack/skills/demo/SKILL.md', md('demo', 'v2'));
    r.commit('c');
    r.put('stack/skills/demo/SKILL.md', md('demo', 'v3 uncommitted'));
    r.put('stack/skills/demo/references/SKILL.md', md('nested', 'not a skill root'));
    fs.mkdirSync(path.join(r.root, 'meta'));
    fs.writeFileSync(path.join(r.root, 'meta', 'skill-headings.json'), JSON.stringify({ skills: { demo: ['00000000deadbeef'], gone: ['00000000cafef00d'] } }));

    const res = write(r.root);
    assert.equal(res.changed, true);
    const past = pastHeadings(r.root);
    const has = (name, heading) => Boolean(past.get(name) && past.get(name).has(headingHash(heading)));
    for (const v of ['first layout', 'v1', 'v2', 'v3 uncommitted']) assert.ok(has('demo', `demo\n${v}`), `demo ${v}`);
    assert.ok(past.get('demo').has('00000000deadbeef'), 'a hash the file held stays (a shallow clone drops nothing)');
    assert.ok(!past.has('gone'), 'a name the stack no longer ships is left out - the rename and prune paths own it');
    assert.ok(!past.has('references') && !past.has('nested'), 'only <dir>/<name>/SKILL.md is a skill');
    assert.equal(write(r.root).changed, false, 'a second run writes nothing');
});

test('lint check 64: a current heading missing from the file is a finding; a missing file is one finding', () =>
{
    const r = repo();
    r.put('stack/skills/demo/SKILL.md', md('demo', 'v1'));
    r.commit('a');
    assert.deepEqual(lintSkillHeadings(r.root), ['meta/skill-headings.json is missing or unreadable - run `npm run skill-headings` (check 64)']);
    write(r.root);
    assert.deepEqual(lintSkillHeadings(r.root), []);
    r.put('stack/skills/demo/SKILL.md', md('demo', 'v2'));
    assert.equal(lintSkillHeadings(r.root).length, 1);
    assert.match(lintSkillHeadings(r.root)[0], /stack\/skills\/demo\/SKILL\.md: its heading .*npm run skill-headings/);
    write(r.root);
    assert.deepEqual(lintSkillHeadings(r.root), [], 'the generator run clears it, the old heading kept');
    assert.ok(pastHeadings(r.root).get('demo').has(headingHash('demo\nv1')));
});

// The real file: the pre-2.1.2 javascript heading (a ~720-char description, the shape 42 unrecorded copies in two
// installs still held on 2026-10-16) is in it, so update takes such a copy over.
test('the shipped file holds a pre-cap heading the installs still carry, and every current heading', () =>
{
    const past = pastHeadings(path.join(__dirname, '..'));
    const old = execOld();
    if (old) assert.ok(past.get('javascript').has(headingHash(headingOf(old))), 'the pre-cap javascript heading');
    assert.deepEqual(lintSkillHeadings(), []);
});

function execOld()
{
    try { return execFileSync('git', ['-C', path.join(__dirname, '..'), 'show', '70fdd7c7^:stack/skills/javascript/SKILL.md'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch { return null; }   // a shallow clone has no such commit: the seed test carries the heading itself
}
