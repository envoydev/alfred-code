'use strict';

// Task 4: one `seats:` log line says where the agents come from on each route, so an absent
// .claude/agents after an update reads as the plugin route, not as a loss. Every seat is a copy now: the plugin carries none.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const { seatsLine, countSeatFiles } = require('./install/seats-line.js');

const ONE_SEAT = 'skill csharp\nrule markdown-docs\nagent evidence-gatherer\n';
const SEATS_LINE = /^==> seats: .*$/m;

test('install-seats-line: the plugin routes say how many seats were copied per project and linked', POSIX_ONLY, () =>
{
    const { out } = seedRun('install', ONE_SEAT, { args: ['--scope', 'project'] });
    const want = 'seats: 1 picked, copied per project and linked in .claude/agents - the plugin carries none (/alfred-code:status lists them)';
    assert.ok(out.includes(`==> ${want}\n`), out);
    assert.strictEqual(out.match(/^==> seats: /gm).length, 1, 'one line, once');
    assert.doesNotMatch(out, /switched off in permissions\.deny/);
});

test('install-seats-line: the copy route says how many seats were copied into .claude/agents', POSIX_ONLY, () =>
{
    const { out } = seedRun('install', ONE_SEAT, {
        args: ['--scope', 'project'], env: { ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' },
    });
    assert.ok(out.includes('==> seats: copy route - 1 picked in .claude/agents\n'), out);
    assert.doesNotMatch(out, /the plugin carries none/);
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
const editJson = (file, change) => { const json = JSON.parse(fs.readFileSync(file, 'utf8')); change(json); fs.writeFileSync(file, JSON.stringify(json, null, 2)); };
const updateWithNoSelection = (each) => seedRun(['install', 'update'], ONE_SEAT, { args: [['--scope', 'project'], ['--scope', 'project', '--installed-only']], seed: [SEED_ENTRY, NO_SELECTION], each }).outs[1];

test('install-seats-line: an update with no selection still counts the seats it kept', POSIX_ONLY, () =>
{
    const out = updateWithNoSelection();
    assert.ok(out.includes('==> seats: 1 picked, copied per project and linked in .claude/agents'), out);
});

test('install-seats-line: deny rows an earlier release left for shipped seats go and are no part of the line; a row for no seat stays', POSIX_ONLY, () =>
{
    let kept = null;
    const out = updateWithNoSelection((repo, i) =>
    {
        const local = path.join(repo, '.claude', 'settings.local.json');
        if (i === 0) editJson(local, (j) => { j.permissions = { ...j.permissions, deny: [...(j.permissions?.deny || []), 'Agent(alfred-code:aspnet-verifier)', 'Agent(alfred-code:not-a-seat)', 'Agent(Explore)'] }; });
        else kept = (JSON.parse(fs.readFileSync(local, 'utf8')).permissions.deny || []).filter((r) => r.startsWith('Agent('));
        return null;
    });
    assert.ok(out.includes('==> seats: 1 picked, copied per project and linked in .claude/agents'), out);
    assert.deepStrictEqual(kept, ['Agent(alfred-code:not-a-seat)', 'Agent(Explore)']);
});

test('install-seats-line: the copy route counts the seats that are in .claude/agents, not the list the run held', POSIX_ONLY, () =>
{
    let present = -1;
    const { out } = seedRun('install', 'skill csharp\nagent evidence-gatherer\nagent code-quality-analyzer\n', {
        args: ['--scope', 'project'], env: { ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' },
        inspect: (repo) => { present = fs.readdirSync(path.join(repo, '.claude', 'agents')).filter((f) => fs.existsSync(path.join(repo, '.claude', 'agents', f, `${f}.md`))).length; return null; },
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
