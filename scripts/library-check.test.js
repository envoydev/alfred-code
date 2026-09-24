'use strict';
// library-check.js: what a project's library copies look like against the stamp that wrote them and
// the stack running now - drift, missing, behind, a stale stamp, and each skill's skillOverrides.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { copyLibrary } = require('./install/library.js');
const { renderStamp } = require('./install/stamp.js');

const SCRIPT = path.join(__dirname, 'library-check.js');
const roots = [];
test.after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

function fx({ sourceVersion = '1.3.0', sourceEdit = false, settings, local, rawSettings, noStamp = false, scope = 'project' } = {})
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'libcheck-'));
    roots.push(root);
    const src = path.join(root, 'src');
    fs.mkdirSync(path.join(src, 'stack/skills/demo'), { recursive: true });
    fs.writeFileSync(path.join(src, 'stack/skills/demo/SKILL.md'), '---\nname: demo\ndescription: d\n---\nbody\n');
    fs.mkdirSync(path.join(src, 'stack/agents'), { recursive: true });
    fs.writeFileSync(path.join(src, 'stack/agents/seat.md'), '---\nname: seat\ndescription: s\n---\nbody\n');
    fs.mkdirSync(path.join(src, 'setup-plugin/.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(src, 'setup-plugin/.claude-plugin/plugin.json'), JSON.stringify({ name: 'alfred-code', version: sourceVersion }));

    const project = path.join(root, 'proj');
    const config = path.join(root, 'config');
    const claudeDir = path.join(project, '.claude');
    const base = scope === 'global' ? config : claudeDir;
    const skills = path.join(base, 'skills');
    const agents = path.join(claudeDir, 'agents');
    const library = copyLibrary({ sourceDir: src, skillsDir: skills, agentsDir: agents, skills: ['demo'], agents: ['seat'], stamped: null });
    if (!noStamp)
    {
        fs.writeFileSync(path.join(base, 'alfred-code.stamp'), renderStamp({
            repoUrl: 'https://example.invalid/r', ref: 'main', sha: 'a'.repeat(40), version: '1.3.0', installed: '2026-09-24T00:00:00Z',
            action: 'install', scope, hooks: [], alwaysRules: [], alwaysMcps: [], picked: { skills: ['demo'], agents: ['seat'] }, library,
        }));
    }
    if (settings) fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify(settings));
    if (rawSettings) fs.writeFileSync(path.join(claudeDir, 'settings.json'), rawSettings);
    if (local) fs.writeFileSync(path.join(claudeDir, 'settings.local.json'), JSON.stringify(local));
    if (sourceEdit) fs.appendFileSync(path.join(src, 'stack/skills/demo/SKILL.md'), 'newer\n');
    return { root, src, project, config, skills, agents };
}

function run(f, extra = [])
{
    try { return { out: execFileSync(process.execPath, [SCRIPT, '--project', f.project, '--source', f.src, ...extra], { encoding: 'utf8' }), code: 0 }; }
    catch (e) { return { out: String(e.stdout || ''), code: e.status }; }
}

test('clean install reads clean', () =>
{
    const r = run(fx());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /library: clean \(2 copies\)/);
});

test('a hand edit is drift', () =>
{
    const f = fx();
    fs.appendFileSync(path.join(f.skills, 'demo/SKILL.md'), 'x');
    const r = run(f);
    assert.equal(r.code, 1);
    assert.match(r.out, /drift: skill demo/);
});

test('a deleted copy is missing', () =>
{
    const f = fx();
    fs.rmSync(path.join(f.agents, 'seat.md'));
    const r = run(f);
    assert.equal(r.code, 1);
    assert.match(r.out, /missing: agent seat/);
});

test('a newer source is behind and the stamp stale', () =>
{
    const out = run(fx({ sourceVersion: '9.9.9', sourceEdit: true })).out;
    assert.match(out, /stale stamp: the project copies are from 1\.3\.0, the stack is 9\.9\.9/);
    assert.match(out, /behind: skill demo/);
    assert.doesNotMatch(out, /behind: agent seat/, 'an unchanged source item is not behind');
});

test('skillOverrides is reported per skill, local over project', () =>
{
    const f = fx({ settings: { skillOverrides: { demo: 'off' } }, local: { skillOverrides: { demo: 'name-only' } } });
    const got = JSON.parse(run(f, ['--json']).out);
    assert.equal(got.rows.find((r) => r.name === 'demo').mode, 'name-only');
    assert.equal(got.rows.find((r) => r.name === 'seat').mode, undefined, 'an agent has no skillOverrides');
    assert.match(run(fx({ settings: { skillOverrides: { demo: 'off' } } })).out, /switched: skill demo is 'off' in skillOverrides/);
});

test('no stamp, or a stamp without library lines, reads as nothing to check', () =>
{
    const r = run(fx({ noStamp: true }));
    assert.equal(r.code, 0);
    assert.match(r.out, /no library stamp/);
    const f = fx();
    fs.writeFileSync(path.join(f.project, '.claude', 'alfred-code.stamp'), 'sha: abc\nversion: 1.2.0\npicked-skills: demo\n');
    assert.match(run(f).out, /no library stamp/);
});

test('a malformed settings file does not crash the check', () =>
{
    const r = run(fx({ rawSettings: '{garbage' }));
    assert.equal(r.code, 0, r.out);
});

test('global scope reads the account dir', () =>
{
    const f = fx({ scope: 'global' });
    const r = run(f, ['--scope', 'global', '--config-dir', f.config]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /library: clean \(2 copies\)/);
    assert.match(run(f).out, /no library stamp/, 'read at project scope, the account stamp is not found');
});
