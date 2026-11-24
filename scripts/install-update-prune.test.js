'use strict';
// Update over a 3.17.0-shaped workspace (the root keeps its items in the store, the child - a git repo - in `.claude`): the
// stack-owned leftovers of the old delivery go, the user's own skill, agent and rule stay and are named once as `kept, yours`,
// and each level gets one `report:` line. The old shapes are planted over a current install, as the 3.17.0 delivery left them.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const rt = require('./install/runtime.js');
const wsLib = require('./install/workspace.js');
const stampLib = require('./install/stamp.js');
const { hashItem } = require('./install/library.js');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');

const SEED = path.join(__dirname, 'install', 'alfred-code.js');
const CLI = path.join(__dirname, 'workspace.js');
const SOURCE = path.join(__dirname, '..');
const PLUGINS = JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true, scope: 'user' }]);
const SEL = 'skill markdown-style\nrule alfred-security\nagent evidence-gatherer\n';
const RETIRED_SKILL = 'data-security';
const ADDED_RULE = 'alfred-security';
const CHILD_RULE = `api.${ADDED_RULE}.md`;
const TWICE_RULE = 'alfred-interaction';
const NAV_FILE = 'navigation-context.yml';
const OLD_SEAT = 'security-auditor';
const PICKED_SEAT = 'evidence-gatherer';
const STRANGER = 'my-own';
const CHILD = 'api';
const MINE_SKILL = '---\nname: my-skill\ndescription: mine\n---\nMY SKILL\n';
const MINE_AGENT = '---\nname: my-agent\ndescription: mine\n---\nMY AGENT\n';
const MINE_RULE = '---\n---\nMY RULE\n';
const STALE_EXCLUDE = '/gone/for/good/CLAUDE.md';
const HAND_EXCLUDE = '/my/own/exclude/**';
const REPORT_START = /^==> report: /;
const SESSION = '==> new session needed: rule files and agents load when a session starts - start one (or /clear) to pick them up';

const at = (work, rel = '.') => path.join(work, 'ws', ...(rel === '.' ? [] : rel.split('/')));
const acct = (work) => ({ CLAUDE_CONFIG_DIR: path.join(work, 'acct'), ALFRED_CODE_WORKSPACE: '1' });
const lstat = (p) => { try { return fs.lstatSync(p); } catch { return null; } };
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const json = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const stampOf = (work, rel) => path.join(at(work, rel), '.claude', 'alfred-code.stamp');
const homeOf = (work, rel, kind) => (rel === '.' ? path.join(at(work, rel), '.alfred', 'stack', kind) : path.join(at(work, rel), '.claude', kind));
const claudeOf = (work, rel, ...rest) => path.join(at(work, rel), '.claude', ...rest);
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const lineOf = (text, key) => new RegExp(`^${key}: ?(.*)$`, 'm').exec(text)?.[1] ?? '';
const setLine = (file, key, fn) => stampLib.markLine(file, key, fn(lineOf(fs.readFileSync(file, 'utf8'), key)));
const append = (line, row) => (line ? `${line},${row}` : row);

function layout(work)
{
    fs.mkdirSync(at(work), { recursive: true });
    fs.mkdirSync(at(work, CHILD), { recursive: true });
    rt.execCommand('git', ['init', '-q', at(work, CHILD)]);
}
const join = (work) =>
{
    assert.ok(wsLib.writeWorkspace(at(work, CHILD), (m) => wsLib.setParent(m, '..'), { env: acct(work) }).ok);
    assert.ok(wsLib.writeWorkspace(at(work), (m) => wsLib.addChild(m, CHILD), { env: acct(work) }).ok);
};
const denyRows = (work, rel) => (json(claudeOf(work, rel, 'settings.local.json')) || {}).permissions?.deny || [];

// What the 3.17.0 delivery left at one level, and the user's own files beside it.
function plant(work, rel)
{
    const [skills, agents] = [homeOf(work, rel, 'skills'), homeOf(work, rel, 'agents')];
    const file = stampOf(work, rel);
    // a retired stack skill, recorded at its hash, with its link where the home is the store
    write(path.join(skills, RETIRED_SKILL, 'SKILL.md'), '---\nname: old\ndescription: old\n---\nOLD\n');
    setLine(file, 'library-skills', (l) => append(l, `${RETIRED_SKILL}=${hashItem(path.join(skills, RETIRED_SKILL))}`));
    // the picked seat as a flat copy at its recorded hash, the 3.17.0 store layout (no folder, no link)
    const seatText = fs.readFileSync(path.join(SOURCE, 'stack', 'agents', `${PICKED_SEAT}.md`), 'utf8');
    fs.rmSync(path.join(agents, PICKED_SEAT), { recursive: true, force: true });
    fs.rmSync(claudeOf(work, rel, 'agents', PICKED_SEAT), { recursive: true, force: true });
    write(path.join(agents, `${PICKED_SEAT}.md`), seatText);
    setLine(file, 'library-agents', (l) => append(l, `${PICKED_SEAT}=${hashItem(path.join(agents, `${PICKED_SEAT}.md`))}`));
    if (rel === '.') fs.symlinkSync(`../../.alfred/stack/skills/${RETIRED_SKILL}`, claudeOf(work, rel, 'skills', RETIRED_SKILL));
    // seat deny rows: one for a shipped seat, one naming no seat of ours, one the user wrote
    const local = claudeOf(work, rel, 'settings.local.json');
    const data = json(local) || {};
    data.permissions = { ...(data.permissions || {}), deny: [...((data.permissions || {}).deny || []), `Agent(alfred-code:${OLD_SEAT})`, `Agent(alfred-code:${STRANGER})`, 'Read(secret.txt)'] };
    // a stale exclude the ledger records, and one the user wrote by hand
    data.claudeMdExcludes = [...(data.claudeMdExcludes || []), STALE_EXCLUDE, HAND_EXCLUDE];
    write(local, `${JSON.stringify(data, null, 2)}\n`);
    setLine(file, 'managed-settings', (l) => append(l, `settings.local.json:claudeMdExcludes[${stampLib.valueHash(STALE_EXCLUDE)}]=${stampLib.valueHash(STALE_EXCLUDE)}`));
    // links into the store whose target is gone (a stack link), and one into somewhere else (the user's)
    fs.mkdirSync(claudeOf(work, rel, 'skills'), { recursive: true });
    fs.mkdirSync(claudeOf(work, rel, 'agents'), { recursive: true });
    fs.symlinkSync('../../.alfred/stack/skills/ghost-skill', claudeOf(work, rel, 'skills', 'ghost-skill'));
    fs.symlinkSync('../../.alfred/stack/agents/ghost-agent', claudeOf(work, rel, 'agents', 'ghost-agent'));
    fs.symlinkSync('../../vendor/theirs', claudeOf(work, rel, 'skills', 'theirs'));
    // the user's own skill, agent and rule
    write(claudeOf(work, rel, 'skills', 'my-skill', 'SKILL.md'), MINE_SKILL);
    write(claudeOf(work, rel, 'agents', 'my-agent.md'), MINE_AGENT);
    write(claudeOf(work, rel, 'rules', 'my-rule.md'), MINE_RULE);
    // a joined child's copy of the root's rule at the stack's text, as the 3.17.0 delivery wrote it: this update removes it
    if (rel === CHILD)
    {
        const store = path.join(at(work, '.'), '.alfred', 'stack', 'rules', `${ADDED_RULE}.md`);
        const text = fs.existsSync(store) ? fs.readFileSync(store, 'utf8') : fs.readFileSync(path.join(SOURCE, 'stack', 'rules', `${ADDED_RULE}.md`), 'utf8');
        write(claudeOf(work, rel, 'rules', CHILD_RULE), text);
    }
    if (rel === '.')
    {
        // a rule copy the stamp records, still in `.claude/rules` beside the store's (held twice): at its hash it goes
        const store = path.join(at(work, '.'), '.alfred', 'stack', 'rules', `${TWICE_RULE}.md`);
        write(claudeOf(work, rel, 'rules', `${TWICE_RULE}.md`), fs.readFileSync(store, 'utf8'));
        // the navigation context an older release copied, recorded in the ledger at its hash: no release names it now
        write(claudeOf(work, rel, NAV_FILE), 'context: planted\n');
        setLine(file, 'managed-files', (l) => append(l, `${NAV_FILE}=${hashItem(claudeOf(work, rel, NAV_FILE))}`));
    }
    // a picked native rule the old delivery never wrote: this update adds it
    fs.rmSync(claudeOf(work, rel, 'rules', `${ADDED_RULE}.md`), { force: true });
}

const treeOf = (work, rel) =>
{
    const rows = [];
    const walk = (dir, pre) =>
    {
        for (const e of (() => { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } })().sort((a, b) => a.name.localeCompare(b.name)))
        {
            const p = path.join(dir, e.name);
            if (e.name === '.git' || e.name === 'alfred-code.stamp') continue;
            if (e.isSymbolicLink()) rows.push(`${pre}${e.name} -> ${fs.readlinkSync(p)}`);
            else if (e.isDirectory()) walk(p, `${pre}${e.name}/`);
            else rows.push(`${pre}${e.name} ${sha(fs.readFileSync(p, 'utf8'))}`);
        }
    };
    walk(path.join(at(work, rel), '.claude'), '.claude/');
    walk(path.join(at(work, rel), '.alfred'), '.alfred/');
    return rows.join('\n');
};

const update = (rel, extra = {}) => ({ at: rel, act: 'update', args: ['--installed-only'], ...extra });
function step(s, i)
{
    return (repo, work) =>
    {
        if (s.before) s.before(work);
        const sel = path.join(work, `sel-${i}.txt`);
        fs.writeFileSync(sel, SEL);
        return ['--selection', sel, ...(s.args || [])];
    };
}
function scenario(steps, { prepare = () => {} } = {})
{
    return seedRun(steps.map((s) => s.act || 'install'), '', {
        plugins: PLUGINS,
        seed: steps.map((s) => s.seed || SEED), source: steps.map(() => SOURCE),
        cwds: steps.map((s) => path.join('ws', ...(s.at && s.at !== '.' ? s.at.split('/') : []))),
        env: steps.map(() => ({ ALFRED_CODE_WORKSPACE: '1' })),
        args: steps.map((s, i) => step(s, i)),
        prepare: (repo, work) => { layout(work); prepare(work); },
        each: (repo, i) => (steps[i].after ? steps[i].after(path.dirname(repo)) : null),
    });
}

let world = null;
// The shared case: both levels installed, the old shapes planted, then updates at each level and one cascade.
function theWorld()
{
    if (world) return world;
    const snap = (work) => ({ root: treeOf(work, '.'), child: treeOf(work, CHILD), rootDeny: denyRows(work, '.'), childDeny: denyRows(work, CHILD), childExcludes: excludesOf(work, CHILD) });
    world = scenario([
        { at: '.', after: join },
        { at: CHILD },
        update('.', { before: (work) => { plant(work, '.'); plant(work, CHILD); }, after: snap }),
        update(CHILD, { after: snap }),
        update('.', { after: snap }),
        update(CHILD, { after: snap }),
        { at: '.', seed: CLI, act: 'cascade', args: ['--root', '.'], after: snap },
    ]);
    return world;
}
const excludesOf = (work, rel) => (json(claudeOf(work, rel, 'settings.local.json')) || {}).claudeMdExcludes || [];
const reportsOf = (out, rel) => [...out.matchAll(/^(?:==> )?report: (\S+): added (\d+)(?: \((.*?)\))?, updated (\d+), removed (\d+)(?: \((.*?)\))?, kept, yours (\d+)(?: \((.*)\))?$/gm)]
    .filter((m) => m[1] === rel).map((m) => ({ added: +m[2], addedNames: m[3] || '', updated: +m[4], removed: +m[5], removedNames: m[6] || '', kept: +m[7], keptNames: m[8] || '' }));
const names = (text) => text.split(', ').filter((n) => n && n !== '...');

test('update removes every stack-owned item the new set does not pick, at the root and in the child', POSIX_ONLY, () =>
{
    const r = theWorld();
    const [root, child] = [r.steps[2].root, r.steps[3].child];
    for (const [level, tree] of [['root', root], ['child', child]])
    {
        assert.ok(!tree.includes(RETIRED_SKILL), `${level}: the retired skill and its link are gone:\n${tree}`);
        assert.ok(!tree.includes(`agents/${PICKED_SEAT}.md`), `${level}: the flat seat copy moved into a folder:\n${tree}`);
        assert.ok(tree.includes(`agents/${PICKED_SEAT}/${PICKED_SEAT}.md`) || tree.includes(`agents/${PICKED_SEAT} ->`), `${level}: the seat has its folder`);
        assert.ok(!tree.includes('ghost-skill') && !tree.includes('ghost-agent'), `${level}: a link into the store whose target is gone is removed:\n${tree}`);
        assert.ok(tree.includes('theirs -> ../../vendor/theirs'), `${level}: a dangling link to anywhere else is the user's and stays`);
    }
    assert.ok(!child.includes(CHILD_RULE), `the child's copy of the root rule at the stack's text is gone:\n${child}`);
    for (const deny of [r.steps[2].rootDeny, r.steps[3].childDeny])
    {
        assert.ok(!deny.includes(`Agent(alfred-code:${OLD_SEAT})`), `the shipped seat's deny row is removed: ${deny}`);
        assert.ok(deny.includes(`Agent(alfred-code:${STRANGER})`) && deny.includes('Read(secret.txt)'), `a row naming no seat of ours and the user's own row stay: ${deny}`);
    }
    assert.ok(!r.steps[3].childExcludes.includes(STALE_EXCLUDE), 'a ledgered exclude whose file is gone is dropped');
    assert.ok(r.steps[3].childExcludes.includes(HAND_EXCLUDE), 'a hand-written exclude stays');
});

test('update keeps every user-made skill, agent and rule and names it kept, yours', POSIX_ONLY, () =>
{
    const r = theWorld();
    for (const [rel, out, tree] of [['.', r.outs[2], r.steps[2].root], [CHILD, r.outs[3], r.steps[3].child]])
    {
        // each row of the tree ends in the file's sha: a kept file keeps its bytes
        assert.ok(tree.includes(`.claude/skills/my-skill/SKILL.md ${sha(MINE_SKILL)}`), `${rel}: skill kept with its bytes`);
        assert.ok(tree.includes(`.claude/agents/my-agent.md ${sha(MINE_AGENT)}`), `${rel}: agent kept with its bytes`);
        assert.ok(tree.includes(`.claude/rules/my-rule.md ${sha(MINE_RULE)}`), `${rel}: rule kept with its bytes`);
        const [line] = reportsOf(out, '.');
        assert.ok(line, `${rel}: a report line:\n${out}`);
        const kept = names(line.keptNames);
        for (const own of ['skill my-skill', 'agent my-agent', 'rule my-rule']) assert.ok(kept.includes(own), `${rel}: ${own} named in kept, yours (${line.keptNames})`);
        assert.strictEqual(new Set(kept).size, kept.length, 'each kept item is named once');
    }
});

test('the report line counts added, updated, removed and kept per level, and the new-session line is printed', POSIX_ONLY, () =>
{
    const r = theWorld();
    for (const [level, out] of [['root', r.outs[2]], ['child', r.outs[3]]])
    {
        const rel = '.';
        const [line] = reportsOf(out, rel);
        assert.ok(line, `a report line:\n${out}`);
        assert.ok(line.updated >= 1 && line.removed >= 3 && line.kept >= 3, JSON.stringify(line));
        if (level === 'root') assert.ok(names(line.addedNames).includes(`rule ${ADDED_RULE}`), `the rule this update wrote is added: ${line.addedNames}`);
        for (const gone of [`skill ${RETIRED_SKILL}`, `link skills/ghost-skill`]) assert.ok(names(line.removedNames).includes(gone), `${gone} in removed: ${line.removedNames}`);
        assert.strictEqual(names(line.removedNames).length, Math.min(line.removed, 8));
        // the seat deny rows are ONE item, so the files behind them are named
        assert.ok(line.removed <= 8, `the fixture stays under the name cap: ${line.removedNames}`);
        assert.strictEqual(names(line.removedNames).filter((n) => n.startsWith('deny ')).length, 1, line.removedNames);
        assert.ok(/^deny rows \(\d+\)$/.test(names(line.removedNames).at(-1)), `deny rows come last: ${line.removedNames}`);
        if (level === 'root') for (const gone of [`rule ${TWICE_RULE}`, `file ${NAV_FILE}`]) assert.ok(names(line.removedNames).includes(gone), `${gone} in removed: ${line.removedNames}`);
        if (level === 'child') assert.ok(names(line.removedNames).includes(`rule ${CHILD}.${ADDED_RULE}`), `the child's rule copy is in removed: ${line.removedNames}`);
        assert.ok(out.includes(SESSION), `the new-session line is printed:\n${out}`);
        const lines = out.split('\n');
        assert.ok(lines.findIndex((l) => REPORT_START.test(l)) < lines.indexOf(SESSION), 'the report comes before the new-session line');
    }
    // the cascade names each child by its path below the top
    const cascade = r.outs[6];
    assert.strictEqual(reportsOf(cascade, CHILD).length, 1, cascade);
    assert.strictEqual(reportsOf(cascade, '.').length, 0, 'the child\'s own "." is relabelled');
});

test('a second update changes nothing', POSIX_ONLY, () =>
{
    const r = theWorld();
    assert.strictEqual(r.steps[4].root, r.steps[2].root, 'the root tree is the same after the second update');
    assert.strictEqual(r.steps[5].child, r.steps[3].child, 'the child tree is the same after the second update');
    for (const out of [r.outs[4], r.outs[5]])
    {
        const [line] = reportsOf(out, '.');
        assert.ok(line, out);
        assert.deepStrictEqual([line.added, line.updated, line.removed], [0, 0, 0], `nothing added, updated or removed: ${JSON.stringify(line)}`);
    }
});

// ---- carried in from the earlier reviews: the user's own file is kept, named once, and read the same on every run ----
const SEAT = 'security-auditor';
const SEAT_TEXT = `---\nname: ${SEAT}\ndescription: mine\n---\nMY OWN SEAT\n`;
const repoClaude = (repo, ...rest) => path.join(repo, '.claude', ...rest);
const dropLines = (repo, pattern) => fs.writeFileSync(repoClaude(repo, 'alfred-code.stamp'), fs.readFileSync(repoClaude(repo, 'alfred-code.stamp'), 'utf8').split('\n').filter((l) => !pattern.test(l)).join('\n'));
const LEDGER_LINES = /^(managed-|workspace-(mcp|wrap))/;
const stampLine = (repo, key) => lineOf(fs.readFileSync(repoClaude(repo, 'alfred-code.stamp'), 'utf8'), key);
const keptLines = (out, pattern) => out.split('\n').filter((l) => /agent kept:/.test(l) && pattern.test(l));

test('a user\'s flat seat file whose name: is the seat is kept in a visible home on a plugin stamp, never taken over', POSIX_ONLY, () =>
{
    const { outs, result } = seedRun(['install', 'update', 'update'], `skill markdown-style\nagent ${SEAT}\n`, {
        args: [[], [], []],
        each: (repo, i) =>
        {
            if (i !== 0) return null;
            dropLines(repo, /^(managed-|workspace-(mcp|wrap)|library-agents:|links:)/);
            stampLib.markLine(repoClaude(repo, 'alfred-code.stamp'), 'seats-route', 'plugin');
            fs.rmSync(repoClaude(repo, 'agents', SEAT), { recursive: true, force: true });
            write(repoClaude(repo, 'agents', `${SEAT}.md`), SEAT_TEXT);
            return null;
        },
        inspect: (repo) => ({ mine: read(repoClaude(repo, 'agents', `${SEAT}.md`)), folder: lstat(repoClaude(repo, 'agents', SEAT)) }),
    });
    assert.strictEqual(result.mine, SEAT_TEXT, 'the user\'s text stays on disk');
    assert.strictEqual(result.folder, null, 'no folder is written beside it');
    for (const out of outs.slice(1))
    {
        assert.ok(!/taking over a copy the stamp did not record|agent moved to a folder: security-auditor/.test(out), out);
        assert.strictEqual(keptLines(out, /security-auditor/).length, 1, out);
    }
});

test('a user\'s never-recorded flat seat file leaves picked-agents on the first update, as on the second', POSIX_ONLY, () =>
{
    const { steps } = seedRun(['install', 'update', 'update'], `skill markdown-style\nagent ${SEAT}\n`, {
        args: [['--scope', 'local'], [], []],
        each: (repo, i) =>
        {
            if (i === 0)
            {
                dropLines(repo, LEDGER_LINES);
                fs.rmSync(repoClaude(repo, 'agents', SEAT), { recursive: true, force: true });
                fs.rmSync(path.join(repo, '.alfred', 'stack', 'agents', SEAT), { recursive: true, force: true });
                write(repoClaude(repo, 'agents', `${SEAT}.md`), SEAT_TEXT);
            }
            return stampLine(repo, 'picked-agents');
        },
    });
    assert.ok(steps[1] === steps[2], `update 1 gives what update 2 gives:\n${steps[1]}\n${steps[2]}`);
    assert.ok(!steps[1].includes(SEAT), `the seat is not a pick: ${steps[1]}`);
});

test('a store folder beside a user\'s flat seat file says the kept line once', POSIX_ONLY, () =>
{
    const { outs } = seedRun(['install', 'update'], `skill markdown-style\nagent ${SEAT}\n`, {
        args: [['--scope', 'local'], []],
        each: (repo, i) =>
        {
            if (i !== 0) return null;
            fs.unlinkSync(repoClaude(repo, 'agents', SEAT));
            write(repoClaude(repo, 'agents', `${SEAT}.md`), SEAT_TEXT);
            return null;
        },
    });
    const lines = keptLines(outs[1], /security-auditor/);
    assert.strictEqual(lines.length, 1, lines.join('\n'));
});

test('left_out names no seat for an Agent(alfred-code:<name>) row that is no shipped or retired seat', POSIX_ONLY, () =>
{
    const planFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'left-out-')), 'plan.json');
    try
    {
        seedRun(['install', 'update'], `skill markdown-style\nagent ${SEAT}\n`, {
            args: [['--scope', 'local'], ['--installed-only', '--print-plan', '--plan-out', planFile]],
            each: (repo, i) =>
            {
                if (i !== 0) return null;
                const file = repoClaude(repo, 'settings.local.json');
                const data = json(file) || {};
                data.permissions = { ...(data.permissions || {}), deny: [...((data.permissions || {}).deny || []), `Agent(alfred-code:${STRANGER})`] };
                write(file, `${JSON.stringify(data, null, 2)}\n`);
                return null;
            },
        });
        const plan = json(planFile);
        assert.ok(plan, 'the plan was written');
        assert.ok(!plan.left_out.includes(`agent ${STRANGER}`), `left_out: ${plan.left_out}`);
    }
    finally { fs.rmSync(path.dirname(planFile), { recursive: true, force: true }); }
});

test('the report line cuts a name list at 8 with ", ..." and leaves out the brackets of an empty one', () =>
{
    const { createReport } = require('./install/report.js');
    const report = createReport();
    assert.strictEqual(report.line('.'), 'report: .: added 0, updated 0, removed 0, kept, yours 0');
    for (let i = 1; i <= 9; i++) report.remove('skill', `s${i}`);
    report.keep('agent', 'mine.md');
    report.keep('agent', 'mine.md');
    report.update('rule', 'r');
    assert.strictEqual(report.line('api'),
        'report: api: added 0, updated 1, removed 9 (skill s1, skill s2, skill s3, skill s4, skill s5, skill s6, skill s7, skill s8, ...), kept, yours 1 (agent mine)');
});

test('the seat deny rows are one report item, listed after the others', () =>
{
    const { createReport } = require('./install/report.js');
    const report = createReport();
    for (const seat of ['a', 'b', 'c']) report.remove('deny', seat);
    report.remove('skill', 'old');
    assert.strictEqual(report.line('.'), 'report: .: added 0, updated 0, removed 2 (skill old, deny rows (3)), kept, yours 0');
});
