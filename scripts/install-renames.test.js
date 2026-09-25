'use strict';
// THE RENAME MIGRATION (Task 22) - the project-* skills and the two failure diagnosers shipped under
// their old names through v1.3.0, and 2.0.0 gives them grouped alfred-* names. An older install
// names them the old way in four places: the stamp's picks, a copy on disk, a seat deny (plus a
// `skillOverrides` key), and a selection line. Each is carried across through the ONE table,
// meta/stack-manifest.json `renamed`, so no pick and no switch-off is lost, and the old copy goes
// with the retired list. This file is one of the homes allowed to spell the old names.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const { loadManifest } = require('./install/manifest.js');
const selection = require('./install/selection.js');
const { writeSettings } = require('./install/settings.js');

const ROOT = path.join(__dirname, '..');
const RENAMED = loadManifest(ROOT).renamed;
const COPY_ROUTE = { ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' };
const OLD_KEY = 'claude-stack'; // legacy-name
const HASH = 'a'.repeat(64);

const write = (repo, rel, text = 'x\n') =>
{
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
};
const skill = (name) => `---\nname: ${name}\ndescription: "Use when testing."\n---\n\nbody\n`;
const renamedLines = (out) => String(out).split('\n').filter((l) => /^==> renamed: /.test(l));

// The installed state, read back after a run: the new stamp's picks and library lines, the copies
// on disk, and the settings file.
function inspect(repo)
{
    const claude = path.join(repo, '.claude');
    const read = (rel) => { try { return fs.readFileSync(path.join(claude, rel), 'utf8'); } catch { return ''; } };
    const stamp = read('alfred-code.stamp');
    const line = (key) => ((new RegExp(`^${key}: (.*)$`, 'm').exec(stamp) || [])[1] || '').split(',').filter(Boolean);
    const list = (dir) => { try { return fs.readdirSync(path.join(claude, dir)).sort(); } catch { return []; } };
    let settings = {};
    try { settings = JSON.parse(read('settings.json')); } catch { settings = {}; }
    return {
        pickedSkills: line('picked-skills'), pickedAgents: line('picked-agents'),
        librarySkills: line('library-skills').map((e) => e.split('=')[0]),
        skills: list('skills'), agents: list('agents'), settings,
        oldStamp: fs.existsSync(path.join(claude, 'claude-stack.stamp')), // legacy-name
    };
}

// ---------- the table ----------

test('the renamed map: every old name is retired, every new name ships, and no name is both', () =>
{
    const m = loadManifest(ROOT);
    const skills = new Set(m.catalogs.skills.map((e) => e.split('|').pop()));
    const agents = new Set(m.agents.map((f) => f.replace(/\.md$/, '')));
    assert.strictEqual(Object.keys(RENAMED.skills).length, 23, 'the 23 project-* skills');
    assert.strictEqual(Object.keys(RENAMED.agents).length, 2, 'the two failure diagnosers');
    for (const [from, to] of Object.entries(RENAMED.skills))
    {
        assert.ok(m.retired.skills.includes(from), `${from} is retired, so its copy is pruned`);
        assert.ok(skills.has(to) && !skills.has(from), `${from} -> ${to}: the new name ships, the old does not`);
    }
    for (const [from, to] of Object.entries(RENAMED.agents))
    {
        assert.ok(m.retired.agents.includes(`${from}.md`), `${from} is retired`);
        assert.ok(agents.has(to) && !agents.has(from), `${from} -> ${to}`);
    }
});

// ---------- the read-side helpers ----------

test('renameLines: an old skill or seat line reads under its new name, one line per rename per run', () =>
{
    const logs = [];
    const said = new Set();
    const opts = { renamed: RENAMED, log: (m) => logs.push(m), said };
    const out = selection.renameLines(['skill project-solve-task', 'agent ci-failure-diagnoser', 'rule markdown-docs', 'skill my-own-skill', 'hook none'], opts);
    assert.deepStrictEqual(out, ['skill alfred-task-solve', 'agent alfred-issue-diagnoser-ci', 'rule markdown-docs', 'skill my-own-skill', 'hook none']);
    selection.renameLines(['skill project-solve-task'], opts);
    assert.deepStrictEqual(logs, [
        'renamed: skill project-solve-task -> alfred-task-solve',
        'renamed: agent ci-failure-diagnoser -> alfred-issue-diagnoser-ci',
    ], 'the second sighting of a rename says nothing');
    // A rule, a hook and an MCP are never renamed by this table, even under a same-looking name.
    assert.deepStrictEqual(selection.renameLines(['rule project-solve-task'], opts), ['rule project-solve-task']);
});

test('renamePicked: a stamp pick keeps its home and takes the new name; no picks stays null', () =>
{
    const opts = { renamed: RENAMED, log: () => {}, said: new Set() };
    assert.strictEqual(selection.renamePicked(null, opts), null, 'a stamp that never recorded picks is not one that recorded none');
    assert.deepStrictEqual(selection.renamePicked({ skills: [`project-verify-code@${OLD_KEY}`, 'project-related-context', 'csharp'], agents: ['runtime-failure-diagnoser@alfred-code'] }, opts),
        { skills: [`alfred-task-verify-code@${OLD_KEY}`, 'alfred-capture-related-projects', 'csharp'], agents: ['alfred-issue-diagnoser-runtime@alfred-code'] });
});

test('renameDeny: a stack seat deny reads under the new seat, under any stack spelling; a foreign one is not touched', () =>
{
    const settings = { env: { MY_OWN_KEY: '1' }, permissions: { deny: [
        'Agent(alfred-code:ci-failure-diagnoser)', `Agent(${OLD_KEY}:runtime-failure-diagnoser)`,
        'Agent(someone-else:ci-failure-diagnoser)', 'Bash(rm -rf:*)',
    ] } };
    const before = JSON.stringify(settings);
    const out = selection.renameDeny(settings, { renamed: RENAMED, log: () => {}, said: new Set() });
    assert.deepStrictEqual(out.permissions.deny, [
        'Agent(alfred-code:alfred-issue-diagnoser-ci)', `Agent(${OLD_KEY}:alfred-issue-diagnoser-runtime)`,
        'Agent(someone-else:ci-failure-diagnoser)', 'Bash(rm -rf:*)',
    ]);
    assert.strictEqual(JSON.stringify(settings), before, 'the read is a view - the file is re-spelled by the writer');
    assert.deepStrictEqual(selection.renameDeny({}, { renamed: RENAMED }), {}, 'no deny list is nothing to rename');
});

// ---------- the writer ----------

test('settings writer: a renamed seat deny is re-spelled in the file, a skillOverrides key moves to the new name, the user\'s own entries stay', () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renames-settings-'));
    try
    {
        const file = path.join(dir, 'settings.json');
        fs.writeFileSync(file, JSON.stringify({
            env: { MY_OWN_KEY: 'mine' },
            skillOverrides: { 'project-related-context': 'off', 'my-own-skill': 'name-only' },
            permissions: { deny: [
                'Agent(alfred-code:ci-failure-diagnoser)', `Agent(${OLD_KEY}:runtime-failure-diagnoser)`,
                'Agent(someone-else:ci-failure-diagnoser)', 'Bash(rm -rf:*)',
            ] },
        }, null, 2));
        const logs = [];
        const run = () => writeSettings({ file, renamed: RENAMED, liveEntries: [], log: (m) => logs.push(m), note: (m) => assert.fail(m) });
        run();
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.deepStrictEqual(data.permissions.deny.slice().sort(), [
            'Agent(alfred-code:alfred-issue-diagnoser-ci)', 'Agent(alfred-code:alfred-issue-diagnoser-runtime)',
            'Agent(someone-else:ci-failure-diagnoser)', 'Bash(rm -rf:*)',
        ].sort());
        assert.deepStrictEqual(data.skillOverrides, { 'alfred-capture-related-projects': 'off', 'my-own-skill': 'name-only' });
        assert.strictEqual(data.env.MY_OWN_KEY, 'mine', "the user's own settings key survives");
        assert.ok(logs.some((m) => /ci-failure-diagnoser\).*alfred-issue-diagnoser-ci/.test(m)), logs.join('\n'));
        assert.ok(logs.some((m) => /skillOverrides project-related-context .*alfred-capture-related-projects/.test(m)), logs.join('\n'));
        const again = JSON.stringify(data);
        const second = run();
        assert.strictEqual(second.written, false, 'a second run changes nothing');
        assert.strictEqual(fs.readFileSync(file, 'utf8').trim(), JSON.stringify(JSON.parse(again), null, 2));
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('settings writer: a skillOverrides value already set under the new name wins over the old key', () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renames-settings-'));
    try
    {
        const file = path.join(dir, 'settings.json');
        fs.writeFileSync(file, JSON.stringify({ skillOverrides: { 'project-first-look': 'off', 'alfred-capture-first-look': 'on' } }));
        writeSettings({ file, renamed: RENAMED, log: () => {}, note: (m) => assert.fail(m) });
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).skillOverrides, { 'alfred-capture-first-look': 'on' });
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- end to end, one case per migration shape ----------

// Shape 1: a 1.3.0 install on the plugin route - the 1.x core under the old key, a stamp whose picks
// name the old core skills and seat plus a library pick, and that library pick's copy on disk.
const V13_LISTING = JSON.stringify([OLD_KEY, 'serena', 'context7', 'memory'].map((n) => ({ id: `${n}@${OLD_KEY}`, version: '1.3.0', scope: 'project', enabled: true })));
function v13Plugin(repo)
{
    write(repo, '.claude/rules/baseline-interaction.md');
    write(repo, '.claude/skills/project-related-context/SKILL.md', skill('project-related-context'));
    write(repo, '.claude/claude-stack.stamp', [ // legacy-name
        'version: 1.3.0', 'sha: 0000000',
        `picked-skills: project-solve-task@${OLD_KEY},project-commit-checkpoint@${OLD_KEY},project-related-context,markdown-style@${OLD_KEY}`,
        `picked-agents: ci-failure-diagnoser@${OLD_KEY},security-auditor@${OLD_KEY}`,
        `library-skills: project-related-context=${HASH}`, '',
    ].join('\n'));
    write(repo, '.claude/settings.json', JSON.stringify({ env: { MY_OWN_KEY: 'mine' } }, null, 2));
}

test('seed update --installed-only over a 1.3.0 stamp: every old pick is carried under its new name, the old copy is gone, one line per rename, and a re-run is quiet', POSIX_ONLY, () =>
{
    const { steps, outs } = seedRun(['update', 'update'], 'skill markdown-style\n', {
        plugins: V13_LISTING, args: ['--installed-only'], prepare: v13Plugin, each: inspect,
    });
    const [first, second] = steps;
    assert.ok(first.pickedSkills.includes('alfred-task-solve@alfred-code'), first.pickedSkills.join(','));
    assert.ok(first.pickedSkills.includes('alfred-habits-commit-checkpoint@alfred-code'), first.pickedSkills.join(','));
    assert.ok(first.pickedSkills.includes('alfred-capture-related-projects'), `the library pick is carried: ${first.pickedSkills.join(',')}`);
    assert.ok(first.pickedAgents.includes('alfred-issue-diagnoser-ci@alfred-code'), first.pickedAgents.join(','));
    const old = new Set([...Object.keys(RENAMED.skills), ...Object.keys(RENAMED.agents)]);
    const named = (list) => list.map((e) => e.split('@')[0]).filter((n) => old.has(n));
    assert.deepStrictEqual(named([...first.pickedSkills, ...first.pickedAgents, ...first.librarySkills]), [], 'the new stamp names no old item');
    assert.ok(first.skills.includes('alfred-capture-related-projects'), `the library copy arrives under its new name: ${first.skills.join(' ')}`);
    assert.ok(!first.skills.includes('project-related-context'), 'the old copy is pruned');
    assert.deepStrictEqual(first.librarySkills.filter((n) => n.startsWith('alfred-capture-related')), ['alfred-capture-related-projects']);
    assert.strictEqual(first.settings.env.MY_OWN_KEY, 'mine', "the user's own settings key survives");
    assert.strictEqual(first.oldStamp, false);
    const lines = renamedLines(outs[0]);
    for (const [kind, from, to] of [['skill', 'project-solve-task', 'alfred-task-solve'], ['skill', 'project-commit-checkpoint', 'alfred-habits-commit-checkpoint'],
        ['skill', 'project-related-context', 'alfred-capture-related-projects'], ['agent', 'ci-failure-diagnoser', 'alfred-issue-diagnoser-ci']])
        assert.strictEqual(lines.filter((l) => l === `==> renamed: ${kind} ${from} -> ${to}`).length, 1, `${from}: exactly one line\n${lines.join('\n')}`);
    assert.strictEqual(lines.length, new Set(lines).size, 'no rename is said twice');
    assert.deepStrictEqual(renamedLines(outs[1]), [], 'the re-run has nothing left to rename');
    assert.deepStrictEqual([second.pickedSkills, second.pickedAgents, second.skills, second.agents], [first.pickedSkills, first.pickedAgents, first.skills, first.agents], 'the re-run changes nothing');
});

// Shape 2: a seat the user switched off under its old name - the 2.0.0 core spelling and the 1.x one
// - stays off under its new name, and a skillOverrides switch-off follows its skill.
test('seed update --installed-only: a seat denied under its old name stays denied under the new one, and nothing else of the user\'s moves', POSIX_ONLY, () =>
{
    const listing = JSON.stringify(['alfred-code', 'serena', 'context7', 'memory'].map((n) => ({ id: `${n}@envoydev`, version: '2.0.0', scope: 'project', enabled: true })));
    const prepare = (repo) =>
    {
        write(repo, '.claude/rules/baseline-interaction.md');
        write(repo, '.claude/skills/project-related-context/SKILL.md', skill('project-related-context'));
        write(repo, '.claude/alfred-code.stamp', 'version: 1.3.0\nsha: 0000000\npicked-skills: markdown-style@alfred-code,project-related-context\npicked-agents: security-auditor@alfred-code\n');
        write(repo, '.claude/settings.json', JSON.stringify({
            env: { MY_OWN_KEY: 'mine' },
            skillOverrides: { 'project-related-context': 'off' },
            permissions: { deny: ['Agent(alfred-code:ci-failure-diagnoser)', `Agent(${OLD_KEY}:runtime-failure-diagnoser)`, 'Agent(someone-else:ci-failure-diagnoser)', 'Bash(rm -rf:*)'] },
        }, null, 2));
    };
    const { result: r, out } = seedRun('update', 'skill markdown-style\n', { plugins: listing, args: ['--installed-only'], prepare, inspect });
    const deny = r.settings.permissions.deny;
    assert.ok(deny.includes('Agent(alfred-code:alfred-issue-diagnoser-ci)') && deny.includes('Agent(alfred-code:alfred-issue-diagnoser-runtime)'), deny.join('\n'));
    assert.ok(!deny.some((d) => /^Agent\((alfred-code|claude-stack)[a-z0-9-]*:(ci|runtime)-failure-diagnoser\)$/.test(d)), `no stack deny keeps an old seat name:\n${deny.join('\n')}`); // legacy-name
    assert.ok(deny.includes('Agent(someone-else:ci-failure-diagnoser)') && deny.includes('Bash(rm -rf:*)'), "the user's own entries stay");
    assert.ok(!r.pickedAgents.some((e) => /diagnoser/.test(e)), `a denied seat is no pick: ${r.pickedAgents.join(',')}`);
    assert.deepStrictEqual(r.settings.skillOverrides, { 'alfred-capture-related-projects': 'off' }, 'the skill switch-off follows the skill');
    assert.ok(r.skills.includes('alfred-capture-related-projects') && !r.skills.includes('project-related-context'), r.skills.join(' '));
    assert.strictEqual(r.settings.env.MY_OWN_KEY, 'mine');
    assert.ok(renamedLines(out).includes('==> renamed: agent ci-failure-diagnoser -> alfred-issue-diagnoser-ci'), out);
});

// Shape 3: the full copy route - every skill and seat is a project copy under its old name.
test('seed update --installed-only on the copy route: the old copies become new copies and none is left behind', POSIX_ONLY, () =>
{
    const prepare = (repo) =>
    {
        write(repo, '.claude/rules/baseline-interaction.md');
        for (const n of ['project-solve-task', 'project-verify-code', 'markdown-style']) write(repo, `.claude/skills/${n}/SKILL.md`, skill(n));
        for (const n of ['ci-failure-diagnoser', 'security-auditor']) write(repo, `.claude/agents/${n}.md`, `---\nname: ${n}\n---\n`);
        write(repo, '.claude/claude-stack.stamp', 'version: 1.3.0\nsha: 0000000\nhooks-route: copy\n'); // legacy-name
    };
    const { result: r, out } = seedRun('update', 'skill markdown-style\n', { env: COPY_ROUTE, args: ['--installed-only'], prepare, inspect });
    for (const n of ['alfred-task-solve', 'alfred-task-verify-code', 'markdown-style']) assert.ok(r.skills.includes(n), `${n} is copied: ${r.skills.join(' ')}`);
    assert.ok(r.agents.includes('alfred-issue-diagnoser-ci.md') && r.agents.includes('security-auditor.md'), r.agents.join(' '));
    assert.ok(!r.skills.includes('project-solve-task') && !r.skills.includes('project-verify-code'), `an old skill copy survived: ${r.skills.join(' ')}`);
    assert.ok(!r.agents.includes('ci-failure-diagnoser.md'), `an old seat copy survived: ${r.agents.join(' ')}`);
    const names = (list) => list.map((e) => e.split('@')[0]);
    assert.ok(names(r.pickedSkills).includes('alfred-task-solve') && names(r.pickedAgents).includes('alfred-issue-diagnoser-ci'), `${r.pickedSkills} | ${r.pickedAgents}`);
    assert.ok(!names(r.pickedSkills).includes('project-solve-task') && !names(r.pickedAgents).includes('ci-failure-diagnoser'), 'the stamp names no old item');
    assert.strictEqual(renamedLines(out).length, 3, renamedLines(out).join('\n'));
});

// A selection line - a walk's file or an --add / --drop - naming an old item names the new one.
test('seed install --selection and update --add: a line naming an old item installs the new one', POSIX_ONLY, () =>
{
    const { result: r, out } = seedRun('install', 'skill markdown-style\nskill project-related-context\nagent ci-failure-diagnoser\nrule markdown-docs\n', { inspect });
    assert.ok(r.pickedSkills.includes('alfred-capture-related-projects') && r.skills.includes('alfred-capture-related-projects'), `${r.pickedSkills} | ${r.skills}`);
    assert.ok(r.pickedAgents.includes('alfred-issue-diagnoser-ci@alfred-code'), r.pickedAgents.join(','));
    assert.ok(renamedLines(out).includes('==> renamed: skill project-related-context -> alfred-capture-related-projects'), out);

    const listing = JSON.stringify([{ id: 'alfred-code@envoydev', version: '2.0.0', scope: 'project', enabled: true }]);
    const prepare = (repo) =>
    {
        write(repo, '.claude/rules/baseline-interaction.md');
        write(repo, '.claude/alfred-code.stamp', 'version: 2.0.0\nsha: 0000000\npicked-skills: markdown-style@alfred-code\npicked-agents: security-auditor@alfred-code\n');
    };
    const add = seedRun('update', 'skill markdown-style\n', { plugins: listing, args: ['--installed-only', '--add', 'skill project-stack-usage-analyzer'], prepare, inspect });
    assert.ok(add.result.skills.includes('alfred-capture-stack-usage'), add.result.skills.join(' '));
    assert.ok(!add.out.includes('names nothing this release ships'), 'an old name is carried, never reported as unknown');
});
