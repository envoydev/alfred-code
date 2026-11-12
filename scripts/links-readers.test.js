'use strict';
// The readers in a project that holds links and no copy (workspace stage 3): a skill or an agent linked from the
// project's own store into .claude is counted once by every lister, a skill script run through its link finds the hook
// engines in the project's .claude/hooks, and `workspace.js status` says whether the links are whole.
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'links-readers-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const put = (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return p; };
const skillMd = (name) => `---\nname: ${name}\ndescription: Use when ${name} is asked for.\n---\n\n# ${name}\n`;
const agentMd = (name) => `---\nname: ${name}\ndescription: Use when ${name} is dispatched.\n---\n\nYou are ${name}.\n`;
// A link the way links.js makes one: a directory symlink (a junction on Windows) for a skill, a file symlink for an
// agent (a hard link on Windows).
function linkSkill(proj, name)
{
    const at = path.join(proj, '.claude', 'skills', name);
    fs.mkdirSync(path.dirname(at), { recursive: true });
    const target = path.join(proj, '.alfred', 'stack', 'skills', name);
    if (process.platform === 'win32') fs.symlinkSync(target, at, 'junction');
    else fs.symlinkSync(path.relative(path.dirname(at), target), at, 'dir');
}
function linkAgent(proj, name)
{
    const at = path.join(proj, '.claude', 'agents', `${name}.md`);
    fs.mkdirSync(path.dirname(at), { recursive: true });
    const target = path.join(proj, '.alfred', 'stack', 'agents', `${name}.md`);
    if (process.platform === 'win32') fs.linkSync(target, at);
    else fs.symlinkSync(path.relative(path.dirname(at), target), at, 'file');
}
// A project whose one skill and one agent live in its store, reached only through links.
function linkedProject(label)
{
    const proj = path.join(TMP, label);
    put(path.join(proj, '.alfred', 'stack', 'skills', 'linked-skill', 'SKILL.md'), skillMd('linked-skill'));
    put(path.join(proj, '.alfred', 'stack', 'agents', 'linked-seat.md'), agentMd('linked-seat'));
    linkSkill(proj, 'linked-skill');
    linkAgent(proj, 'linked-seat');
    return proj;
}

test('the listers count a linked skill and a linked agent once', () =>
{
    const proj = linkedProject('listers');
    fs.mkdirSync(path.join(TMP, 'empty-bin'), { recursive: true });
    const aw = spawnSync(process.execPath, [path.join(REPO, 'stack', 'skills', 'capture-awareness', 'scripts', 'awareness-state.js')],
        { cwd: proj, encoding: 'utf8', env: { PATH: path.join(TMP, 'empty-bin'), HOME: TMP } });
    const said = `${aw.stdout}${aw.stderr}`;
    assert.match(said, /SKILLS:\s+1 total/, said);
    assert.match(said, /SEATS:\s+1 total/, said);

    const transcript = put(path.join(TMP, 'listers-session.jsonl'), `${JSON.stringify({ type: 'user', timestamp: '2026-07-15T07:00:00.000Z', cwd: proj, message: { content: 'hi' } })}\n`);
    const plugins = put(path.join(TMP, 'listers-plugins.json'), JSON.stringify({ version: 2, plugins: {} }));
    const { inventory } = JSON.parse(execFileSync(process.execPath, [path.join(REPO, 'scripts', 'analyze-usage.js'), transcript, '--inventory', path.join(proj, '.claude'), '--plugins', plugins, '--json'], { encoding: 'utf8' }));
    assert.deepStrictEqual(inventory.skills.map((r) => r.name), ['linked-skill']);
    assert.deepStrictEqual(inventory.agents.map((r) => r.name), ['linked-seat']);

    const { surface } = require('./session-surface.js');
    const s = surface(proj, { configDir: path.join(TMP, 'listers-acct'), home: TMP, inventory: { skills: new Set(), rules: new Set(), generated: new Set(), plugins: new Set() } });
    const start = s.rows.filter((r) => r.loadPoint === 'session-start');
    assert.strictEqual(start.filter((r) => r.listing === 'skill').length, 1, 'the floor lists the linked skill once');
    assert.strictEqual(start.filter((r) => r.listing === 'agent').length, 1, 'the floor lists the linked agent once');
});

test('the status floor counts a linked skill copy once', () =>
{
    const proj = path.join(TMP, 'floor');
    fs.cpSync(path.join(REPO, 'stack', 'skills', 'npm'), path.join(proj, '.alfred', 'stack', 'skills', 'npm'), { recursive: true });
    linkSkill(proj, 'npm');
    const { floor } = require('./derive-state.js');
    assert.strictEqual(floor({ skillsDir: path.join(proj, '.claude', 'skills') }).skills.count, 1);
});

test('skillCopyState reads a linked skill as on, so the scorer state is usable', () =>
{
    const proj = linkedProject('copy-state');
    put(path.join(proj, '.alfred', 'stack', 'skills', 'mode-output-scorer', 'SKILL.md'), skillMd('mode-output-scorer'));
    linkSkill(proj, 'mode-output-scorer');
    const prelude = require('../stack/hooks/hook-prelude.js');
    const env = { HOME: TMP, CLAUDE_CONFIG_DIR: path.join(TMP, 'copy-state-acct') };
    assert.strictEqual(prelude.skillCopyState(proj, 'linked-skill', env), 'on');
    assert.strictEqual(prelude.scorerState(proj, 'sess-1', env).usable, true);
});

// A project whose two skills with engine lookups are linked from its store, with stub engines in .claude/hooks that
// leave a mark: each lookup run through its link must land on them. `copy` puts real copies in .claude/skills instead.
function engineProject(label, { copy = false } = {})
{
    const proj = path.join(TMP, label);
    for (const skill of ['capture-preferences', 'mode-output-scorer'])
    {
        const home = copy ? path.join(proj, '.claude', 'skills', skill) : path.join(proj, '.alfred', 'stack', 'skills', skill);
        fs.cpSync(path.join(REPO, 'stack', 'skills', skill), home, { recursive: true });
        if (!copy) linkSkill(proj, skill);
    }
    put(path.join(proj, '.claude', 'hooks', 'layout.js'), [
        "exports.applyVariables = () => { process.env.LINK_PROBE_APPLIED = 'yes'; };",
        'exports.projectRootOf = (p) => ({ checkout: p });',
        "exports.ancestorPrefsDirs = () => [{ dir: 'ABOVE-MARK', skip: new Set() }];",
    ].join('\n'));
    put(path.join(proj, '.claude', 'hooks', 'secret-chain.js'), "exports.chainOf = () => ({ values: { MARK: 'chain-mark' } });\n");
    return proj;
}
// Loads a skill script through the project's .claude path in a fresh process and prints what the lookups found.
function probe(proj, body)
{
    const r = spawnSync(process.execPath, ['-e', body], { cwd: proj, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: TMP, CLAUDE_PROJECT_DIR: proj } });
    assert.strictEqual(r.status, 0, r.stderr);
    return r.stdout.trim();
}
const LOOKUPS = (proj) => {
    const at = (skill, file) => JSON.stringify(path.join(proj, '.claude', 'skills', skill, 'scripts', file));
    return [
        `const tools = require(${at('capture-preferences', 'tools.js')});`,
        'const a = process.env.LINK_PROBE_APPLIED; delete process.env.LINK_PROBE_APPLIED;',
        `require(${at('mode-output-scorer', 'scorecard.js')});`,
        `const prefs = require(${at('capture-preferences', 'preferences.js')});`,
        `const chain = tools.hookEngine('secret-chain.js', ${JSON.stringify(proj)});`,
        `console.log([a, process.env.LINK_PROBE_APPLIED, prefs.readDirs(${JSON.stringify(proj)}).some((d) => d.dir === 'ABOVE-MARK'), chain && chain.chainOf().values.MARK].join(' '));`,
    ].join('\n');
};

test('each engine lookup run through its link finds the engine in the project\'s .claude/hooks', () =>
{
    const proj = engineProject('engines-linked');
    assert.strictEqual(probe(proj, LOOKUPS(proj)), 'yes yes true chain-mark');
});

test('each engine lookup still finds the engine by today\'s route in a real copy', () =>
{
    const proj = engineProject('engines-copy', { copy: true });
    assert.strictEqual(probe(proj, LOOKUPS(proj)), 'yes yes true chain-mark');
});

// status: the links line and the member picks the stamp holds.
const CLI = path.join(REPO, 'scripts', 'workspace.js');
function statusOf(proj, stampLines)
{
    put(path.join(proj, '.claude', 'alfred-code.stamp'), `${['source: x', 'release: 1.0.0', ...stampLines].join('\n')}\n`);
    const r = spawnSync(process.execPath, [CLI, 'status', '--root', proj], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: TMP, CLAUDE_CONFIG_DIR: path.join(TMP, 'status-acct') } });
    return `${r.stdout}${r.stderr}`;
}
const LINKED = process.platform === 'win32' ? 'junction' : 'symlink';
test('status: a whole set of links is one line', () =>
{
    const proj = linkedProject('status-whole');
    const out = statusOf(proj, [`links: skills/linked-skill=${LINKED}`]);
    assert.match(out, /^links: 1 whole$/m, out);
    assert.doesNotMatch(out, /held for members/);
});

test('status: a dangling link is named, and a root holding a member\'s pick says so', () =>
{
    const proj = linkedProject('status-dangling');
    fs.rmSync(path.join(proj, '.alfred', 'stack', 'skills', 'linked-skill'), { recursive: true, force: true });
    const out = statusOf(proj, [`links: skills/linked-skill=${LINKED}`, 'member-picks: skill/npm,agent/linked-seat']);
    assert.match(out, /^ {2}!! link skills\/linked-skill: dangling$/m, out);
    assert.doesNotMatch(out, /^links: /m);
    assert.match(out, /^held for members: agent linked-seat, skill npm$/m, out);
});

test('status: an edited copy and a stale copy are named', () =>
{
    const proj = path.join(TMP, 'status-copies');
    const { hashItem } = require('./install/library.js');
    const sha = (rel) => hashItem(path.join(proj, rel));
    // an edited copy: its text is not the recorded one
    put(path.join(proj, '.claude', 'agents', 'edited.md'), agentMd('edited-here'));
    // a stale copy: at its recorded text while the store's file moved on
    put(path.join(proj, '.claude', 'agents', 'stale.md'), agentMd('stale'));
    put(path.join(proj, '.alfred', 'stack', 'agents', 'stale.md'), agentMd('stale-moved-on'));
    const seen = put(path.join(TMP, 'status-copies-was', 'edited.md'), agentMd('edited'));
    const out = statusOf(proj, [`links: agents/edited.md=copy@${hashItem(seen)},agents/stale.md=copy@${sha('.claude/agents/stale.md')}`]);
    assert.match(out, /^ {2}!! link agents\/edited\.md: edited$/m, out);
    assert.match(out, /^ {2}!! link agents\/stale\.md: stale$/m, out);
});
