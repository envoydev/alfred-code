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
const OLD_STAMP = 'claude-stack.stamp'; // legacy-name - what a 1.x release wrote
const roots = [];
test.after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

function fx({
    sourceVersion = '1.3.0', sourceEdit = false, settings, local, rawSettings, noStamp = false, legacy = false,
    ruleEdit = false, docsRoot,
} = {})
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'libcheck-'));
    roots.push(root);
    const src = path.join(root, 'src');
    fs.mkdirSync(path.join(src, 'stack/skills/demo'), { recursive: true });
    fs.writeFileSync(path.join(src, 'stack/skills/demo/SKILL.md'), '---\nname: demo\ndescription: d\n---\nbody\n');
    fs.mkdirSync(path.join(src, 'stack/agents'), { recursive: true });
    fs.writeFileSync(path.join(src, 'stack/agents/seat.md'), '---\nname: seat\ndescription: s\n---\nbody\n');
    fs.mkdirSync(path.join(src, 'stack/rules'), { recursive: true });
    fs.writeFileSync(path.join(src, 'stack/rules/baseline-git.md'), '# git\n');
    // A pristine copy of the placeholder rule, exactly as `stack/rules/baseline-docs-root.md` ships
    // it - the one rule whose PROJECT copy never matches its source byte for byte (the source holds
    // `__DOCS_ROOT__`, the project a substituted path), so `behind` needs the normalised comparison.
    fs.writeFileSync(path.join(src, 'stack/rules/baseline-docs-root.md'), "This install's root: `__DOCS_ROOT__`\n");
    fs.mkdirSync(path.join(src, 'setup-plugin/.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(src, 'setup-plugin/.claude-plugin/plugin.json'), JSON.stringify({ name: 'alfred-code', version: sourceVersion }));

    const project = path.join(root, 'proj');
    const config = path.join(root, 'config');
    const claudeDir = path.join(project, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    // `legacy` simulates a 1.x GLOBAL install this project has not yet run an `update` over - its
    // own stamp and skills still sit under the ACCOUNT dir, under the 1.x stamp NAME (a 2.x install
    // never writes either there again, at any scope).
    const base = legacy ? config : claudeDir;
    const skills = path.join(base, 'skills');
    const agents = path.join(claudeDir, 'agents');
    const rules = path.join(claudeDir, 'rules');
    if (settings) fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify(settings));
    if (rawSettings) fs.writeFileSync(path.join(claudeDir, 'settings.json'), rawSettings);
    if (docsRoot) fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: docsRoot } }));
    const library = copyLibrary({
        sourceDir: src, skillsDir: skills, agentsDir: agents, rulesDir: rules,
        skills: ['demo'], agents: ['seat'], rules: ['baseline-git', 'baseline-docs-root'], stamped: null,
    });
    // Simulate the installer's own docs-root stamp: substitute the placeholder, then hash AFTER the
    // rewrite - exactly what alfred-code.js must do for the recorded hash to mean anything.
    const docsRootFile = path.join(rules, 'baseline-docs-root.md');
    fs.writeFileSync(docsRootFile, fs.readFileSync(docsRootFile, 'utf8').replace('__DOCS_ROOT__', docsRoot || '.claude/docs'));
    library.rules['baseline-docs-root'] = require('./install/library.js').hashItem(docsRootFile);
    if (!noStamp)
    {
        fs.writeFileSync(path.join(base, legacy ? OLD_STAMP : 'alfred-code.stamp'), renderStamp({
            repoUrl: 'https://example.invalid/r', ref: 'main', sha: 'a'.repeat(40), version: '1.3.0', installed: '2026-09-24T00:00:00Z',
            action: 'install', scope: legacy ? 'global' : 'project', hooks: [], alwaysRules: [], alwaysMcps: [], picked: { skills: ['demo'], agents: ['seat'] }, library,
        }));
    }
    if (local) fs.writeFileSync(path.join(claudeDir, 'settings.local.json'), JSON.stringify(local));
    if (sourceEdit) fs.appendFileSync(path.join(src, 'stack/skills/demo/SKILL.md'), 'newer\n');
    if (ruleEdit) fs.appendFileSync(path.join(src, 'stack/rules/baseline-git.md'), 'newer\n');
    return { root, src, project, config, skills, agents, rules };
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
    assert.match(r.out, /library: clean \(4 copies\)/);
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

// R29: rules are a third kind, checked exactly like skills and agents - drift, missing, behind.
test('a hand-edited rule is drift', () =>
{
    const f = fx();
    fs.appendFileSync(path.join(f.rules, 'baseline-git.md'), 'x');
    const r = run(f);
    assert.equal(r.code, 1);
    assert.match(r.out, /drift: rule baseline-git/);
});

test('a deleted rule copy is missing', () =>
{
    const f = fx();
    fs.rmSync(path.join(f.rules, 'baseline-git.md'));
    const r = run(f);
    assert.equal(r.code, 1);
    assert.match(r.out, /missing: rule baseline-git/);
});

test('a newer source rule is behind', () =>
{
    const out = run(fx({ sourceVersion: '9.9.9', ruleEdit: true })).out;
    assert.match(out, /behind: rule baseline-git/);
});

// baseline-docs-root.md is never byte-identical between the pristine source (which holds the
// __DOCS_ROOT__ placeholder) and the project copy (which the installer substitutes) - a raw
// hashItem-vs-hashItem compare would read it as permanently 'behind'. The normalised comparison
// restores the placeholder's resolved value into the SOURCE content before hashing, so an
// up-to-date copy reads clean, and only a REAL upstream change to the rule (beyond the
// placeholder line) reads as behind.
test('baseline-docs-root is compared normalised - the placeholder never reads as behind by itself', () =>
{
    const clean = run(fx({ docsRoot: 'team/docs' }));
    assert.equal(clean.code, 0, clean.out);
    assert.doesNotMatch(clean.out, /behind: rule baseline-docs-root/, 'an up-to-date, substituted copy is not behind just because the source still holds the placeholder');

    const f = fx({ sourceVersion: '9.9.9' });
    fs.appendFileSync(path.join(f.src, 'stack/rules/baseline-docs-root.md'), 'a real upstream change\n');
    const out = run(f).out;
    assert.match(out, /behind: rule baseline-docs-root/, 'a genuine content change past the placeholder still reads as behind');
});

// R29: a stamp written before rules joined the library (skills/agents present, no library-rules
// line at all) must never report every rule as drift or missing on the first check after the
// upgrade - there is nothing recorded yet to compare against, so there is nothing to report.
test('a stamp with no library-rules line reports no rule rows - never false drift', () =>
{
    const f = fx();
    const stamp = path.join(f.project, '.claude', 'alfred-code.stamp');
    const text = fs.readFileSync(stamp, 'utf8').replace(/^library-rules: .*$/m, 'library-rules: ');
    // Simulate the pre-R29 shape exactly: the line is ABSENT, not merely empty.
    fs.writeFileSync(stamp, text.split('\n').filter((l) => !l.startsWith('library-rules:')).join('\n'));
    const got = JSON.parse(run(f, ['--json']).out);
    assert.ok(!got.rows.some((r) => r.kind === 'rule'), 'no rule rows at all when the stamp never recorded any');
    assert.ok(got.rows.some((r) => r.kind === 'skill'), 'skills/agents are still checked normally');
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
    // A 1.2.0 project: its stamp still carries the 1.x name and no library lines.
    const f = fx();
    fs.rmSync(path.join(f.project, '.claude', 'alfred-code.stamp'));
    const old = path.join(f.project, '.claude', OLD_STAMP);
    fs.writeFileSync(old, 'sha: abc\nversion: 1.2.0\npicked-skills: demo\n');
    assert.match(run(f).out, /no library stamp/);
    assert.equal(fs.readFileSync(old, 'utf8'), 'sha: abc\nversion: 1.2.0\npicked-skills: demo\n', 'a read-only check leaves the 1.x stamp as it was');
});

test('a 1.3.0 stamp under its 1.x name is checked like the new one - the new name wins when both exist', () =>
{
    const f = fx();
    const stamp = path.join(f.project, '.claude', 'alfred-code.stamp');
    fs.renameSync(stamp, path.join(f.project, '.claude', OLD_STAMP));
    const r = run(f);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /library: clean \(4 copies\)/);
    fs.writeFileSync(stamp, 'sha: abc\nversion: 2.0.0\npicked-skills: demo\n');
    assert.match(run(f).out, /no library stamp/, 'the new stamp is read first, even beside a 1.x one');
});

test('a malformed settings file does not crash the check', () =>
{
    const r = run(fx({ rawSettings: '{garbage' }));
    assert.equal(r.code, 0, r.out);
});

// T16, R29: every 2.x install keeps its stamp and its skills in the PROJECT, whatever scope it was
// made at - only a 1.x GLOBAL install this project has never run an `update` over still has them in
// the account dir, and `--config-dir` is the legacy fallback that still finds them there.
test('a 1.x global install not yet migrated is still found through --config-dir', () =>
{
    const f = fx({ legacy: true });
    const r = run(f, ['--config-dir', f.config]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /library: clean \(4 copies\)/);
    assert.match(run(f).out, /no library stamp/, 'without --config-dir the project alone has nothing yet');
});

// I6 (R47, fix round 1): a project-native install (never migrated, its own stamp and skills always
// in the project) can still be shadowed by an UNRELATED personal account skill of the same name -
// Claude Code runs personal over project, so --config-dir is checked whether or not it was this
// run's stamp source.
test('an account skill of the same name shadows a project library copy - flagged, exit 1 (I6)', () =>
{
    const f = fx();
    fs.mkdirSync(path.join(f.config, 'skills', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(f.config, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: d\n---\nbody\n');
    const r = run(f, ['--config-dir', f.config]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /shadowed: skill demo - an account copy at .*skills.demo overrides this project's own/);
    assert.match(r.out, new RegExp(`rm -rf '${path.join(f.config, 'skills', 'demo').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
});

test('no --config-dir given, or no matching account skill, never reports shadowed', () =>
{
    const f = fx();
    assert.doesNotMatch(run(f).out, /shadowed:/, 'no --config-dir at all');
    fs.mkdirSync(path.join(f.config, 'skills'), { recursive: true });
    fs.writeFileSync(path.join(f.config, 'skills', 'unrelated.txt'), 'not a skill dir\n');
    const r = run(f, ['--config-dir', f.config]);
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /shadowed:/);
});
