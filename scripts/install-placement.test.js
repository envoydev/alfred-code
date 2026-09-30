'use strict';
// 2.1.0 - EVERY SKILL A PROJECT COPY, EVERY SEAT ON THE CORE, end to end through the Node seed.
//
// The flip moves two things at once: the always skills leave the core for `.claude/skills`, and the
// stack seats leave `.claude/agents` for the core, each one the project did not pick denied as
// `Agent(alfred-code:<seat>)`. The unit tests hold each layer; these hold the seed to the migration a
// real 2.0.0 install takes on its first update (the BLOCKER: read as 'every seat the core carries minus
// the denied', all 44 seats came back picked and the always skills were carried by nothing), to a
// re-run that changes nothing, and to the two routes a seat can move between.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const { formerCore } = require('./plugin-placement.js');
const { hashItem } = require('./install/library.js');

const ROOT = path.join(__dirname, '..');
const GRAPH = require('../meta/stack-graph.json');
const SEATS = Object.keys(GRAPH.agents).sort();
const LISTING = JSON.stringify(['alfred-code', 'navigation', 'documentation', 'memory']
    .map((n) => ({ id: `${n}@envoydev`, version: '2.0.0', scope: 'project', enabled: true })));

function copyIn(repo, rel, src)
{
    const dest = path.join(repo, '.claude', rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
}

function read(repo)
{
    const claude = path.join(repo, '.claude');
    const stamp = fs.readFileSync(path.join(claude, 'alfred-code.stamp'), 'utf8');
    const line = (key) => ((new RegExp(`^${key}: (.*)$`, 'm').exec(stamp) || [])[1] || '').split(',').filter(Boolean);
    const list = (dir) => { try { return fs.readdirSync(path.join(claude, dir)).sort(); } catch { return []; } };
    const settings = JSON.parse(fs.readFileSync(path.join(claude, 'settings.json'), 'utf8'));
    return {
        stamp: stamp.replace(/^installed: .*$/m, 'installed: <time>').replace(/^installed-ms: .*$/m, 'installed-ms: <time>'),
        seatsRoute: (/^seats-route: (.*)$/m.exec(stamp) || [])[1] || null,
        pickedSkills: line('picked-skills'), pickedAgents: line('picked-agents'), libraryAgents: line('library-agents'),
        skills: list('skills'), agents: list('agents'), settings,
        seatDeny: ((settings.permissions || {}).deny || []).filter((d) => d.startsWith('Agent(')).sort(),
    };
}

// A 2.0.0 plugin-route install, as that release wrote it: the always closure rode the core, so its stamp
// homes those skills `@alfred-code`; the aspnet seats it picked were library copies; the one always seat
// the user switched off is denied, and the ledger records that deny as the stack's.
function v200(repo)
{
    const former = formerCore();
    copyIn(repo, 'skills/csharp', path.join(ROOT, 'stack', 'skills', 'csharp'));
    copyIn(repo, 'agents/aspnet-implementer.md', path.join(ROOT, 'stack', 'agents', 'aspnet-implementer.md'));
    copyIn(repo, 'agents/aspnet-verifier.md', path.join(ROOT, 'stack', 'agents', 'aspnet-verifier.md'));
    copyIn(repo, 'rules/alfred-interaction.md', path.join(ROOT, 'stack', 'rules', 'alfred-interaction.md'));
    const src = (rel) => hashItem(path.join(ROOT, 'stack', rel));
    // The user tuned one library seat by hand since: it is theirs now.
    const verifier = path.join(repo, '.claude', 'agents', 'aspnet-verifier.md');
    fs.writeFileSync(verifier, fs.readFileSync(verifier, 'utf8').replace(/^effort: .*$/m, 'effort: max'));
    const picked = former.agents.filter((a) => a !== 'code-style-analyzer');
    fs.writeFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), [
        'version: 2.0.0', 'sha: e3af2408', 'scope: project', 'hooks-route: plugin',
        `picked-skills: ${[...former.skills.map((s) => `${s}@alfred-code`), 'csharp'].join(',')}`,
        `picked-agents: ${[...picked.map((a) => `${a}@alfred-code`), 'aspnet-implementer', 'aspnet-verifier'].join(',')}`,
        `library-skills: csharp=${src('skills/csharp')}`,
        `library-agents: aspnet-implementer=${src('agents/aspnet-implementer.md')},aspnet-verifier=${src('agents/aspnet-verifier.md')}`,
        'library-rules: ',
        'managed-deny: settings.json:Agent(alfred-code:code-style-analyzer)', '',
    ].join('\n'));
    fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), `${JSON.stringify({
        env: { MY_OWN_KEY: 'mine' }, permissions: { deny: ['Agent(alfred-code:code-style-analyzer)', 'Bash(rm -rf:*)'] },
    }, null, 2)}\n`);
}

test('update over a 2.0.0 install (the 2.1.0 BLOCKER): picks kept, always skills copied, seat copies pruned, every unpicked seat denied - and a re-run changes nothing', POSIX_ONLY, () =>
{
    const former = formerCore();
    const { steps, outs } = seedRun(['update', 'update'], '', { plugins: LISTING, args: ['--installed-only'], prepare: v200, each: read });
    const [first, second] = steps;
    for (const s of [...former.skills, 'csharp']) assert.ok(first.skills.includes(s), `${s} is a copy now:\n${outs[0]}`);
    assert.ok(!first.agents.includes('aspnet-implementer.md'), 'the library seat copy is pruned - the core carries the seat');
    assert.ok(first.agents.includes('aspnet-verifier.md'), 'the seat copy edited by hand is kept');
    assert.match(outs[0], /agent kept: aspnet-verifier\.md - edited in the project/);
    const want = SEATS.filter((a) => !['aspnet-implementer', 'aspnet-verifier'].includes(a) && !(former.agents.includes(a) && a !== 'code-style-analyzer'));
    assert.deepStrictEqual(first.seatDeny, want.map((a) => `Agent(alfred-code:${a})`).sort(), 'a deny per seat 2.0.0 never ran, and the one the user switched off');
    assert.ok(first.settings.permissions.deny.includes('Bash(rm -rf:*)') && first.settings.env.MY_OWN_KEY === 'mine', 'the user\'s own entries stay');
    assert.strictEqual(first.seatsRoute, 'plugin');
    assert.ok(first.pickedAgents.includes('aspnet-implementer@alfred-code') && first.pickedAgents.includes('security-auditor@alfred-code'), first.pickedAgents.join(','));
    assert.ok(!first.pickedAgents.some((e) => /code-style-analyzer|web-angular/.test(e)), first.pickedAgents.join(','));
    assert.ok(first.pickedSkills.includes('csharp') && first.pickedSkills.includes('alfred-habits-done-gate') && !first.pickedSkills.some((e) => e.includes('@')), first.pickedSkills.join(','));
    assert.ok(first.libraryAgents.some((e) => e.startsWith('aspnet-verifier=')), 'the kept copy keeps its recorded hash, so it reads as edited');
    assert.deepStrictEqual([second.stamp.replace(/^sha: .*$/m, ''), second.settings, second.skills, second.agents],
        [first.stamp.replace(/^sha: .*$/m, ''), first.settings, first.skills, first.agents], 'the re-run changes nothing');
});

test('a fresh install then its update: the seat state holds, and an --add of a rule takes the denied seats it requires', POSIX_ONLY, () =>
{
    const { computeClosure } = require('./stack-select.js');
    // A walk's selection: the always skills and rules, and no seat at all.
    const always = require('../meta/recommendations.json').always;
    const closed = computeClosure(GRAPH, { skills: always.skills, rules: always.rules });
    const selection = [...closed.skills.map((x) => `skill ${x}`), ...closed.rules.map((x) => `rule ${x}`)].join('\n') + '\n';
    const { steps } = seedRun(['install', 'update', 'update'], selection, {
        plugins: LISTING, args: [[], ['--installed-only'], ['--installed-only', '--add', 'rule dotnet-repair-agents']], each: read,
    });
    const [fresh, again, added] = steps;
    assert.deepStrictEqual(fresh.seatDeny, SEATS.map((a) => `Agent(alfred-code:${a})`), 'nothing picked: every seat denied');
    assert.deepStrictEqual([again.seatDeny, again.pickedAgents, again.skills], [fresh.seatDeny, fresh.pickedAgents, fresh.skills], 'the update writes the state back as it found it');
    const resolvers = computeClosure(GRAPH, { rules: ['dotnet-repair-agents'] });
    for (const a of resolvers.agents) assert.ok(!added.seatDeny.includes(`Agent(alfred-code:${a})`), `${a} is required by the rule added - allowed`);
    for (const s of resolvers.skills) assert.ok(added.skills.includes(s), `${s} - a preload of the seat taken - is copied`);
    assert.ok(added.seatDeny.includes('Agent(alfred-code:web-angular-implementer)'), 'every other seat stays denied');
});

test('a switch to the skills copy route copies the seats the core carried, and back again prunes them - the picks hold both ways', POSIX_ONLY, () =>
{
    const COPY = { ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' };
    const { steps } = seedRun(['install', 'update', 'update'], 'skill markdown-style\nrule markdown-docs\nagent aspnet-implementer\n', {
        plugins: LISTING, env: [{}, COPY, {}], args: [[], ['--installed-only'], ['--installed-only']], each: read,
    });
    const [plugin, copied, back] = steps;
    assert.deepStrictEqual([plugin.agents, plugin.seatsRoute], [[], 'plugin']);
    assert.deepStrictEqual([copied.agents, copied.seatsRoute], [['aspnet-implementer.md'], 'copy'], 'the seat picked on the plugin route is copied');
    assert.deepStrictEqual(copied.seatDeny, plugin.seatDeny, 'the core still loads beside the copies - the unpicked seats stay denied');
    assert.deepStrictEqual([back.agents, back.seatsRoute, back.seatDeny], [[], 'plugin', plugin.seatDeny], 'and back: the copy goes, the seat stays picked');
    assert.ok(back.pickedAgents.includes('aspnet-implementer@alfred-code'), back.pickedAgents.join(','));
});

// I4: 2.0.0's --keep-pins re-hashed a seat copy after restoring its tuned pins, so the stamp's hash IS the tuned
// file's and the copy reads as unedited - the migration pruned it and the seat ran the core's pins. A copy whose
// model / effort differ from the stack's is the user's tuning: kept, said, with how it is dispatched. M6: the
// roster a 2.0.0 run generated names library seats bare, which the core answers only as alfred-code:<seat> - it is
// re-spelled, except for a seat whose project copy is kept (the bare name reaches that copy).
function v200Tuned(repo)
{
    v200(repo);
    copyIn(repo, 'agents/aspnet-solution-designer.md', path.join(ROOT, 'stack', 'agents', 'aspnet-solution-designer.md'));
    const tuned = path.join(repo, '.claude', 'agents', 'aspnet-implementer.md');
    fs.writeFileSync(tuned, fs.readFileSync(tuned, 'utf8').replace(/^model: .*$/m, 'model: opus').replace(/^effort: .*$/m, 'effort: high'));
    const stampFile = path.join(repo, '.claude', 'alfred-code.stamp');
    const stamp = fs.readFileSync(stampFile, 'utf8')
        .replace(/aspnet-implementer=[0-9a-f]+/, `aspnet-implementer=${hashItem(tuned)}`)
        .replace(/^(library-agents: .*)$/m, `$1,aspnet-solution-designer=${hashItem(path.join(ROOT, 'stack', 'agents', 'aspnet-solution-designer.md'))}`)
        .replace(/^(picked-agents: .*)$/m, '$1,aspnet-solution-designer');
    fs.writeFileSync(stampFile, stamp);
    fs.writeFileSync(path.join(repo, '.claude', 'rules', 'alfred-project-agent-capabilities.md'), [
        '---', 'description: Project capabilities awareness - generated by /alfred-capture-agent-capabilities; edit via a re-run, not by hand.', '---', '',
        '# This project\'s capabilities', '', '## Subagent seats',
        'aspnet-implementer, aspnet-solution-designer, aspnet-verifier, alfred-code:security-auditor, my-own-seat', '',
        '## MCP routing', '- `navigation` - dispatch aspnet-solution-designer never; prose here is left alone.', '',
    ].join('\n'));
}

test('I4 update over a 2.0.0 install with a tuned seat copy: the pins are kept, the copy reachable by its bare name, and the roster re-spelled (M6)', POSIX_ONLY, () =>
{
    const { steps, outs } = seedRun(['update', 'update'], '', {
        plugins: LISTING, args: ['--installed-only', '--keep-pins'], prepare: v200Tuned,
        each: (repo) => ({ ...read(repo), roster: fs.readFileSync(path.join(repo, '.claude', 'rules', 'alfred-project-agent-capabilities.md'), 'utf8'),
            implementer: (() => { try { return fs.readFileSync(path.join(repo, '.claude', 'agents', 'aspnet-implementer.md'), 'utf8'); } catch { return ''; } })() }),
    });
    const [first, second] = steps;
    assert.match(first.implementer, /^model: opus$/m, `the tuned copy is kept:\n${outs[0]}`);
    assert.match(first.implementer, /^effort: high$/m);
    assert.match(outs[0], /agent kept: aspnet-implementer\.md - its model\/effort \(model=opus, effort=high\) differ from the stack's \(model=sonnet, effort=medium\)/, outs[0]);
    assert.match(outs[0], /dispatched as 'aspnet-implementer'/, outs[0]);
    assert.ok(!first.agents.includes('aspnet-solution-designer.md'), 'an untouched library copy is still pruned');
    const seats = (/## Subagent seats\n(.*)\n/.exec(first.roster) || [])[1];
    assert.strictEqual(seats, 'aspnet-implementer, alfred-code:aspnet-solution-designer, aspnet-verifier, alfred-code:security-auditor, my-own-seat', first.roster);
    assert.match(first.roster, /dispatch aspnet-solution-designer never; prose here is left alone/, 'only the seats line is re-spelled');
    assert.deepStrictEqual([second.agents, second.roster, second.implementer], [first.agents, first.roster, first.implementer], 'a re-run changes nothing');
});
