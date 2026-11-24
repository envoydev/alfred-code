'use strict';
// EVERY SKILL AND EVERY SEAT A PROJECT COPY, end to end through the Node seed.
//
// 2.1.0 moved the always skills off the core into `.claude/skills`; seats followed (the core carries none, and no
// `Agent(alfred-code:<seat>)` row is written - an unpicked seat has no copy). The unit tests hold each layer; these hold
// the seed to the migration a real 2.0.0 install takes on its first update (the BLOCKER: read as 'every seat the core
// carries minus the denied', all 44 seats came back picked and the always skills were carried by nothing), to a re-run
// that changes nothing, and to the two routes a seat can move between.
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
const LISTING = JSON.stringify(['alfred-code', 'alfred-navigation', 'alfred-documentation', 'alfred-memory']
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
    const file = (name) => { try { return JSON.parse(fs.readFileSync(path.join(claude, name), 'utf8')); } catch { return null; } };
    // Mode v2 stage 2: the stack's seat denies sit in settings.local.json at every scope; settings.json keeps the user's own rows.
    const settings = file('settings.json');
    const local = file('settings.local.json') || {};
    return {
        stamp: stamp.replace(/^installed: .*$/m, 'installed: <time>').replace(/^installed-ms: .*$/m, 'installed-ms: <time>'),
        seatsRoute: (/^seats-route: (.*)$/m.exec(stamp) || [])[1] || null,
        pickedSkills: line('picked-skills'), pickedAgents: line('picked-agents'), libraryAgents: line('library-agents'),
        skills: list('skills'), agents: list('agents'), settings, local,
        seatDeny: ((local.permissions || {}).deny || []).filter((d) => d.startsWith('Agent(')).sort(),
        sharedSeatDeny: (((settings || {}).permissions || {}).deny || []).filter((d) => d.startsWith('Agent(')),
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

test('update over a 2.0.0 install (the 2.1.0 BLOCKER): picks kept, always skills and seats copied, a hand-tuned seat kept, no seat denied - and a re-run changes nothing', POSIX_ONLY, () =>
{
    const former = formerCore();
    const { steps, outs } = seedRun(['update', 'update'], '', { plugins: LISTING, args: ['--installed-only'], prepare: v200, each: read });
    const [first, second] = steps;
    for (const s of [...former.skills, 'csharp']) assert.ok(first.skills.includes(s), `${s} is a copy now:\n${outs[0]}`);
    for (const a of former.agents.filter((x) => x !== 'code-style-analyzer')) assert.ok(first.agents.includes(a), `${a} ran on the core, so it is a copy now:\n${outs[0]}`);
    assert.ok(first.agents.includes('aspnet-implementer') && !first.agents.includes('aspnet-implementer.md'), 'the library seat copy moved into a folder');
    assert.ok(first.agents.includes('aspnet-verifier.md'), 'the seat copy edited by hand is kept where it was');
    assert.match(outs[0], /agent kept: \.claude\/agents\/aspnet-verifier\.md - edited since it was copied/);
    assert.ok(!first.agents.includes('code-style-analyzer'), 'the always seat the user switched off is not copied');
    assert.deepStrictEqual(first.seatDeny, [], 'no seat is denied - the row 2.0.0 wrote for the switched off seat is gone');
    assert.deepStrictEqual(first.sharedSeatDeny, [], 'and settings.json holds none');
    assert.ok(first.settings.permissions.deny.includes('Bash(rm -rf:*)') && first.settings.env.MY_OWN_KEY === 'mine', 'the user\'s own entries stay');
    assert.strictEqual(first.seatsRoute, 'library');
    assert.ok(first.pickedAgents.includes('aspnet-implementer') && first.pickedAgents.includes('security-auditor'), first.pickedAgents.join(','));
    assert.ok(!first.pickedAgents.some((e) => /code-style-analyzer|web-angular|@/.test(e)), first.pickedAgents.join(','));
    assert.ok(first.pickedSkills.includes('csharp') && first.pickedSkills.includes('habits-done-gate') && !first.pickedSkills.some((e) => e.includes('@')), first.pickedSkills.join(','));
    assert.ok(first.libraryAgents.some((e) => e.startsWith('aspnet-verifier=')), 'the kept copy keeps its recorded hash, so it reads as edited');
    assert.deepStrictEqual([second.stamp.replace(/^sha: .*$/m, ''), second.settings, second.local, second.skills, second.agents],
        [first.stamp.replace(/^sha: .*$/m, ''), first.settings, first.local, first.skills, first.agents], 'the re-run changes nothing');
});

test('a fresh install then its update: no seat is denied, and an --add of a rule copies the seats it requires', POSIX_ONLY, () =>
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
    assert.deepStrictEqual([fresh.seatDeny, fresh.agents], [[], []], 'nothing picked: no seat copied, no row written');
    assert.deepStrictEqual([again.seatDeny, again.pickedAgents, again.skills, again.agents], [fresh.seatDeny, fresh.pickedAgents, fresh.skills, fresh.agents], 'the update writes the state back as it found it');
    const resolvers = computeClosure(GRAPH, { rules: ['dotnet-repair-agents'] });
    for (const a of resolvers.agents) assert.ok(added.agents.includes(a), `${a} is required by the rule added - copied`);
    for (const s of resolvers.skills) assert.ok(added.skills.includes(s), `${s} - a preload of the seat taken - is copied`);
    assert.ok(!added.agents.includes('web-angular-implementer'), 'every other seat stays absent');
    assert.deepStrictEqual(added.seatDeny, [], 'and no row is written for any');
});

test('a switch to the skills copy route keeps the seat copied, and back again changes none - the picks hold both ways', POSIX_ONLY, () =>
{
    const COPY = { ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' };
    const { steps } = seedRun(['install', 'update', 'update'], 'skill markdown-style\nrule markdown-docs\nagent aspnet-implementer\n', {
        plugins: LISTING, env: [{}, COPY, {}], args: [[], ['--installed-only'], ['--installed-only']], each: read,
    });
    const [plugin, copied, back] = steps;
    assert.deepStrictEqual([plugin.agents, plugin.seatsRoute], [['aspnet-implementer'], 'library'], 'the plugin route copies the seat too');
    assert.deepStrictEqual([copied.agents, copied.seatsRoute], [['aspnet-implementer'], 'copy'], 'the seat picked on the plugin route stays a copy');
    for (const [name, step] of Object.entries({ plugin, copied, back })) assert.deepStrictEqual(step.seatDeny, [], `${name}: no seat is denied on any route`);
    assert.deepStrictEqual([back.agents, back.seatsRoute], [['aspnet-implementer'], 'library'], 'and back: the seat stays picked and copied');
    assert.ok(back.pickedAgents.includes('aspnet-implementer'), back.pickedAgents.join(','));
});

// I4: 2.0.0's --keep-pins re-hashed a seat copy after restoring its tuned pins, so the stamp's hash IS the tuned
// file's. The copy is the seat now: it moves into its folder at that hash and `--keep-pins` holds its pins. M6: the
// roster a 2.0.0 run generated names library seats bare, and a seat copied into the project answers to its bare name -
// each such name is kept bare, and a namespaced one becomes bare.
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
    fs.writeFileSync(path.join(repo, '.claude', 'rules', 'alfred-agent-awareness.md'), [
        '---', 'description: Project capabilities awareness - generated by /capture-awareness; edit via a re-run, not by hand.', '---', '',
        '# This project\'s capabilities', '', '## Subagent seats',
        'aspnet-implementer, aspnet-solution-designer, aspnet-verifier, alfred-code:security-auditor, my-own-seat', '',
        '## MCP routing', '- `navigation` - dispatch aspnet-solution-designer never; prose here is left alone.', '',
    ].join('\n'));
}

test('I4 update over a 2.0.0 install with a tuned seat copy: the pins are kept in the moved copy, and the roster names every copied seat bare (M6)', POSIX_ONLY, () =>
{
    const { steps, outs } = seedRun(['update', 'update'], '', {
        plugins: LISTING, args: ['--installed-only', '--keep-pins'], prepare: v200Tuned,
        each: (repo) => ({ ...read(repo), roster: fs.readFileSync(path.join(repo, '.claude', 'rules', 'alfred-agent-awareness.md'), 'utf8'),
            implementer: (() => { try { return fs.readFileSync(path.join(repo, '.claude', 'agents', 'aspnet-implementer', 'aspnet-implementer.md'), 'utf8'); } catch { return ''; } })() }),
    });
    const [first, second] = steps;
    assert.match(first.implementer, /^model: opus$/m, `the tuned copy is kept:\n${outs[0]}`);
    assert.match(first.implementer, /^effort: high$/m);
    assert.doesNotMatch(outs[0], /agent kept: aspnet-implementer/, 'the tuned copy at its recorded hash is the stack\'s own, moved: nothing says it is kept');
    assert.ok(first.agents.includes('aspnet-solution-designer') && !first.agents.includes('aspnet-solution-designer.md'), 'an untouched library copy moves into its folder');
    const seats = (/## Subagent seats\n(.*)\n/.exec(first.roster) || [])[1];
    assert.strictEqual(seats, 'aspnet-implementer, aspnet-solution-designer, aspnet-verifier, security-auditor, my-own-seat', first.roster);
    assert.match(first.roster, /dispatch aspnet-solution-designer never; prose here is left alone/, 'only the seats line is re-spelled');
    assert.deepStrictEqual([second.agents, second.roster, second.implementer], [first.agents, first.roster, first.implementer], 'a re-run changes nothing');
});
