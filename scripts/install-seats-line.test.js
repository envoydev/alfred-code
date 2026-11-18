'use strict';

// Task 4: one `seats:` log line says where the agents come from on each route, so an absent
// .claude/agents after an update reads as the plugin route, not as a loss.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const { placement, CORE } = require('./plugin-placement.js');
const { seatsLine, countSeatFiles } = require('./install/seats-line.js');

const ONE_SEAT = 'skill csharp\nrule markdown-docs\nagent evidence-gatherer\n';
const SEATS_LINE = /^==> seats: .*$/m;
const CORE_SEATS = placement().plugins[CORE].agents.length;

test('install-seats-line: the plugin route names the seats on, the seats switched off, and where the agents are', POSIX_ONLY, () =>
{
    const { out } = seedRun('install', ONE_SEAT, { args: ['--scope', 'project'] });
    const on = 1;
    const off = CORE_SEATS - on;
    assert.ok(off > 0, 'the core ships more seats than the selection holds');
    const want = `seats: ${on} on from the alfred-code plugin, ${off} switched off in permissions.deny - no .claude/agents on this route (/alfred-code:status lists them)`;
    assert.ok(out.includes(`==> ${want}\n`), out);
    assert.strictEqual(out.match(/^==> seats: /gm).length, 1, 'one line, once');
});

test('install-seats-line: the copy route says how many seats were copied into .claude/agents', POSIX_ONLY, () =>
{
    const { out } = seedRun('install', ONE_SEAT, {
        args: ['--scope', 'project'], env: { ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' },
    });
    assert.ok(out.includes('==> seats: copy route - 1 picked in .claude/agents\n'), out);
    assert.doesNotMatch(out, /on from the alfred-code plugin/);
});

test('install-seats-line: a run whose settings.local.json is unusable logs no seats line', POSIX_ONLY, () =>
{
    const { outs } = seedRun(['install', 'update'], ONE_SEAT, {
        args: [['--scope', 'local'], ['--installed-only']],
        each: (repo, i) =>
        {
            if (i === 0) fs.writeFileSync(path.join(repo, '.claude', 'settings.local.json'), '{ not json');
            return null;
        },
    });
    assert.match(outs[1], /!! settings: \.claude\/settings\.local\.json is not valid JSON/, outs[1]);
    assert.doesNotMatch(outs[1], SEATS_LINE);
});

// final review, item 3: the line counts the deny rows the settings files hold, not this run's own set - an update that
// carries no selection writes none and still leaves every earlier row in force.
const SEED_ENTRY = path.join(__dirname, 'install', 'alfred-code.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'seats-line-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const NO_SELECTION = path.join(TMP, 'no-selection-seed.js');
fs.writeFileSync(NO_SELECTION, [`const seed = require(${JSON.stringify(SEED_ENTRY)});`,
    'const argv = process.argv.slice(2);', "const at = argv.indexOf('--selection');", 'if (at >= 0) argv.splice(at, 2);',
    'process.exitCode = seed.main(argv, process.env, { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) });', ''].join('\n'));
const seatRows = (file) => { try { return (JSON.parse(fs.readFileSync(file, 'utf8')).permissions.deny || []).filter((r) => /^Agent\(alfred-code:/.test(r)); } catch { return []; } };
const editJson = (file, change) => { const json = JSON.parse(fs.readFileSync(file, 'utf8')); change(json); fs.writeFileSync(file, JSON.stringify(json, null, 2)); };
const updateWithNoSelection = (each) => seedRun(['install', 'update'], ONE_SEAT, { args: [['--scope', 'project'], ['--scope', 'project']], seed: [SEED_ENTRY, NO_SELECTION], each }).outs[1];

test('install-seats-line: an update with no selection still counts the deny rows an earlier run wrote', POSIX_ONLY, () =>
{
    const out = updateWithNoSelection();
    const want = `seats: 1 on from the alfred-code plugin, ${CORE_SEATS - 1} switched off in permissions.deny`;
    assert.ok(out.includes(`==> ${want} - no .claude/agents`), out);
});

test('install-seats-line: a deny row in settings.json (a scope move left it, or the user wrote it) counts once, beside the local rows', POSIX_ONLY, () =>
{
    const out = updateWithNoSelection((repo, i) =>
    {
        if (i !== 0) return null;
        const local = path.join(repo, '.claude', 'settings.local.json');
        const rows = seatRows(local);
        editJson(local, (j) => { j.permissions.deny = j.permissions.deny.filter((r) => r !== rows[0] && r !== rows[1]); });
        fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), JSON.stringify({ permissions: { deny: [rows[0], rows[2]] } }));
        return null;
    });
    const off = CORE_SEATS - 1 - 1;
    assert.ok(out.includes(`==> seats: ${CORE_SEATS - off} on from the alfred-code plugin, ${off} switched off in permissions.deny`), out);
});

test('install-seats-line: a row naming a seat the core does not ship is no seat switched off', POSIX_ONLY, () =>
{
    const out = updateWithNoSelection((repo, i) =>
    {
        if (i !== 0) return null;
        const local = path.join(repo, '.claude', 'settings.local.json');
        editJson(local, (j) => { j.permissions.deny.push('Agent(alfred-code:not-a-seat)', 'Agent(Explore)'); });
        return null;
    });
    assert.ok(out.includes(`==> seats: 1 on from the alfred-code plugin, ${CORE_SEATS - 1} switched off in permissions.deny`), out);
});

test('install-seats-line: the copy route counts the seats that are in .claude/agents, not the list the run held', POSIX_ONLY, () =>
{
    let present = -1;
    const { out } = seedRun('install', 'skill csharp\nagent evidence-gatherer\nagent code-quality-analyzer\n', {
        args: ['--scope', 'project'], env: { ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' },
        inspect: (repo) => { present = fs.readdirSync(path.join(repo, '.claude', 'agents')).filter((f) => f.endsWith('.md')).length; return null; },
    });
    const m = /^==> seats: copy route - (\d+) picked in \.claude\/agents(?:; (\d+) earlier)?/m.exec(out);
    assert.strictEqual(Number(m[1]) + Number(m[2] || 0), present, out);
    assert.ok(present >= 2, 'both picks are there');
});

test('install-seats-line: the copy route names earlier copies', () =>
{
    assert.strictEqual(seatsLine({ viaPlugin: false, picked: 3, earlier: 45 }),
        'seats: copy route - 3 picked in .claude/agents; 45 earlier copies not picked stay there - the stack no longer updates them; delete a file to drop its seat');
});

test('install-seats-line: no earlier copies, one clause', () =>
{
    assert.strictEqual(seatsLine({ viaPlugin: false, picked: 3, earlier: 0 }), 'seats: copy route - 3 picked in .claude/agents');
});

test('install-seats-line: countSeatFiles counts seats on disk once', POSIX_ONLY, () =>
{
    const dir = fs.mkdtempSync(path.join(TMP, 'agents-'));
    for (const n of ['a', 'b', 'c', 'mine']) fs.writeFileSync(path.join(dir, `${n}.md`), n);
    fs.symlinkSync(path.join(dir, 'a.md'), path.join(dir, 'd.md'));
    assert.deepStrictEqual(countSeatFiles({ agentsDir: dir, seatNames: ['a', 'b', 'c', 'd'], pickedFiles: ['a.md'] }), { picked: 1, earlier: 2 });
    // readdir order never decides: the picked link claims the real file whichever name comes first
    assert.deepStrictEqual(countSeatFiles({ agentsDir: dir, seatNames: ['a', 'b', 'c', 'd'], pickedFiles: ['d.md'] }), { picked: 1, earlier: 2 });
    assert.deepStrictEqual(countSeatFiles({ agentsDir: path.join(dir, 'none'), seatNames: ['a'], pickedFiles: ['a.md'] }), { picked: 0, earlier: 0 });
});
