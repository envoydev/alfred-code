'use strict';
// library-check.js, the layout rows: native rule files, links, leftover seat denies, a child's excludes. Each case is an
// installer run in the seed sandbox (this tree), then one thing broken by hand, then the check read.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const { hashItem } = require('./install/library.js');
const stampLib = require('./install/stamp.js');
const workspace = require('./install/workspace.js');
const nativeRules = require('./install/native-rules.js');
const { layoutRows } = require('./library-check/layout-rows.js');
const { ROW } = require('./library-check/constants.js');

const REPO = path.join(__dirname, '..');
const SCRIPT = path.join(__dirname, 'library-check.js');
const SELECTION = 'skill markdown-style\nagent evidence-gatherer\nrule alfred-security\nrule alfred-interaction\n';
const OPTIONS = { env: { ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' }, args: ['--scope', 'local'] };
const NEW_ROWS = /^(native-rule-\w+|link-\w+|seat-deny-left|exclude-drift|agents-shared-repo):/m;

const at = (repo, ...parts) => path.join(repo, ...parts);
const stampOf = (repo) => at(repo, '.claude', 'alfred-code.stamp');
// The sandbox's own account folder, and the workspace switch on, as the installs ran.
function check(repo, extra = [], acct = path.join(path.dirname(repo), 'acct'))
{
    const env = { ...process.env, ALFRED_CODE_WORKSPACE: '1' };
    try { return { out: execFileSync(process.execPath, [SCRIPT, '--project', repo, '--source', REPO, '--config-dir', acct, ...extra], { encoding: 'utf8', env }), code: 0 }; }
    catch (e) { return { out: String(e.stdout || ''), code: e.status }; }
}
const rowsOf = (out) => out.split('\n').filter((l) => NEW_ROWS.test(l));
// One install, `breakIt(repo)` run on it, the check read.
const broken = (breakIt, { selection = SELECTION, options = OPTIONS } = {}) =>
    seedRun('install', selection, { ...options, inspect: (repo) => { breakIt(repo); return check(repo); } }).result;
const writeLocal = (repo, change) =>
{
    const file = at(repo, '.claude', 'settings.local.json');
    const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    change(data);
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
};

test('a clean install prints none of the new rows', POSIX_ONLY, () =>
{
    const r = broken(() => {});
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(rowsOf(r.out), [], r.out);
    assert.match(r.out, /library: clean/);
});

test('native-rule-missing: a picked rule with no native file fails the check', POSIX_ONLY, () =>
{
    const r = broken((repo) => fs.rmSync(at(repo, '.claude', 'rules', 'alfred-security.md')));
    assert.match(r.out, /^native-rule-missing: \.claude\/rules\/alfred-security\.md - /m, r.out);
    assert.equal(r.code, 1);
    assert.equal(rowsOf(r.out).length, 1, r.out);
});

test('native-rule-unmarked: the user\'s file at a picked rule\'s name is a note, never a failure', POSIX_ONLY, () =>
{
    const r = broken((repo) => fs.writeFileSync(at(repo, '.claude', 'rules', 'alfred-security.md'), 'my own security rule\n'));
    assert.match(r.out, /^native-rule-unmarked: \.claude\/rules\/alfred-security\.md - /m, r.out);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /library: clean/);
});

test('native-rule-unpicked: a marked file of a rule this level no longer picks fails the check', POSIX_ONLY, () =>
{
    const r = broken((repo) => fs.writeFileSync(at(repo, '.claude', 'rules', 'alfred-ghost.md'), nativeRules.withMarker('# ghost\n')));
    assert.match(r.out, /^native-rule-unpicked: \.claude\/rules\/alfred-ghost\.md - .*update/m, r.out);
    assert.equal(r.code, 1);
});

test('link-missing: a picked skill with no link fails; a recorded copy stands where a link cannot be made', POSIX_ONLY, () =>
{
    const r = broken((repo) => fs.unlinkSync(at(repo, '.claude', 'skills', 'markdown-style')));
    assert.match(r.out, /^link-missing: \.claude\/skills\/markdown-style - /m, r.out);
    assert.equal(r.code, 1);
    assert.equal(rowsOf(r.out).length, 1, r.out);
    const copy = broken((repo) =>
    {
        const link = at(repo, '.claude', 'skills', 'markdown-style');
        fs.unlinkSync(link);
        fs.cpSync(at(repo, '.alfred', 'stack', 'skills', 'markdown-style'), link, { recursive: true });
        const record = stampLib.readLinks(stampOf(repo)).filter((e) => e.path !== 'skills/markdown-style');
        record.push({ path: 'skills/markdown-style', kind: 'copy', hash: hashItem(link) });
        stampLib.markLine(stampOf(repo), 'links', record.map((e) => `${e.path}=${e.kind}${e.hash ? `@${e.hash}` : ''}`).join(','));
    });
    assert.deepEqual(rowsOf(copy.out), [], copy.out);
});

test('link-missing: a seat whose flat file is the user\'s is no pick', POSIX_ONLY, () =>
{
    const r = broken((repo) =>
    {
        fs.unlinkSync(at(repo, '.claude', 'agents', 'evidence-gatherer'));
        fs.writeFileSync(at(repo, '.claude', 'agents', 'evidence-gatherer.md'), '---\nname: evidence-gatherer\ndescription: mine\n---\nmine\n');
    });
    assert.deepEqual(rowsOf(r.out), [], r.out);
});

test('link-dangling: a link into the store whose target is gone fails; one to any other place is the user\'s', POSIX_ONLY, () =>
{
    const r = broken((repo) =>
    {
        fs.rmSync(at(repo, '.alfred', 'stack', 'skills', 'markdown-style'), { recursive: true });
        fs.symlinkSync('../../.alfred/stack/skills/ghost', at(repo, '.claude', 'skills', 'ghost'), 'dir');
        fs.symlinkSync('/nonexistent-elsewhere', at(repo, '.claude', 'skills', 'elsewhere'), 'dir');
    });
    assert.match(r.out, /^link-dangling: \.claude\/skills\/markdown-style - /m, r.out);
    assert.match(r.out, /^link-dangling: \.claude\/skills\/ghost - /m, r.out);
    assert.doesNotMatch(r.out, /elsewhere/);
    assert.equal(rowsOf(r.out).length, 2, r.out);
    assert.equal(r.code, 1);
});

test('link-unpicked: a link into the store for an item this level does not pick fails', POSIX_ONLY, () =>
{
    const r = broken((repo) =>
    {
        fs.mkdirSync(at(repo, '.alfred', 'stack', 'skills', 'extra'));
        fs.writeFileSync(at(repo, '.alfred', 'stack', 'skills', 'extra', 'SKILL.md'), '---\nname: extra\ndescription: d\n---\nx\n');
        fs.symlinkSync('../../.alfred/stack/skills/extra', at(repo, '.claude', 'skills', 'extra'), 'dir');
    });
    assert.match(r.out, /^link-unpicked: \.claude\/skills\/extra - /m, r.out);
    assert.equal(r.code, 1);
    assert.equal(rowsOf(r.out).length, 1, r.out);
});

test('seat-deny-left: an Agent(alfred-code:<seat>) row of a shipped seat fails, in settings.json and at local scope; another row stays', POSIX_ONLY, () =>
{
    const r = broken((repo) =>
    {
        fs.mkdirSync(at(repo, '.claude'), { recursive: true });
        fs.writeFileSync(at(repo, '.claude', 'settings.json'), JSON.stringify({ permissions: { deny: ['Agent(alfred-code:evidence-gatherer)', 'Agent(other-plugin:evidence-gatherer)', 'Agent(alfred-code:no-such-seat)'] } }));
        writeLocal(repo, (data) => { data.permissions.deny.push('Agent(alfred-code:code-quality-analyzer)'); });
    });
    assert.match(r.out, /^seat-deny-left: \.claude\/settings\.json - .*evidence-gatherer/m, r.out);
    assert.match(r.out, /^seat-deny-left: \.claude\/settings\.local\.json - .*code-quality-analyzer.*does nothing.*project-scope update/m, r.out);
    assert.doesNotMatch(r.out, /other-plugin|no-such-seat/);
    assert.equal(r.code, 1);
});

test('a fallback .claude/rules store is not judged: no unmarked, missing or unpicked row', POSIX_ONLY, () =>
{
    const r = broken((repo) =>
    {
        const store = at(repo, '.alfred', 'stack', 'rules');
        for (const f of fs.readdirSync(store)) fs.copyFileSync(path.join(store, f), at(repo, '.claude', 'rules', f));
        fs.rmSync(store, { recursive: true });
    });
    assert.deepEqual(rowsOf(r.out), [], r.out);
});

test('the layout rows are in the --json result, notes apart from failures', POSIX_ONLY, () =>
{
    const r = seedRun('install', SELECTION, { ...OPTIONS, inspect: (repo) =>
    {
        fs.writeFileSync(at(repo, '.claude', 'rules', 'alfred-security.md'), 'mine\n');
        fs.rmSync(at(repo, '.claude', 'rules', 'alfred-interaction.md'));
        return check(repo, ['--json']);
    } }).result;
    const rows = JSON.parse(r.out).layout;
    assert.deepEqual(rows.map((x) => [x.row, x.note]).sort(), [[ROW.nativeMissing, false], [ROW.nativeUnmarked, true]]);
    assert.equal(r.code, 1);
});

// A joined child below a workspace root: `ws` a plain folder holding the root, `ws/api` a child in its own repository.
const gitInit = (dir) => { fs.mkdirSync(dir, { recursive: true }); execFileSync('git', ['init', '-q', dir]); };
function withChild(inspect)  // inspect(kid, ws, acct)
{
    const sel = 'skill javascript\nagent evidence-gatherer\nrule alfred-security\n';
    return seedRun(['install', 'install'], '', {
        plugins: JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true, scope: 'user' }]),
        cwds: ['ws', path.join('ws', 'api')],
        env: { ALFRED_CODE_WORKSPACE: '1', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' },
        args: [(repo, work) => ['--selection', path.join(work, 'sel-0.txt'), '--scope', 'local'], (repo, work) =>
        {
            const ws = path.join(work, 'ws');
            const env = { CLAUDE_CONFIG_DIR: path.join(work, 'acct') };
            assert.ok(workspace.writeWorkspace(path.join(ws, 'api'), (m) => workspace.setParent(m, '..'), { env }).ok);
            assert.ok(workspace.writeWorkspace(ws, (m) => workspace.addChild(m, 'api'), { env }).ok);
            return ['--selection', path.join(work, 'sel-1.txt'), '--scope', 'local'];
        }],
        prepare: (repo, work) => { gitInit(path.join(work, 'ws', 'api')); for (const i of [0, 1]) fs.writeFileSync(path.join(work, `sel-${i}.txt`), sel); },
        inspect: (repo) => inspect(path.join(path.dirname(repo), 'ws', 'api'), path.join(path.dirname(repo), 'ws'), path.join(path.dirname(repo), 'acct')),
    }).result;
}

test('a clean root and joined child print none of the new rows', POSIX_ONLY, () =>
{
    const r = withChild((kid, ws, acct) => ({ kid: check(kid, [], acct), root: check(ws, [], acct) }));
    assert.deepEqual(rowsOf(r.kid.out), [], r.kid.out);
    assert.deepEqual(rowsOf(r.root.out), [], r.root.out);
    assert.equal(r.kid.code, 0, r.kid.out);
});

test('exclude-drift: a child whose claudeMdExcludes differs from the chain\'s fails', POSIX_ONLY, () =>
{
    const r = withChild((kid, ws, acct) =>
    {
        writeLocal(kid, (data) => { data.claudeMdExcludes = (data.claudeMdExcludes || []).slice(1); });
        return check(kid, [], acct);
    });
    assert.match(r.out, /^exclude-drift: \.claude\/settings\.local\.json - /m, r.out);
    assert.equal(r.code, 1);
});

test('exclude-drift: an entry of the user\'s own is no drift', POSIX_ONLY, () =>
{
    const r = withChild((kid, ws, acct) =>
    {
        writeLocal(kid, (data) => { data.claudeMdExcludes = [...(data.claudeMdExcludes || []), '/somewhere/mine/**']; });
        return check(kid, [], acct);
    });
    assert.deepEqual(rowsOf(r.out), [], r.out);
});

test('agents-shared-repo: a child with no repository of its own is a note, never a failure', POSIX_ONLY, () =>
{
    const r = withChild((kid, ws, acct) =>
    {
        fs.rmSync(at(kid, '.git'), { recursive: true, force: true });
        return check(kid, [], acct);
    });
    assert.match(r.out, /^agents-shared-repo: \.claude\/agents - .* under \.\., which links agents/m, r.out);
    assert.equal(r.code, 0, r.out);
});

// The decisions on gathered facts, with no file system.
const facts = (over) => ({ rules: null, links: { skills: null, agents: null }, denies: [], excludes: null, sharedRepo: null, ...over });
test('the canary, the generated awareness rules and a fallback-store install are not unmarked', () =>
{
    const rules = { picked: ['alfred-rules', 'alfred-awareness', 'alfred-security'], hasText: [], onDisk: { 'alfred-rules': 'unmarked', 'alfred-awareness': 'unmarked' }, exempt: ['alfred-rules', 'alfred-awareness'] };
    assert.deepEqual(layoutRows(facts({ rules })), []);
    assert.deepEqual(layoutRows(facts({ rules: null })), [], 'no judgement without the store');
    const user = { ...rules, picked: ['alfred-security'], onDisk: { 'alfred-security': 'unmarked' } };
    assert.deepEqual(layoutRows(facts({ rules: user })).map((x) => x.row), [ROW.nativeUnmarked]);
});
