'use strict';

// Task 4: one `seats:` log line says where the agents come from on each route, so an absent
// .claude/agents after an update reads as the plugin route, not as a loss.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const { placement, CORE } = require('./plugin-placement.js');

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
    assert.ok(out.includes('==> seats: 1 copied into .claude/agents\n'), out);
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
