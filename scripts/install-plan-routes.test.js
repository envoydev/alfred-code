'use strict';
// Task 10 of the agents route switch: `--print-plan` ends its routes line with where the skills route was read from and
// whether configure may offer the switch - open, shared (settings.json holds the key), local (settings.local.json cannot be
// written) or workspace.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const rt = require('./install/runtime.js');
const { putWorkspace } = require('./workspace-fixture.js');

const KEY = 'ALFRED_CODE_SKILLS_VIA_PLUGIN';
const SELECTION = 'skill csharp\nagent evidence-gatherer\n';
const NO_ROUTE_ENV = { [KEY]: undefined, ALFRED_CODE_HOOKS_VIA_PLUGIN: undefined };
const PROJECT = ['--scope', 'project'];
const PLAN = ['--installed-only', '--print-plan'];
const ROUTES_LINE = /^plan routes: .*$/m;
const MEMBER = 'api';

const routesOf = (out) => { const m = ROUTES_LINE.exec(out); assert.ok(m, `no plan routes line in: ${out}`); return m[0]; };
const writeShared = (repo, value) =>
{
    fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), JSON.stringify({ env: { [KEY]: value } }));
};
const layOutWorkspace = (repo) =>
{
    const member = path.join(repo, MEMBER);
    fs.mkdirSync(member);
    rt.execCommand('git', ['init', '-q', member]);
    putWorkspace(repo, { children: [MEMBER] });
    putWorkspace(member, { parent: '..' });
};

test('install-plan-routes: a standalone install on the plugin route prints skills-from=env and seats-switch=open', POSIX_ONLY, () =>
{
    const { outs } = seedRun(['install', 'update'], SELECTION, { env: NO_ROUTE_ENV, args: [PROJECT, [...PROJECT, ...PLAN]] });
    assert.equal(routesOf(outs[1]), 'plan routes: skills=plugin hooks=plugin skills-from=env seats-switch=open');
});

test('install-plan-routes: after --seats-route copy the plan names the ledgered copy route, still open', POSIX_ONLY, () =>
{
    const { outs } = seedRun(['install', 'update'], SELECTION, { env: NO_ROUTE_ENV, args: [[...PROJECT, '--seats-route', 'copy'], [...PROJECT, ...PLAN]] });
    assert.equal(routesOf(outs[1]), 'plan routes: skills=copy hooks=plugin skills-from=ledgered seats-switch=open');
});

test('install-plan-routes: a settings.json that holds the key at project scope closes the switch (shared)', POSIX_ONLY, () =>
{
    const { outs } = seedRun(['install', 'update'], SELECTION, {
        env: NO_ROUTE_ENV, args: [PROJECT, [...PROJECT, ...PLAN]], each: (repo, i) => { if (i === 0) writeShared(repo, 'false'); return null; },
    });
    assert.equal(routesOf(outs[1]), 'plan routes: skills=copy hooks=plugin skills-from=shared seats-switch=shared');
});

test('install-plan-routes: a settings.local.json the stack cannot write closes the switch (local)', POSIX_ONLY, () =>
{
    const { outs } = seedRun(['install', 'update'], SELECTION, {
        env: NO_ROUTE_ENV, args: [PROJECT, [...PROJECT, ...PLAN]],
        each: (repo, i) => { if (i === 0) fs.writeFileSync(path.join(repo, '.claude', 'settings.local.json'), '{ not json'); return null; },
    });
    assert.match(routesOf(outs[1]), /seats-switch=local$/);
});

test('install-plan-routes: a shared key outranks an unusable local file', POSIX_ONLY, () =>
{
    const { outs } = seedRun(['install', 'update'], SELECTION, {
        env: NO_ROUTE_ENV, args: [PROJECT, [...PROJECT, ...PLAN]],
        each: (repo, i) => { if (i === 0) { writeShared(repo, 'false'); fs.writeFileSync(path.join(repo, '.claude', 'settings.local.json'), '{ not json'); } return null; },
    });
    assert.match(routesOf(outs[1]), /seats-switch=shared$/);
});

test('install-plan-routes: local scope has no shared file, so the same key leaves the switch open', POSIX_ONLY, () =>
{
    const LOCAL = ['--scope', 'local'];
    const { outs } = seedRun(['install', 'update'], SELECTION, {
        env: NO_ROUTE_ENV, args: [LOCAL, [...LOCAL, ...PLAN]], each: (repo, i) => { if (i === 0) writeShared(repo, 'false'); return null; },
    });
    assert.match(routesOf(outs[1]), /seats-switch=open$/);
});

test('install-plan-routes: a workspace top and a member print seats-switch=workspace', POSIX_ONLY, () =>
{
    const { outs } = seedRun(['install', 'install', 'update', 'update'], SELECTION, {
        env: { ...NO_ROUTE_ENV, ALFRED_CODE_WORKSPACE: '1' }, prepare: layOutWorkspace,
        cwds: ['repo', `repo/${MEMBER}`, 'repo', `repo/${MEMBER}`], args: [PROJECT, PROJECT, [...PROJECT, ...PLAN], [...PROJECT, ...PLAN]],
    });
    assert.match(routesOf(outs[2]), /seats-switch=workspace$/, 'top');
    assert.match(routesOf(outs[3]), /seats-switch=workspace$/, 'member');
});

test('install-plan-routes: a standalone local-scope install records links into its own store and is no workspace - the flag is not refused', POSIX_ONLY, () =>
{
    const LOCAL = ['--scope', 'local'];
    const refusal = "!! seats route: a workspace's seats route";
    const { outs, result } = seedRun(['install', 'update'], SELECTION, {
        env: NO_ROUTE_ENV, args: [LOCAL, [...LOCAL, '--seats-route', 'copy']],
        inspect: (repo) => JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.local.json'), 'utf8')).env[KEY],
    });
    assert.ok(!outs[1].includes(refusal), outs[1]);
    assert.equal(result, 'false');
});
