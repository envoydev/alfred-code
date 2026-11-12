'use strict';
// Workspace stage 3, Task 2: the home, the move and the links in one project - the store in `.alfred/stack/<kind>` where
// git cannot commit a link, one link per item in `.claude/<kind>`, the stamp's `links:` line.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const stamp = require('./install/stamp.js');
const { hashItem } = require('./install/library.js');

const SELECTION = 'skill markdown-style\nskill javascript\nagent evidence-gatherer\n';
const COPY = { ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' };
const stampOf = (repo) => path.join(repo, '.claude', 'alfred-code.stamp');
const store = (repo, kind, name = '') => path.join(repo, '.alfred', 'stack', kind, name);
const claude = (repo, kind, name = '') => path.join(repo, '.claude', kind, name);
const lstat = (p) => { try { return fs.lstatSync(p); } catch { return null; } };
const ignoreClaude = (repo) => fs.writeFileSync(path.join(repo, '.gitignore'), '.claude/\n');
// The tree's state: every file's hash under .claude/skills, .claude/agents and the store, links read as links.
function tree(repo)
{
    const out = {};
    const walk = (dir, rel) =>
    {
        for (const e of (() => { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } })())
        {
            const at = path.join(dir, e.name);
            if (e.isSymbolicLink()) out[`${rel}/${e.name}`] = `-> ${fs.readlinkSync(at)}`;
            else if (e.isDirectory()) walk(at, `${rel}/${e.name}`);
            else out[`${rel}/${e.name}`] = hashItem(at);
        }
    };
    walk(path.join(repo, '.claude', 'skills'), 'cs');
    walk(path.join(repo, '.claude', 'agents'), 'ca');
    walk(path.join(repo, '.alfred', 'stack'), 'st');
    return out;
}

test('store: a fresh local install keeps each picked skill once in the store and links it from .claude', POSIX_ONLY, () =>
{
    const { result, out } = seedRun('install', SELECTION, {
        args: ['--scope', 'local'],
        inspect: (repo) => ({
            lib: stamp.readLibrary(stampOf(repo)), record: stamp.readLinks(stampOf(repo)),
            real: fs.readdirSync(claude(repo, 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name),
            linked: fs.readdirSync(claude(repo, 'skills')).filter((n) => lstat(claude(repo, 'skills', n)).isSymbolicLink()),
            inStore: fs.readdirSync(store(repo, 'skills')),
            reads: fs.readFileSync(claude(repo, 'skills', 'markdown-style/SKILL.md'), 'utf8').length > 0,
        }),
    });
    const skills = Object.keys(result.lib.skills).sort();
    assert.ok(skills.includes('markdown-style') && skills.includes('javascript'), skills.join(','));
    assert.deepStrictEqual(result.real, [], 'no real library folder in .claude/skills');
    assert.deepStrictEqual(result.linked.sort(), skills);
    assert.deepStrictEqual(result.inStore.sort(), skills);
    assert.ok(result.reads);
    assert.deepStrictEqual(result.record.filter((e) => e.path.startsWith('skills/')).map((e) => e.path).sort(), skills.map((s) => `skills/${s}`));
    assert.ok(result.record.every((e) => e.kind === 'symlink'));
    assert.match(out, /link: \.claude\/skills\/markdown-style -> \.alfred\/stack\/skills\/markdown-style/);
});

test('store: on the copy route a picked agent is a file in the store, linked from .claude/agents', POSIX_ONLY, () =>
{
    const { result } = seedRun('install', SELECTION, {
        env: COPY, args: ['--scope', 'local'],
        inspect: (repo) => ({
            agent: lstat(claude(repo, 'agents', 'evidence-gatherer.md')), inStore: fs.existsSync(store(repo, 'agents', 'evidence-gatherer.md')),
            record: stamp.readLinks(stampOf(repo)), files: stamp.readLedger(stampOf(repo)).files,
        }),
    });
    assert.ok(result.agent.isSymbolicLink());
    assert.ok(result.inStore);
    assert.ok(result.record.some((e) => e.path === 'agents/evidence-gatherer.md' && e.kind === 'symlink'));
    assert.ok(result.files['agents/evidence-gatherer.md'] && result.files['skills/markdown-style'], 'the managed-files rows still hash the items');
});

test('store: an update over copies moves each stamped one, keeps the user\'s own, and a second update changes nothing', POSIX_ONLY, () =>
{
    for (const env of [{}, COPY])
    {
        const { outs, steps } = seedRun(['install', 'update', 'update'], SELECTION, {
            env,
            each: (repo, i) =>
            {
                if (i === 0)
                {
                    assert.ok(fs.lstatSync(claude(repo, 'skills', 'markdown-style')).isDirectory(), 'project scope, .claude visible: copies');
                    ignoreClaude(repo);
                    fs.appendFileSync(claude(repo, 'skills', 'javascript/SKILL.md'), '\nmy edit\n');
                    fs.mkdirSync(claude(repo, 'skills', 'my-skill'), { recursive: true });
                    fs.writeFileSync(claude(repo, 'skills', 'my-skill/SKILL.md'), 'mine');
                    fs.mkdirSync(claude(repo, 'agents'), { recursive: true });
                    fs.writeFileSync(claude(repo, 'agents', 'my-agent.md'), 'mine');
                }
                return tree(repo);
            },
            inspect: (repo) => ({ record: stamp.readLinks(stampOf(repo)), mine: lstat(claude(repo, 'skills', 'my-skill')), agent: lstat(claude(repo, 'agents', 'my-agent.md')) }),
        });
        assert.match(outs[1], /skill moved to the store: markdown-style$/m);
        assert.match(outs[1], /skill moved to the store: javascript$/m);
        assert.match(outs[1], env === COPY ? /skill \[project\]: javascript$/m : /overwriting a hand-edited copy: skill javascript$/m, 'the edited copy is refreshed as today (ruling 4)');
        assert.ok(steps[1]['cs/markdown-style'].startsWith('-> '), 'the moved copy is now a link');
        assert.ok(steps[1]['st/skills/markdown-style/SKILL.md'], 'and sits in the store');
        assert.ok(!/moved to the store|^link: /m.test(outs[2]), outs[2]);
        assert.deepStrictEqual(steps[2], steps[1], 'the second update leaves every file as it was');
        if (env === COPY) assert.ok(steps[1]['ca/evidence-gatherer.md'].startsWith('-> '));
    }
});

test('store: the user\'s own skill folder and agent file stay in .claude, off the record', POSIX_ONLY, () =>
{
    const { result } = seedRun(['install', 'update'], SELECTION, {
        env: COPY,
        each: (repo, i) =>
        {
            if (i !== 0) return null;
            ignoreClaude(repo);
            fs.mkdirSync(claude(repo, 'skills', 'my-skill'), { recursive: true });
            fs.writeFileSync(claude(repo, 'skills', 'my-skill/SKILL.md'), 'mine');
            fs.writeFileSync(claude(repo, 'agents', 'my-agent.md'), 'mine');
            return null;
        },
        inspect: (repo) => ({ record: stamp.readLinks(stampOf(repo)), skill: lstat(claude(repo, 'skills', 'my-skill')), agent: lstat(claude(repo, 'agents', 'my-agent.md')) }),
    });
    assert.ok(result.skill.isDirectory() && !result.skill.isSymbolicLink());
    assert.ok(result.agent.isFile() && !result.agent.isSymbolicLink());
    assert.ok(!result.record.some((e) => /my-/.test(e.path)));
});

test('store: a --print-plan run over an install not yet moved writes nothing', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update'], SELECTION, {
        args: [[], ['--installed-only', '--print-plan']],
        each: (repo, i) => { if (i === 0) ignoreClaude(repo); return tree(repo); },
        inspect: (repo) => fs.existsSync(path.join(repo, '.alfred', 'stack')),
    });
    assert.deepStrictEqual(steps[1], steps[0]);
    assert.match(outs[1], /^plan skills: .*\bmarkdown-style\b/m);
    assert.ok(!/moved to the store/.test(outs[1]));
});

test('store: a project-scope install whose .claude git sees keeps copies and says why', POSIX_ONLY, () =>
{
    const { out, result } = seedRun('install', SELECTION, {
        inspect: (repo) => ({ store: fs.existsSync(store(repo, 'skills')), copy: lstat(claude(repo, 'skills', 'markdown-style')), record: stamp.readLinks(stampOf(repo)) }),
    });
    assert.ok(!result.store);
    assert.ok(result.copy.isDirectory() && !result.copy.isSymbolicLink());
    assert.deepStrictEqual(result.record, []);
    assert.match(out, /skills stay as copies in \.claude\/skills: git does not ignore that folder here/);
});

for (const [route, env] of [['plugin', {}], ['copy', COPY]])
    test(`store: a move from the local to the project scope keeps every pick, each link turned into a real copy (${route} route)`, POSIX_ONLY, () =>
    {
        const { codes, outs, result } = seedRun(['install', 'update', 'update'], SELECTION, {
            env, args: [['--scope', 'local'], ['--scope', 'project', '--installed-only'], ['--installed-only']],
            inspect: (repo) => ({
                picked: stamp.readPicked(stampOf(repo)).skills, record: stamp.readLinks(stampOf(repo)),
                kinds: ['javascript', 'markdown-style'].map((n) => lstat(claude(repo, 'skills', n))).map((st) => st && (st.isSymbolicLink() ? 'link' : st.isDirectory() ? 'dir' : 'other')),
                reads: fs.existsSync(claude(repo, 'skills', 'markdown-style/SKILL.md')),
            }),
        });
        assert.deepStrictEqual(codes, [0, 0, 0]);
        assert.ok(['javascript', 'markdown-style'].every((n) => result.picked.includes(n)), result.picked.join(','));
        assert.deepStrictEqual(result.kinds, ['dir', 'dir']);
        assert.ok(result.reads);
        assert.deepStrictEqual(result.record, []);
        assert.match(outs[1], /link replaced by a copy: \.claude\/skills\/markdown-style/);
        assert.doesNotMatch(outs[1] + outs[2], /pruned \(library item not picked\): markdown-style/);
    });

test('store: a local -> project move over a store item that differs from the release keeps no stale record or store item', POSIX_ONLY, () =>
{
    const { codes, outs, result } = seedRun(['install', 'update'], SELECTION, {
        args: [['--scope', 'local'], ['--scope', 'project', '--installed-only']],
        each: (repo, i) => (i === 0 ? fs.appendFileSync(store(repo, 'skills', 'markdown-style/SKILL.md'), '\nedited\n') : null),
        inspect: (repo) => ({ st: lstat(claude(repo, 'skills', 'markdown-style')), record: stamp.readLinks(stampOf(repo)), inStore: fs.existsSync(store(repo, 'skills', 'markdown-style')) }),
    });
    assert.deepStrictEqual(codes, [0, 0]);
    assert.ok(result.st.isDirectory() && !result.st.isSymbolicLink());
    assert.deepStrictEqual(result.record, [], outs[1]);
    assert.ok(!result.inStore, 'the refreshed store item moved into .claude');
    assert.match(outs[1], /overwriting a hand-edited copy: skill markdown-style/);
});

test('store: a local -> project -> local round trip links every skill again from the store, and nothing is left behind', POSIX_ONLY, () =>
{
    const { codes, outs, steps, result } = seedRun(['install', 'update', 'update'], SELECTION, {
        args: [['--scope', 'local'], ['--scope', 'project', '--installed-only'], ['--scope', 'local', '--installed-only']],
        each: (repo, i) => (i === 1 ? fs.existsSync(store(repo, 'skills', 'markdown-style')) : null),
        inspect: (repo) => ({ st: lstat(claude(repo, 'skills', 'markdown-style')), reads: fs.existsSync(claude(repo, 'skills', 'markdown-style/SKILL.md')) }),
    });
    assert.deepStrictEqual(codes, [0, 0, 0]);
    assert.strictEqual(steps[1], false, 'the project-scope run moved the store item back into .claude');
    assert.ok(result.st.isSymbolicLink() && result.reads);
    assert.doesNotMatch(outs[2], /link skipped/);
});

test('store: a listed link whose target the user removed is removed and named at the next run', POSIX_ONLY, () =>
{
    const { outs, result } = seedRun(['install', 'update', 'update'], SELECTION, {
        args: ['--scope', 'local'],
        each: (repo, i) =>
        {
            if (i === 0) { fs.mkdirSync(store(repo, 'skills', 'my-own'), { recursive: true }); fs.writeFileSync(store(repo, 'skills', 'my-own/SKILL.md'), 'mine'); }
            if (i === 1)
            {
                assert.ok(lstat(claude(repo, 'skills', 'my-own')).isSymbolicLink(), 'the user\'s own item in the store is linked too');
                fs.rmSync(store(repo, 'skills', 'my-own'), { recursive: true });
            }
            return null;
        },
        inspect: (repo) => ({ link: lstat(claude(repo, 'skills', 'my-own')), record: stamp.readLinks(stampOf(repo)) }),
    });
    assert.match(outs[2], /link removed: \.claude\/skills\/my-own - its target is gone$/m);
    assert.strictEqual(result.link, null);
    assert.ok(!result.record.some((e) => e.path === 'skills/my-own'));
});

test('store: an update whose move fails keeps every copy in .claude this run, and the next update moves them', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update', 'update', 'update'], SELECTION, {
        args: [[], [], ['--installed-only', '--print-plan'], []],
        each: (repo, i) =>
        {
            if (i === 0) { ignoreClaude(repo); fs.mkdirSync(path.join(repo, '.alfred', 'stack'), { recursive: true }); fs.writeFileSync(store(repo, 'skills'), 'a file'); }
            const snap = { real: lstat(claude(repo, 'skills', 'markdown-style')) && lstat(claude(repo, 'skills', 'markdown-style')).isDirectory() && !lstat(claude(repo, 'skills', 'markdown-style')).isSymbolicLink() };
            if (i === 2) fs.rmSync(store(repo, 'skills'));
            return snap;
        },
    });
    assert.match(outs[1], / {2}!! skills stay in \.claude this run: \S+ could not be moved \(E[A-Z]+\)$/m);
    assert.ok(steps[1].real, 'the copy is still a real folder in .claude');
    assert.match(outs[2], /^plan skills: .*\bmarkdown-style\b/m);
    assert.match(outs[3], /skill moved to the store: markdown-style$/m);
    assert.ok(!steps[3].real);
});

test('store: an uninstall removes the links first, the store items at their hash, keeps an edited one and the user\'s own', POSIX_ONLY, () =>
{
    const { out, result } = seedRun(['install', 'uninstall'], SELECTION, {
        env: COPY, args: [['--scope', 'local'], []],
        each: (repo, i) =>
        {
            if (i !== 0) return null;
            fs.appendFileSync(store(repo, 'skills', 'javascript/SKILL.md'), '\nmy edit\n');
            fs.mkdirSync(store(repo, 'skills', 'my-own'), { recursive: true });
            fs.writeFileSync(store(repo, 'skills', 'my-own/SKILL.md'), 'mine');
            return null;
        },
        inspect: (repo) => ({
            links: (fs.existsSync(claude(repo, 'skills')) ? fs.readdirSync(claude(repo, 'skills')) : []).filter((n) => lstat(claude(repo, 'skills', n)).isSymbolicLink()),
            md: fs.existsSync(store(repo, 'skills', 'markdown-style')), js: fs.existsSync(store(repo, 'skills', 'javascript/SKILL.md')),
            mine: fs.existsSync(store(repo, 'skills', 'my-own/SKILL.md')), agents: fs.existsSync(store(repo, 'agents')),
        }),
    });
    assert.deepStrictEqual(result.links, []);
    assert.strictEqual(result.md, false);
    assert.strictEqual(result.js, true);
    assert.match(out, /skill javascript: kept - changed since the stack wrote it/);
    assert.strictEqual(result.mine, true);
    assert.strictEqual(result.agents, false, 'the agents store went once empty');
});

// Workspace stage 3, Task 3: what a root holds for its joined members (memberPicks, the `member-picks:` line, the seats).
const { putWorkspace } = require('./workspace-fixture.js');
const member = (repo, rel, picks, route = 'plugin') =>
{
    fs.mkdirSync(path.join(repo, rel, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(repo, rel, '.claude', 'alfred-code.stamp'), `seats-route: ${route}\nown-picks: ${picks}\n`);
    putWorkspace(path.join(repo, rel), { parent: '..' });
    putWorkspace(repo, { children: [rel] });
};
const lineOf = (text, key) => ((new RegExp(`^${key}: ?(.*)$`, 'm').exec(text) || [])[1] ?? null);
const bare = (text) => text.split('\n').filter((l) => !/^installed(-ms)?:/.test(l)).join('\n');
const ROOT_ONLY = 'skill markdown-style\n';

// A member joins only a stamped root, so each test installs the root first and adds the member after that run.
test('root: a member\'s own skill is held in the root\'s store and on member-picks, never on picked-skills or the plan', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update', 'update', 'update'], ROOT_ONLY, {
        args: [['--scope', 'local'], ['--installed-only'], ['--installed-only'], ['--installed-only', '--print-plan']],
        each: (repo, i) =>
        {
            if (i === 0) member(repo, 'api', 'skill/csharp');
            return { stamp: fs.readFileSync(stampOf(repo), 'utf8'), store: fs.existsSync(store(repo, 'skills', 'csharp/SKILL.md')), link: lstat(claude(repo, 'skills', 'csharp')) };
        },
    });
    const text = steps[1].stamp;
    assert.ok(steps[1].store && steps[1].link && steps[1].link.isSymbolicLink(), outs[1]);
    assert.strictEqual(lineOf(text, 'member-picks'), 'skill/csharp');
    assert.match(lineOf(text, 'library-skills'), /(^|,)csharp=/);
    assert.doesNotMatch(lineOf(text, 'picked-skills'), /(^|,)csharp(,|$)/);
    assert.match(outs[1], /kept for members below: csharp/);
    assert.strictEqual(bare(steps[2].stamp), bare(text), 'an --installed-only update writes the same stamp');
    assert.doesNotMatch(outs[3].split('\n').find((l) => l.startsWith('plan skills:')), /\bcsharp\b/);
});

test('root: a member that drops its pick drops the item; a root that picks it itself takes it off member-picks', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update', 'update', 'update'], ROOT_ONLY, {
        args: [['--scope', 'local'], ['--installed-only'], ['--installed-only'], ['--installed-only', '--add', 'skill devops']],
        each: (repo, i) =>
        {
            if (i === 0) member(repo, 'api', 'skill/csharp');
            if (i === 1) fs.writeFileSync(path.join(repo, 'api', '.claude', 'alfred-code.stamp'), 'seats-route: plugin\nown-picks: skill/devops\n');
            return { stamp: fs.readFileSync(stampOf(repo), 'utf8'), csharp: fs.existsSync(store(repo, 'skills', 'csharp')), devops: fs.existsSync(store(repo, 'skills', 'devops')) };
        },
    });
    assert.ok(!steps[2].csharp && steps[2].devops, outs[2]);
    assert.strictEqual(lineOf(steps[2].stamp, 'member-picks'), 'skill/devops');
    assert.ok(steps[3].devops);
    assert.strictEqual(lineOf(steps[3].stamp, 'member-picks'), null);
    assert.match(lineOf(steps[3].stamp, 'picked-skills'), /(^|,)devops(,|$)/);
});

test('root: a seat a member picked leaves the root\'s deny rows; a hand-written row for it stays and is named', POSIX_ONLY, () =>
{
    const deny = (repo) => (JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.local.json'), 'utf8')).permissions || {}).deny || [];
    const ROW = 'Agent(alfred-code:evidence-gatherer)';
    const { outs, steps } = seedRun(['install', 'update', 'update'], ROOT_ONLY, {
        args: [['--scope', 'local'], ['--installed-only'], ['--installed-only']],
        each: (repo, i) =>
        {
            const now = deny(repo);
            if (i === 0) member(repo, 'api', 'agent/evidence-gatherer');
            if (i === 1) { const f = path.join(repo, '.claude', 'settings.local.json'); const d = JSON.parse(fs.readFileSync(f, 'utf8')); d.permissions.deny.push(ROW); fs.writeFileSync(f, JSON.stringify(d, null, 2)); }
            return now;
        },
    });
    assert.ok(steps[0].includes(ROW), 'denied while no member picks it');
    assert.ok(!steps[1].includes(ROW), outs[1]);
    assert.ok(steps[1].some((r) => /^Agent\(alfred-code:/.test(r)), 'the root still denies the seats nobody picked');
    assert.match(outs[1], /kept for members below: evidence-gatherer/);
    assert.ok(steps[2].includes(ROW), 'the user\'s own row stays');
    assert.match(outs[2], /seat evidence-gatherer stays off here: your own deny row/);
});

test('root: a root whose .claude/skills git sees holds no member-only skill and says so', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update'], ROOT_ONLY, {
        args: [[], ['--installed-only']],
        each: (repo, i) =>
        {
            if (i === 0) member(repo, 'api', 'skill/csharp');
            return { csharp: fs.existsSync(claude(repo, 'skills', 'csharp')), line: lineOf(fs.readFileSync(stampOf(repo), 'utf8'), 'member-picks') };
        },
    });
    assert.match(outs[1], /member pick skills\/csharp not held: \.claude\/skills is not ignored here/);
    assert.strictEqual(steps[1].csharp, false);
    assert.strictEqual(steps[1].line, null);
});

test('root: a run that finds the root locked keeps its member-picks line and names the lock', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update', 'update'], ROOT_ONLY, {
        args: [['--scope', 'local'], ['--installed-only'], ['--installed-only']],
        each: (repo, i) =>
        {
            if (i === 0) member(repo, 'api', 'skill/csharp');
            if (i === 1) fs.writeFileSync(path.join(repo, '.alfred', 'workspace.lock'), String(process.pid));
            return { line: lineOf(fs.readFileSync(stampOf(repo), 'utf8'), 'member-picks'), csharp: fs.existsSync(store(repo, 'skills', 'csharp')) };
        },
    });
    assert.match(outs[2], /!! workspace: the store is locked - member picks are read at the next run/);
    assert.strictEqual(steps[2].line, 'skill/csharp', outs[2]);
    assert.ok(steps[2].csharp);
});

// Workspace stage 3, Task 4: the joined child. `ws` is a plain folder (no repository, so every kind is linkable) holding
// the root, and `ws/api` a child below it in its own repository; every run is at local scope. A step: { at, act, sel, args, before(ws), after(ws) }.
const wsLib = require('./install/workspace.js');
const KID_SEL = 'skill javascript\nrule alfred-security\n';
// A joined child is its own repository (workspace.js joinVerdict refuses a same-repository or a plain folder).
const gitInit = (dir) => { fs.mkdirSync(dir, { recursive: true }); require('./install/runtime.js').execCommand('git', ['init', '-q', dir]); };
function child(steps, { prepare = () => {} } = {})
{
    return seedRun(steps.map((s) => s.act || 'install'), '', {
        plugins: JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true, scope: 'user' }]),
        cwds: steps.map((s) => path.join('ws', ...(s.at && s.at !== '.' ? s.at.split('/') : []))),
        env: steps.map((s) => ({ ALFRED_CODE_WORKSPACE: '1', ...(s.env || {}) })),
        args: steps.map((s, i) => (repo, work) =>
        {
            const ws = path.join(work, 'ws');
            if (s.before) s.before(ws, work);
            const sel = path.join(work, `sel-${i}.txt`);
            fs.writeFileSync(sel, s.sel ?? KID_SEL);
            const act = s.act || 'install';
            return [...(act === 'install' ? ['--selection', sel, '--scope', 'local'] : act === 'update' ? ['--installed-only', '--scope', 'local'] : []), ...(typeof s.args === 'function' ? s.args(ws, work) : s.args || [])];
        }),
        prepare: (repo, work) => { gitInit(path.join(work, 'ws', 'api')); prepare(path.join(work, 'ws')); },
        each: (repo, i) => (steps[i].after ? steps[i].after(path.join(path.dirname(repo), 'ws')) : null),
    });
}
const joinTo = (rel) => (ws, work) =>
{
    const env = { CLAUDE_CONFIG_DIR: path.join(work, 'acct') };
    assert.ok(wsLib.writeWorkspace(path.join(ws, rel), (m) => wsLib.setParent(m, '..'), { env }).ok);
    assert.ok(wsLib.writeWorkspace(ws, (m) => wsLib.addChild(m, rel), { env }).ok);
};
const joinApi = joinTo('api');
const linkOf = (dir, kind, name) => { const st = lstat(claude(dir, kind, name)); return st && st.isSymbolicLink() ? fs.realpathSync.native(claude(dir, kind, name)) : null; };
const OWN_PICK = 'npm';

test('child: its --print-plan lists the skills it links, the root\'s and its own pick', POSIX_ONLY, () =>
{
    const { outs } = child([
        { at: '.' },
        { at: 'api', sel: `${KID_SEL}skill ${OWN_PICK}\n`, before: joinApi },
        { at: 'api', act: 'update', args: ['--print-plan'] },
    ]);
    const plan = outs[2].split('\n').find((l) => l.startsWith('plan skills:')) || '';
    assert.match(plan, /\bjavascript\b/, outs[2]);
    assert.match(plan, new RegExp(`\\b${OWN_PICK}\\b`), outs[2]);
});

const acct = (work) => ({ CLAUDE_CONFIG_DIR: path.join(work, 'acct') });
const kidState = (ws) => { const kid = path.join(ws, 'api'); return { js: linkOf(kid, 'skills', 'javascript'), npm: linkOf(kid, 'skills', OWN_PICK), stamp: fs.readFileSync(stampOf(kid), 'utf8'), kidStore: fs.existsSync(store(kid, 'skills')) ? fs.readdirSync(store(kid, 'skills')) : [], rootStore: fs.existsSync(store(ws, 'skills')) ? fs.realpathSync.native(store(ws, 'skills')) : null }; };
const inRoot = (got, p) => Boolean(p && got.rootStore) && p.startsWith(got.rootStore + path.sep);

test('child: a run whose parent read-back is in doubt keeps every link and its own pick', POSIX_ONLY, () =>
{
    const { outs, steps } = child([
        { at: '.' },
        { at: 'api', sel: `${KID_SEL}skill ${OWN_PICK}\n`, before: joinApi },
        { at: 'api', act: 'update', before: (ws, work) => fs.writeFileSync(path.join(work, 'blind.json'), '{"blind":true}'), args: (ws, work) => ['--parent-plan', path.join(work, 'blind.json')], after: kidState },
    ]);
    const got = steps[2];
    assert.ok(got.js && got.npm, outs[2]);
    assert.match(lineOf(got.stamp, 'own-picks'), new RegExp(`skill/${OWN_PICK}`));
    assert.match(lineOf(got.stamp, 'picked-skills'), /(^|,)javascript(,|$)/);
});

test('child: a run with the workspace switched off keeps every link it made', POSIX_ONLY, () =>
{
    const { outs, steps } = child([
        { at: '.' },
        { at: 'api', sel: `${KID_SEL}skill ${OWN_PICK}\n`, before: joinApi },
        { at: 'api', act: 'update', env: { ALFRED_CODE_WORKSPACE: '0' }, after: kidState },
    ]);
    const got = steps[2];
    assert.ok(inRoot(got, got.js) && inRoot(got, got.npm), outs[2]);
    assert.deepStrictEqual(got.kidStore, []);
});

test('child: unlisted, then its root uninstalled, it keeps its picks as items of its own store', POSIX_ONLY, () =>
{
    const { outs, steps } = child([
        { at: '.' },
        { at: 'api', sel: `${KID_SEL}skill ${OWN_PICK}\n`, before: joinApi },
        { at: '.', act: 'uninstall', before: (ws, work) => assert.ok(wsLib.writeWorkspace(ws, (m) => wsLib.removeChild(m, 'api'), { env: acct(work) }).ok) },
        { at: 'api', act: 'update', after: kidState },
    ]);
    const got = steps[3];
    assert.ok(got.js && got.npm && got.js.includes(`${path.sep}api${path.sep}`) && got.npm.includes(`${path.sep}api${path.sep}`), outs[3]);
    assert.ok(['javascript', OWN_PICK].every((n) => got.kidStore.includes(n)), got.kidStore.join(','));
    assert.match(lineOf(got.stamp, 'picked-skills'), new RegExp(`(^|,)${OWN_PICK}(,|$)`));
});

test('root: a run with the workspace switched off keeps its members\' picks in its store', POSIX_ONLY, () =>
{
    const { outs, steps } = child([
        { at: '.' },
        { at: 'api', sel: `${KID_SEL}skill ${OWN_PICK}\n`, before: joinApi },
        { at: '.', act: 'update', env: { ALFRED_CODE_WORKSPACE: '0' }, after: (ws) => ({ ...kidState(ws), root: fs.readFileSync(stampOf(ws), 'utf8') }) },
    ]);
    const got = steps[2];
    assert.ok(inRoot(got, got.npm), outs[2]);
    assert.strictEqual(lineOf(got.root, 'member-picks'), `skill/${OWN_PICK}`);
});

test('child: on the copy route its move to the project scope copies the root\'s items and leaves the root\'s store as it was', POSIX_ONLY, () =>
{
    const mark = (ws) => [store(ws, 'skills', 'javascript/SKILL.md'), store(ws, 'agents', 'evidence-gatherer.md')];
    const { outs, steps } = child([
        { at: '.', env: COPY, sel: `${KID_SEL}agent evidence-gatherer\n` },
        { at: 'api', before: joinApi, env: COPY, sel: `${KID_SEL}agent evidence-gatherer\n` },
        { at: 'api', act: 'update', env: COPY, args: ['--scope', 'project'], before: (ws) => mark(ws).forEach((f) => fs.appendFileSync(f, '\nroot-mark\n')),
            after: (ws) => ({ root: mark(ws).map((f) => fs.readFileSync(f, 'utf8').includes('root-mark')), kid: lstat(claude(path.join(ws, 'api'), 'skills', 'javascript')) }) },
    ]);
    assert.deepStrictEqual(steps[2].root, [true, true], outs[2]);
    assert.ok(steps[2].kid.isDirectory() && !steps[2].kid.isSymbolicLink());
});

test('child: a leave that fails on the root\'s lock leaves every link pointing at the root', POSIX_ONLY, () =>
{
    const { steps } = child([
        { at: '.' },
        { at: 'api', before: joinApi, after: (ws) =>
        {
            const lock = wsLib.locate(ws).lock;
            fs.mkdirSync(path.dirname(lock), { recursive: true });
            fs.writeFileSync(lock, String(process.pid));
            const left = wsLib.applyRole(path.join(ws, 'api'), 'leave:standalone', { env: acct(path.dirname(ws)) });
            fs.unlinkSync(lock);
            return { left, ...kidState(ws) };
        } },
    ]);
    const got = steps[1];
    assert.strictEqual(got.left.ok, false);
    assert.ok(inRoot(got, got.js), got.js);
    assert.deepStrictEqual(got.kidStore, []);
});

test('child: its install links the root\'s skills, holds no copy of them, and its own pick goes to the root\'s store', POSIX_ONLY, () =>
{
    const { outs, steps } = child([
        { at: '.' },
        { at: 'api', sel: `${KID_SEL}skill ${OWN_PICK}\n`, before: joinApi, after: (ws) => ({ js: linkOf(path.join(ws, 'api'), 'skills', 'javascript'), npm: linkOf(path.join(ws, 'api'), 'skills', OWN_PICK), kidStore: fs.existsSync(store(path.join(ws, 'api'), 'skills')) && fs.readdirSync(store(path.join(ws, 'api'), 'skills')), root: fs.readFileSync(stampOf(ws), 'utf8'), kid: fs.readFileSync(stampOf(path.join(ws, 'api')), 'utf8') }) },
        { at: 'api', act: 'update' },
        { at: '.', act: 'update', after: (ws) => fs.readFileSync(stampOf(ws), 'utf8') },
    ]);
    const got = steps[1];
    assert.ok(got.js && got.js.endsWith(path.join('.alfred', 'stack', 'skills', 'javascript')) && !got.js.includes(`${path.sep}api${path.sep}`), outs[1]);
    assert.ok(got.npm && got.npm.endsWith(path.join('.alfred', 'stack', 'skills', OWN_PICK)) && !got.npm.includes(`${path.sep}api${path.sep}`), outs[1]);
    assert.deepStrictEqual(got.kidStore || [], [], 'the child keeps no stack copy of its own');
    assert.match(outs[1], new RegExp(`store: skills/${OWN_PICK} added to \\.\\./?\\.alfred/stack|store: skills/${OWN_PICK} added to `));
    assert.strictEqual(lineOf(got.root, 'member-picks'), `skill/${OWN_PICK}`);
    assert.match(lineOf(got.root, 'library-skills'), new RegExp(`(^|,)${OWN_PICK}=`));
    assert.match(lineOf(got.kid, 'own-picks'), new RegExp(`skill/${OWN_PICK}`));
    assert.match(outs[2], /workspace: from \.\. - 0 added, 0 dropped/);
    for (const key of ['library-skills', 'member-picks']) assert.strictEqual(lineOf(steps[3], key), lineOf(got.root, key), `the root's next run keeps the ${key} the child's add wrote`);
});

test('child: an inherited skill the child edited stays in its own store, linked from there', POSIX_ONLY, () =>
{
    const { outs, steps } = child([
        { at: '.', args: [], env: {} },
        { at: 'api', before: (ws, work) => { joinApi(ws, work); }, after: (ws) => linkOf(path.join(ws, 'api'), 'skills', 'javascript') },
        { at: 'api', act: 'update', before: (ws) =>
        {
            // The child's copy from an older release, edited by hand: put back as a real folder with its stamped hash.
            const kid = path.join(ws, 'api');
            fs.unlinkSync(claude(kid, 'skills', 'javascript'));
            fs.cpSync(store(ws, 'skills', 'javascript'), claude(kid, 'skills', 'javascript'), { recursive: true });
            const file = stampOf(kid);
            const h = hashItem(claude(kid, 'skills', 'javascript'));
            fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^library-skills: ?(.*)$/m, (l, v) => `library-skills: ${[v, `javascript=${h}`].filter(Boolean).join(',')}`).replace(/^links:.*\n/m, ''));
            fs.appendFileSync(path.join(claude(kid, 'skills', 'javascript'), 'SKILL.md'), '\nedited here\n');
        }, after: (ws) => { const link = linkOf(path.join(ws, 'api'), 'skills', 'javascript'); return { link, text: link && fs.readFileSync(path.join(link, 'SKILL.md'), 'utf8'), rootText: fs.readFileSync(path.join(store(ws, 'skills', 'javascript'), 'SKILL.md'), 'utf8') }; } },
    ]);
    assert.ok(steps[1], outs[1]);
    assert.ok(steps[2].link && steps[2].link.includes(path.join('api', '.alfred', 'stack', 'skills', 'javascript')), outs[2]);
    assert.ok(steps[2].text.includes('edited here'));
    assert.match(outs[2], /!! skill kept: javascript - linked from above, but edited here/);
    assert.ok(!steps[2].rootText.includes('edited here'), 'the root\'s store keeps the stack\'s text');
});

test('child: a root locked by another run leaves the add for the next run, the pick a real item in the child\'s store', POSIX_ONLY, () =>
{
    const { outs, steps } = child([
        { at: '.' },
        { at: 'api', sel: `${KID_SEL}skill ${OWN_PICK}\n`, before: (ws, work) => { joinApi(ws, work); fs.writeFileSync(path.join(ws, '.alfred', 'workspace.lock'), String(process.pid)); },
            after: (ws) => { fs.rmSync(path.join(ws, '.alfred', 'workspace.lock'), { force: true }); return linkOf(path.join(ws, 'api'), 'skills', OWN_PICK); } },
        { at: 'api', act: 'update', after: (ws) => ({ link: linkOf(path.join(ws, 'api'), 'skills', OWN_PICK), root: lineOf(fs.readFileSync(stampOf(ws), 'utf8'), 'member-picks') }) },
    ]);
    assert.match(outs[1], new RegExp(`!! store: \\.\\. is locked - skills/${OWN_PICK} is added at the next run`));
    assert.ok(steps[1] && steps[1].includes(path.join('api', '.alfred', 'stack', 'skills', OWN_PICK)), outs[1]);
    assert.ok(steps[2].link && !steps[2].link.includes(`${path.sep}api${path.sep}`), outs[2]);
    assert.strictEqual(steps[2].root, `skill/${OWN_PICK}`);
});

const localOf = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.local.json'), 'utf8')); } catch { return {}; } };
const ROOT_TWO = `${KID_SEL}skill ${OWN_PICK}\n`;

test('child: an ignored root skill is not linked and gets no row', POSIX_ONLY, () =>
{
    const { outs, steps } = child([
        { at: '.', sel: ROOT_TWO },
        { at: 'api', sel: ROOT_TWO, before: joinApi, after: (ws) => linkOf(path.join(ws, 'api'), 'skills', 'javascript') },
        { at: 'api', act: 'update', before: (ws, work) =>
        {
            const env = { CLAUDE_CONFIG_DIR: path.join(work, 'acct') };
            assert.ok(wsLib.writeWorkspace(path.join(ws, 'api'), (m) => wsLib.addIgnore(m, 'skill', 'javascript'), { env }).ok);
        }, after: (ws) => ({ js: lstat(claude(path.join(ws, 'api'), 'skills', 'javascript')), npm: linkOf(path.join(ws, 'api'), 'skills', OWN_PICK), over: localOf(path.join(ws, 'api')).skillOverrides }) },
    ]);
    assert.ok(steps[1], outs[1]);
    assert.strictEqual(steps[2].js, null, outs[2]);
    assert.ok(steps[2].npm, 'the root\'s other skill stays linked');
    assert.strictEqual(steps[2].over, undefined);
});

test('child: a sibling\'s pick held at the root is never linked in another child, and gets no row there', POSIX_ONLY, () =>
{
    const { outs, steps } = child([
        { at: '.' },
        { at: 'api', sel: ROOT_TWO, before: joinApi, after: (ws) => linkOf(path.join(ws, 'api'), 'skills', OWN_PICK) },
        { at: 'web', before: joinTo('web'), after: (ws) => ({ link: lstat(claude(path.join(ws, 'web'), 'skills', OWN_PICK)), js: linkOf(path.join(ws, 'web'), 'skills', 'javascript'), over: localOf(path.join(ws, 'web')).skillOverrides }) },
    ], { prepare: (ws) => gitInit(path.join(ws, 'web')) });
    assert.ok(steps[1], outs[1]);
    assert.strictEqual(steps[2].link, null, outs[2]);
    assert.ok(steps[2].js, outs[2]);
    assert.strictEqual(steps[2].over, undefined);
});

test('child: a skill the root adds later is linked by the root\'s run alone, never in a child that ignores it or one not yet moved', POSIX_ONLY, () =>
{
    const { outs, steps } = child([
        { at: '.' },
        { at: 'api', before: joinApi },
        { at: 'web', before: (ws, work) => { joinTo('web')(ws, work); assert.ok(wsLib.writeWorkspace(path.join(ws, 'web'), (m) => wsLib.addIgnore(m, 'skill', OWN_PICK), { env: { CLAUDE_CONFIG_DIR: path.join(work, 'acct') } }).ok); } },
        { at: 'old', before: joinTo('old'), after: (ws) => { const f = stampOf(path.join(ws, 'old')); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^links:.*\n/m, '')); } },
        { at: '.', act: 'update', args: ['--add', `skill ${OWN_PICK}`], after: (ws) => ({
            api: linkOf(path.join(ws, 'api'), 'skills', OWN_PICK), web: lstat(claude(path.join(ws, 'web'), 'skills', OWN_PICK)), old: lstat(claude(path.join(ws, 'old'), 'skills', OWN_PICK)),
            apiLine: lineOf(fs.readFileSync(stampOf(path.join(ws, 'api')), 'utf8'), 'links'), oldLine: lineOf(fs.readFileSync(stampOf(path.join(ws, 'old')), 'utf8'), 'links'),
        }) },
    ], { prepare: (ws) => { gitInit(path.join(ws, 'web')); gitInit(path.join(ws, 'old')); } });
    const got = steps[4];
    assert.ok(got.api && !got.api.includes(`${path.sep}api${path.sep}`), outs[4]);
    assert.match(got.apiLine, new RegExp(`skills/${OWN_PICK}=symlink`));
    assert.strictEqual(got.web, null, outs[4]);
    assert.strictEqual(got.old, null);
    assert.strictEqual(got.oldLine, null, 'no links line is written into a child not yet moved');
    assert.doesNotMatch(outs[4], /\bold\b.*link/);
});

const ownStore = (dir, kind) => { try { return fs.readdirSync(store(dir, kind)).sort(); } catch { return []; } };
const planSkills = (out) => (out.split('\n').find((l) => l.startsWith('plan skills:')) || '');

test('child: released by its root\'s uninstall or leaving, it holds each item it linked as its own, linked there', POSIX_ONLY, () =>
{
    const inOwn = (dir, name) => { const l = linkOf(dir, 'skills', name); return Boolean(l) && fs.existsSync(store(dir, 'skills')) && l.startsWith(fs.realpathSync.native(store(dir, 'skills'))) && fs.existsSync(path.join(l, 'SKILL.md')); };
    const { outs, steps } = child([
        { at: '.' },
        { at: 'api', before: joinApi },
        { at: 'web', before: joinTo('web') },
        { at: 'web', act: 'update', args: ['--print-plan'], before: (ws, work) => assert.ok(wsLib.applyRole(path.join(ws, 'web'), 'leave:standalone', { env: { CLAUDE_CONFIG_DIR: path.join(work, 'acct') } }).ok),
            after: (ws) => ({ js: inOwn(path.join(ws, 'web'), 'javascript'), own: ownStore(path.join(ws, 'web'), 'skills') }) },
        { at: '.', act: 'uninstall', after: (ws) => ({ js: inOwn(path.join(ws, 'api'), 'javascript'), root: fs.existsSync(store(ws, 'skills', 'javascript')) }) },
        { at: 'api', act: 'update', args: ['--print-plan'] },
    ], { prepare: (ws) => gitInit(path.join(ws, 'web')) });
    assert.ok(steps[3].js, outs[3]);
    assert.ok(steps[3].own.includes('javascript'));
    assert.match(planSkills(outs[3]), /\bjavascript\b/);
    assert.ok(steps[4].js, outs[4]);
    assert.strictEqual(steps[4].root, false, 'the root\'s store item went with its uninstall');
    assert.match(planSkills(outs[5]), /\bjavascript\b/, outs[5]);
});

test('child: its own uninstall leaves no stack skill in its .claude or its store, and the root\'s store as it was', POSIX_ONLY, () =>
{
    const { outs, steps } = child([
        { at: '.' },
        { at: 'api', sel: ROOT_TWO, before: joinApi },
        { at: 'api', act: 'uninstall', after: (ws) => ({ claude: (() => { try { return fs.readdirSync(claude(path.join(ws, 'api'), 'skills')); } catch { return []; } })(), own: ownStore(path.join(ws, 'api'), 'skills'), root: ownStore(ws, 'skills') }) },
    ]);
    assert.deepStrictEqual(steps[2].claude, [], outs[2]);
    assert.deepStrictEqual(steps[2].own, []);
    assert.ok(steps[2].root.includes('javascript') && steps[2].root.includes(OWN_PICK), 'the root still holds its items and the member\'s pick until its own next run');
});

test('child: an add the root\'s own stamp write overwrote is recorded again at the root\'s next run, its file kept', POSIX_ONLY, () =>
{
    const { outs, steps } = child([
        { at: '.' },
        { at: 'api', sel: ROOT_TWO, before: joinApi, after: (ws) =>
        {
            // The root's run read its members before the add and wrote its stamp after it: neither line names the add.
            const f = stampOf(ws);
            fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^member-picks:.*\n/m, '').replace(new RegExp(`(^library-skills:.*?),?${OWN_PICK}=[0-9a-f]{64}`, 'm'), '$1'));
        } },
        { at: '.', act: 'update', after: (ws) => ({ text: fs.readFileSync(stampOf(ws), 'utf8'), item: fs.existsSync(store(ws, 'skills', OWN_PICK, 'SKILL.md')) }) },
    ]);
    assert.ok(steps[2].item, outs[2]);
    assert.strictEqual(lineOf(steps[2].text, 'member-picks'), `skill/${OWN_PICK}`);
    assert.match(lineOf(steps[2].text, 'library-skills'), new RegExp(`(^|,)${OWN_PICK}=`));
});

test('addToStore: two adds of one item at once leave it once in the store and once on member-picks', POSIX_ONLY, async () =>
{
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'add-two-')));
    try
    {
        fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
        fs.writeFileSync(stampOf(root), 'picked-skills: \nlibrary-skills: \n');
        const script = path.join(root, 'add.js');
        fs.writeFileSync(script, `const ws = require(${JSON.stringify(require.resolve('./install/workspace.js'))});
const fs = require('node:fs'); const path = require('node:path');
const copy = (dir) => { fs.mkdirSync(path.join(dir, 'npm')); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); fs.writeFileSync(path.join(dir, 'npm', 'SKILL.md'), process.argv[3]); };
process.stdout.write(ws.addToStore({ root: process.argv[2], kind: 'skills', name: 'npm', copy }));\n`);
        const run = (tag) => new Promise((done) =>
        {
            const p = require('node:child_process').spawn(process.execPath, [script, root, tag]);
            let out = '';
            p.stdout.on('data', (d) => { out += d; });
            p.on('close', () => done(out));
        });
        assert.deepStrictEqual((await Promise.all([run('a'), run('b')])).sort(), ['added', 'present']);
        assert.deepStrictEqual(fs.readdirSync(store(root, 'skills')), ['npm']);
        assert.strictEqual(lineOf(fs.readFileSync(stampOf(root), 'utf8'), 'member-picks'), 'skill/npm');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('child: on the copy route it links the root\'s agent files and skills, and its own agent pick goes to the root\'s store', POSIX_ONLY, () =>
{
    const SEL = `${KID_SEL}agent evidence-gatherer\n`;
    const { outs, steps } = child([
        { at: '.', sel: SEL, env: COPY },
        { at: 'api', sel: `${SEL}agent wpf-verifier\n`, env: COPY, before: joinApi, after: (ws) =>
        {
            const kid = path.join(ws, 'api');
            const real = (kind, name) => { const st = lstat(claude(kid, kind, name)); return st && st.isSymbolicLink() ? fs.realpathSync.native(claude(kid, kind, name)) : null; };
            return { eg: real('agents', 'evidence-gatherer.md'), wpf: real('agents', 'wpf-verifier.md'), js: real('skills', 'javascript'), kidStore: ownStore(kid, 'agents'), root: fs.readFileSync(stampOf(ws), 'utf8') };
        } },
        { at: 'api', act: 'update', env: COPY },
    ]);
    const got = steps[1];
    const inRoot = (p) => Boolean(p) && !p.includes(`${path.sep}api${path.sep}`) && p.includes(path.join('.alfred', 'stack'));
    assert.ok(inRoot(got.eg) && inRoot(got.wpf) && inRoot(got.js), outs[1]);
    assert.deepStrictEqual(got.kidStore, []);
    assert.match(lineOf(got.root, 'member-picks'), /^agent\/wpf-verifier,skill\/csharp(,|$)/, 'the seat and the skills it requires');
    assert.match(lineOf(got.root, 'managed-files'), /(^|,)agents\/wpf-verifier\.md=/);
    assert.match(outs[2], /workspace: from \.\. - 0 added, 0 dropped/);
});

// Workspace stage 4c: the library rules live in .alfred/stack/rules, where the rule loader sends them from.
const ALWAYS_RULES = ['alfred-interaction', 'alfred-preferences', 'alfred-docs-root', 'alfred-security', 'alfred-quality-gates', 'alfred-navigation', 'markdown-docs'];
const RULE_SEL = `${SELECTION}${ALWAYS_RULES.map((r) => `rule ${r}\n`).join('')}`;
const sourceRule = (name) => fs.readFileSync(path.join(__dirname, '..', 'stack', 'rules', `${name}.md`), 'utf8');
const ruleNames = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)) : []);
const ruleTree = (repo) => Object.fromEntries([...ruleNames(store(repo, 'rules')).map((n) => [`st/${n}`, hashItem(store(repo, 'rules', `${n}.md`))]),
    ...ruleNames(claude(repo, 'rules')).map((n) => [`cl/${n}`, hashItem(claude(repo, 'rules', `${n}.md`))])]);
// The old shape: every stamped rule back in .claude/rules, as an install before this stage left it.
const unmove = (repo) => { fs.mkdirSync(claude(repo, 'rules'), { recursive: true }); for (const n of ruleNames(store(repo, 'rules'))) fs.renameSync(store(repo, 'rules', `${n}.md`), claude(repo, 'rules', `${n}.md`)); };

test('rules: a fresh install writes every library rule to .alfred/stack/rules and none to .claude/rules; a second run changes nothing', () =>
{
    const { result, steps } = seedRun(['install', 'update', 'update'], RULE_SEL, {
        each: (repo) => ({ tree: ruleTree(repo), stamp: bare(fs.readFileSync(stampOf(repo), 'utf8')) }),
        inspect: (repo) => ({ inStore: ruleNames(store(repo, 'rules')), native: ruleNames(claude(repo, 'rules')), lib: stamp.readLibrary(stampOf(repo)),
            root: fs.readFileSync(store(repo, 'rules', 'alfred-docs-root.md'), 'utf8'), rootHash: hashItem(store(repo, 'rules', 'alfred-docs-root.md')),
            always: lineOf(fs.readFileSync(stampOf(repo), 'utf8'), 'installed-always-rules') }),
    });
    for (const n of ALWAYS_RULES) assert.ok(result.inStore.includes(n), `${n} in the store: ${result.inStore}`);
    assert.deepStrictEqual(result.native.filter((n) => Object.hasOwn(result.lib.rules, n)), [], 'no stack rule in .claude/rules');
    assert.match(result.root, /This install's root: `[^`_]+`/);
    assert.strictEqual(result.lib.rules['alfred-docs-root'], result.rootHash, 'the stamp records the stamped docs-root rule');
    for (const n of ALWAYS_RULES.slice(0, 6)) assert.ok(result.always.split(',').includes(n), `installed-always-rules lists ${n}: ${result.always}`);
    assert.deepStrictEqual(steps[2], steps[1], 'a second update changes no rule file and no stamp line');
});

test('rules: an update moves the stamped rules, re-copies an edited one as today, and leaves a generated and the user\'s own rule', () =>
{
    const mine = 'my own rule\n';
    const { outs, result } = seedRun(['install', 'update'], RULE_SEL, {
        each: (repo, i) =>
        {
            if (i !== 0) return null;
            unmove(repo);
            fs.appendFileSync(claude(repo, 'rules', 'alfred-security.md'), '\nmy edit\n');
            for (const n of ['mine', 'alfred-awareness']) fs.writeFileSync(claude(repo, 'rules', `${n}.md`), mine);
            return null;
        },
        inspect: (repo) => ({ inStore: ruleNames(store(repo, 'rules')), native: ruleNames(claude(repo, 'rules')),
            interaction: fs.readFileSync(store(repo, 'rules', 'alfred-interaction.md'), 'utf8'),
            kept: ['mine', 'alfred-awareness'].map((n) => fs.readFileSync(claude(repo, 'rules', `${n}.md`), 'utf8')) }),
    });
    assert.match(outs[1], /rule moved to the store: alfred-interaction$/m);
    assert.match(outs[1], /overwriting a hand-edited copy: rule alfred-security$/m, 'the edited copy is refreshed as an update does today');
    assert.strictEqual(result.interaction, sourceRule('alfred-interaction'));
    for (const n of ALWAYS_RULES) assert.ok(result.inStore.includes(n), n);
    assert.deepStrictEqual(result.native.sort(), ['alfred-awareness', 'alfred-rules', 'mine'], 'the canary is native too');
    assert.deepStrictEqual(result.kept, [mine, mine]);
});

test('rules: a failed move leaves every rule native this run, the docs-root rule stamped at the hash the stamp records', () =>
{
    const { outs, result } = seedRun(['install', 'update'], RULE_SEL, {
        each: (repo, i) => { if (i === 0) { unmove(repo); fs.rmdirSync(store(repo, 'rules')); fs.writeFileSync(store(repo, 'rules'), 'a file'); } return null; },
        inspect: (repo) => ({ native: ruleNames(claude(repo, 'rules')), lib: stamp.readLibrary(stampOf(repo)),
            root: fs.readFileSync(claude(repo, 'rules', 'alfred-docs-root.md'), 'utf8'), rootHash: hashItem(claude(repo, 'rules', 'alfred-docs-root.md')) }),
    });
    assert.match(outs[1], / {2}!! rules stay in \.claude this run/);
    for (const n of ALWAYS_RULES) assert.ok(result.native.includes(n), n);
    assert.match(result.root, /This install's root: `[^`_]+`/);
    assert.strictEqual(result.lib.rules['alfred-docs-root'], result.rootHash);
});

test('rules: a fresh install whose store rules path is a file writes the rules to .claude/rules and says so', () =>
{
    const { out, result } = seedRun('install', RULE_SEL, {
        prepare: (repo) => { fs.mkdirSync(path.join(repo, '.alfred', 'stack'), { recursive: true }); fs.writeFileSync(store(repo, 'rules'), 'a file'); },
        inspect: (repo) => ({ native: ruleNames(claude(repo, 'rules')), root: fs.readFileSync(claude(repo, 'rules', 'alfred-docs-root.md'), 'utf8') }),
    });
    assert.match(out, / {2}!! rules stay in \.claude this run/);
    for (const n of ALWAYS_RULES) assert.ok(result.native.includes(n), n);
    assert.match(result.root, /This install's root: `[^`_]+`/);
});

test('rules: a rule held in both folders - the .claude copy at its stamped hash goes, an edited one stays and is named', () =>
{
    const { outs, result } = seedRun(['install', 'update'], RULE_SEL, {
        each: (repo, i) =>
        {
            if (i !== 0) return null;
            fs.mkdirSync(claude(repo, 'rules'), { recursive: true });
            for (const n of ['alfred-interaction', 'alfred-security']) fs.copyFileSync(store(repo, 'rules', `${n}.md`), claude(repo, 'rules', `${n}.md`));
            fs.appendFileSync(claude(repo, 'rules', 'alfred-security.md'), '\nmy edit\n');
            return null;
        },
        inspect: (repo) => ({ native: ruleNames(claude(repo, 'rules')), store: fs.readFileSync(store(repo, 'rules', 'alfred-interaction.md'), 'utf8'),
            edited: fs.readFileSync(claude(repo, 'rules', 'alfred-security.md'), 'utf8') }),
    });
    assert.deepStrictEqual(result.native, ['alfred-rules', 'alfred-security']);
    assert.strictEqual(result.store, sourceRule('alfred-interaction'));
    assert.match(result.edited, /my edit/);
    assert.match(outs[1], /rule alfred-security is held in \.claude\/rules too: yours is kept and loads first/);
});

test('rules: an uninstall takes the store rules at their hash, keeps an edited one, and takes the old shape too', () =>
{
    for (const old of [false, true])
    {
        const { result } = seedRun(['install', 'uninstall'], RULE_SEL, {
            each: (repo, i) =>
            {
                if (i !== 0) return null;
                if (old) unmove(repo);
                fs.appendFileSync(old ? claude(repo, 'rules', 'alfred-security.md') : store(repo, 'rules', 'alfred-security.md'), '\nmy edit\n');
                return null;
            },
            inspect: (repo) => ({ inStore: ruleNames(store(repo, 'rules')), native: ruleNames(claude(repo, 'rules')) }),
        });
        assert.deepStrictEqual(old ? result.native : result.inStore, ['alfred-security'], `old shape ${old}`);
        assert.deepStrictEqual(old ? result.inStore : result.native, [], `old shape ${old}`);
    }
});

test('rules: the read-back lists the rules found in the store', () =>
{
    const { outs } = seedRun(['install', 'update'], RULE_SEL, { args: [[], ['--installed-only', '--print-plan']] });
    const plan = (/^plan rules: (.*)$/m.exec(outs[1]) || [])[1] || '';
    for (const n of ALWAYS_RULES) assert.ok(plan.split(' ').includes(n), `${n} read back: ${plan}`);
});

test('copy: ruleAt names the store file when it exists, else the .claude/rules one', () =>
{
    const { ruleAt } = require('./install/copy.js');
    const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'rule-at-'));
    try
    {
        assert.strictEqual(ruleAt(root, 'a'), path.join(root, '.claude', 'rules', 'a.md'));
        fs.mkdirSync(store(root, 'rules'), { recursive: true });
        fs.writeFileSync(store(root, 'rules', 'a.md'), 'a');
        assert.strictEqual(ruleAt(root, 'a.md'), store(root, 'rules', 'a.md'));
        assert.strictEqual(ruleAt(root, 'b'), path.join(root, '.claude', 'rules', 'b.md'));
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// Workspace stage 4c: a joined child holds no copy of a rule its parent holds; its own rule pick goes to the root's store.
const RULE_PICK = 'csharp-conventions';
const kidRules = (ws) => ({ kidStore: ruleNames(store(path.join(ws, 'api'), 'rules')).sort(), kidNative: ruleNames(claude(path.join(ws, 'api'), 'rules')).sort(),
    rootStore: ruleNames(store(ws, 'rules')).sort(), root: fs.readFileSync(stampOf(ws), 'utf8'), rootCanary: fs.existsSync(claude(ws, 'rules', 'alfred-rules.md')) });
const trackRules = (ws) =>
{
    gitInit(ws);
    fs.writeFileSync(path.join(ws, '.gitignore'), '.claude/*\n!.claude/rules/\n.alfred/\napi/\n');
    fs.mkdirSync(claude(ws, 'rules'), { recursive: true });
    fs.writeFileSync(claude(ws, 'rules', 'team.md'), '# the team rule\n');
    require('./install/runtime.js').execCommand('git', ['-C', ws, 'add', '-f', '.gitignore', '.claude/rules/team.md']);
    assert.strictEqual(require('./install/links.js').gitState(claude(ws, 'rules')), 'visible', 'the fixture puts .claude/rules in git\'s view');
};

test('child: a joined child copies no rule its parent holds', POSIX_ONLY, () =>
{
    const { outs, steps } = child([{ at: '.' }, { at: 'api', before: joinApi, after: kidRules }]);
    const got = steps[1];
    assert.ok(got.rootStore.includes('alfred-security') && got.rootStore.includes('alfred-docs-root'), outs[0]);
    assert.deepStrictEqual(got.kidStore, [], outs[1]);
    assert.deepStrictEqual(got.kidNative.filter((n) => got.rootStore.includes(n)), [], outs[1]);
    assert.ok(!got.kidNative.includes('alfred-rules'), 'canary: not written below a stamped root - the root\'s reaches it');
    assert.ok(got.rootCanary, 'the root keeps its canary');
});

for (const tracked of [false, true])
{
    test(`child: a library rule only the child picked goes into the ROOT's store${tracked ? ', the root\'s .claude/rules tracked by git' : ''}`, POSIX_ONLY, () =>
    {
        const { outs, steps } = child([
            { at: '.' },
            { at: 'api', sel: `${KID_SEL}rule ${RULE_PICK}\n`, before: (ws, work) => { if (tracked) trackRules(ws); joinApi(ws, work); }, after: kidRules },
            { at: '.', act: 'update', after: kidRules },
        ]);
        const got = steps[1];
        assert.ok(got.rootStore.includes(RULE_PICK), outs[1]);
        assert.ok(!got.kidStore.includes(RULE_PICK) && !got.kidNative.includes(RULE_PICK), outs[1]);
        assert.match(lineOf(got.root, 'member-picks'), new RegExp(`(^|,)rule/${RULE_PICK}(,|$)`));
        assert.match(lineOf(got.root, 'library-rules'), new RegExp(`(^|,)${RULE_PICK}=`));
        assert.ok(steps[2].rootStore.includes(RULE_PICK), `the root's next run keeps the member's rule: ${outs[2]}`);
        assert.strictEqual(lineOf(steps[2].root, 'member-picks'), lineOf(got.root, 'member-picks'));
    });
}

test('child: a locked root leaves the child\'s own rule pick in the child\'s store this run', POSIX_ONLY, () =>
{
    const { outs, steps } = child([
        { at: '.' },
        { at: 'api', sel: `${KID_SEL}rule ${RULE_PICK}\n`, before: (ws, work) => { joinApi(ws, work); fs.writeFileSync(path.join(ws, '.alfred', 'workspace.lock'), String(process.pid)); },
            after: (ws) => { fs.rmSync(path.join(ws, '.alfred', 'workspace.lock'), { force: true }); return kidRules(ws); } },
    ]);
    assert.match(outs[1], new RegExp(`!! store: \\.\\. is locked - rules/${RULE_PICK} is added at the next run`));
    assert.ok(steps[1].kidStore.includes(RULE_PICK), outs[1]);
    assert.ok(!steps[1].rootStore.includes(RULE_PICK));
});

test('child: an inherited rule copy at its stamped hash is dropped at the update; an edited one moves into the child\'s own store', POSIX_ONLY, () =>
{
    const { outs, steps } = child([
        { at: '.' },
        { at: 'api', before: joinApi },
        { at: 'api', act: 'update', before: (ws) =>
        {
            // The child laid in the old shape: two inherited copies in .claude/rules, recorded, one edited since.
            const kid = path.join(ws, 'api');
            fs.mkdirSync(claude(kid, 'rules'), { recursive: true });
            const add = ['alfred-security', 'alfred-interaction'].map((n) => { fs.copyFileSync(store(ws, 'rules', `${n}.md`), claude(kid, 'rules', `${n}.md`)); return `${n}=${hashItem(claude(kid, 'rules', `${n}.md`))}`; });
            const text = fs.readFileSync(stampOf(kid), 'utf8');
            fs.writeFileSync(stampOf(kid), /^library-rules:/m.test(text) ? text.replace(/^library-rules: ?(.*)$/m, (l, v) => `library-rules: ${[v, ...add].filter(Boolean).join(',')}`) : `${text}library-rules: ${add.join(',')}\n`);
            fs.appendFileSync(claude(kid, 'rules', 'alfred-interaction.md'), '\nedited here\n');
        }, after: (ws) => ({ ...kidRules(ws), text: fs.readFileSync(store(path.join(ws, 'api'), 'rules', 'alfred-interaction.md'), 'utf8'), rootText: fs.readFileSync(store(ws, 'rules', 'alfred-interaction.md'), 'utf8') }) },
    ]);
    const got = steps[2];
    assert.deepStrictEqual(got.kidStore, ['alfred-interaction'], outs[2]);
    assert.ok(!got.kidNative.includes('alfred-security') && !got.kidNative.includes('alfred-interaction'), outs[2]);
    assert.ok(got.text.includes('edited here') && !got.rootText.includes('edited here'));
    assert.match(outs[2], /kept: alfred-interaction\.md - .*edited here since/, outs[2]);
});

test('child: the two rendered rules stay the child\'s own when its docs root differs from the root\'s', POSIX_ONLY, () =>
{
    const { outs, steps } = child([
        { at: '.' },
        { at: 'api', before: (ws, work) =>
        {
            joinApi(ws, work);
            const f = store(ws, 'rules', 'alfred-docs-root.md');
            fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/This install's root: `[^`]*`/, 'This install\'s root: `elsewhere/docs`'));
        }, after: (ws) => ({ ...kidRules(ws), text: fs.readFileSync(store(path.join(ws, 'api'), 'rules', 'alfred-docs-root.md'), 'utf8') }) },
    ]);
    assert.deepStrictEqual(steps[1].kidStore, ['alfred-docs-root', 'alfred-preferences'], outs[1]);
    assert.ok(!steps[1].text.includes('elsewhere/docs') && /This install's root: `[^`_]+`/.test(steps[1].text), steps[1].text);
});

test('canary: written beside a fresh install as a files row of the ledger, never a rules entry, and the move does not take it', () =>
{
    const { steps } = seedRun(['install', 'update'], RULE_SEL, {
        each: (repo) => ({ text: fs.readFileSync(claude(repo, 'rules', 'alfred-rules.md'), 'utf8'), hash: hashItem(claude(repo, 'rules', 'alfred-rules.md')),
            row: (stamp.readLedger(stampOf(repo)).files || {})['rules/alfred-rules.md'], lib: Object.keys(stamp.readLibrary(stampOf(repo)).rules), inStore: ruleNames(store(repo, 'rules')) }),
    });
    for (const got of steps)
    {
        assert.strictEqual(got.text, fs.readFileSync(path.join(__dirname, '..', 'stack', 'alfred-rules.canary.md'), 'utf8'));
        assert.strictEqual(got.row, got.hash, 'its ledger row holds its hash');
        assert.ok(!got.lib.includes('alfred-rules') && !got.inStore.includes('alfred-rules'), 'never a library rule, never moved');
    }
});

test('canary: not written on a run whose rules stayed in .claude, and an untouched one from an earlier run is removed', () =>
{
    const { result } = seedRun(['install', 'update'], RULE_SEL, {
        each: (repo, i) => { if (i === 0) { unmove(repo); fs.rmdirSync(store(repo, 'rules')); fs.writeFileSync(store(repo, 'rules'), 'a file'); } return null; },
        inspect: (repo) => ({ canary: fs.existsSync(claude(repo, 'rules', 'alfred-rules.md')), row: (stamp.readLedger(stampOf(repo)).files || {})['rules/alfred-rules.md'] }),
    });
    assert.deepStrictEqual(result, { canary: false, row: undefined });
});
