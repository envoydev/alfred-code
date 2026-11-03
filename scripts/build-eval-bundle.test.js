'use strict';
// build-eval-bundle.js: the core plus the whole library as ONE plugin named alfred-code, so
// `claude plugin eval` can measure a library item the way a project that copied it would load it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPO, 'scripts', 'build-eval-bundle.js');
const hasClaude = () => spawnSync('claude', ['--version'], { stdio: 'ignore' }).status === 0;
const roots = [];
test.after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); roots.push(d); return d; };

test('the bundle carries every shipped skill and agent, and every preload resolves inside it', () =>
{
    const out = path.join(tmp('bundle-'), 'b');
    const printed = JSON.parse(execFileSync(process.execPath, [SCRIPT, out], { encoding: 'utf8' }));
    const graph = JSON.parse(fs.readFileSync(path.join(REPO, 'meta/stack-graph.json'), 'utf8'));
    assert.equal(fs.readdirSync(path.join(out, 'skills')).length, Object.keys(graph.skills).length + 1, 'every skill plus the router skill');
    assert.equal(fs.readdirSync(path.join(out, 'agents')).length, Object.keys(graph.agents).length);
    assert.ok(fs.existsSync(path.join(out, 'skills', 'alfred-code', 'SKILL.md')), 'the router skill');
    assert.ok(fs.readdirSync(path.join(out, 'commands')).length > 0, 'the guided-walk commands');
    const skills = new Set(fs.readdirSync(path.join(out, 'skills')));
    for (const f of fs.readdirSync(path.join(out, 'agents')))
    {
        const fm = /^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(path.join(out, 'agents', f), 'utf8'))[1];
        for (const m of fm.matchAll(/^\s*-\s*alfred-code:(\S+)\s*$/mg)) assert.ok(skills.has(m[1]), `${f} preloads ${m[1]}`);
        assert.doesNotMatch(fm, /^\s*-\s*[a-z0-9-]+\s*$/m, `${f} keeps a bare house preload`);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(out, '.claude-plugin/plugin.json'), 'utf8'));
    assert.equal(manifest.name, 'alfred-code');
    assert.ok(manifest.author && manifest.version, 'the strict validate needs both');
    assert.ok(fs.readdirSync(path.join(out, 'evals')).length >= 14);
    assert.deepEqual(Object.keys(printed).sort(), ['agents', 'cases', 'commands', 'skills']);
});

test('the bundle leaves the source tree untouched - the rewrite happens in the copy', () =>
{
    const before = fs.readFileSync(path.join(REPO, 'stack/agents/web-angular-implementer.md'), 'utf8');
    execFileSync(process.execPath, [SCRIPT, path.join(tmp('bundle-'), 'b')], { encoding: 'utf8' });
    assert.equal(fs.readFileSync(path.join(REPO, 'stack/agents/web-angular-implementer.md'), 'utf8'), before);
    assert.match(before, /^\s*-\s*angular-conventions\s*$/m, 'the shipped library seat keeps its bare preload');
});

test('the bundle refuses to wipe a directory that is not a previous bundle - the repo above all', () =>
{
    const mine = path.join(tmp('bundle-'), 'work');
    fs.mkdirSync(mine);
    fs.writeFileSync(path.join(mine, 'notes.txt'), 'keep me\n');
    const file = path.join(path.dirname(mine), 'precious.txt');
    fs.writeFileSync(file, 'keep me too\n');
    for (const target of [mine, REPO, file])
    {
        const r = spawnSync(process.execPath, [SCRIPT, target], { encoding: 'utf8' });
        assert.notEqual(r.status, 0, `${target} refused`);
        assert.match(r.stderr, /not a previous eval bundle/);
    }
    assert.equal(fs.readFileSync(path.join(mine, 'notes.txt'), 'utf8'), 'keep me\n');
    assert.equal(fs.readFileSync(file, 'utf8'), 'keep me too\n', 'a FILE target is refused, never replaced by the bundle');
    const out = path.join(tmp('bundle-'), 'b');
    execFileSync(process.execPath, [SCRIPT, out]);
    execFileSync(process.execPath, [SCRIPT, out]);
    assert.ok(fs.existsSync(path.join(out, '.claude-plugin', 'plugin.json')), 'a previous bundle is rebuilt in place');
});

// A `tool_used: Skill` grader and one marked `arm: with-only` are not scored in the without-arm
// (`claude plugin eval --help`, --ablation); `arm: both` forces it. An inline case grades its Skill load, so
// it carries `arm: both`; a case with a graders/ folder (the size-first cases, moved here in 2.1.4 - I9)
// scores its result with regex and llm graders, which both arms score - a Skill grader there is the
// plugin-fired indicator on top.
test('every library case grades on both arms, so the case has a delta', () =>
{
    const dir = path.join(REPO, 'meta', 'evals', 'library');
    const cases = fs.readdirSync(dir);
    assert.equal(cases.length, 17);
    for (const c of cases)
    {
        const y = fs.readFileSync(path.join(dir, c, 'case.yaml'), 'utf8');
        assert.match(y, /^schema_version: "1\.1"$/m, c);
        assert.match(y, new RegExp(`^name: ${c}$`, 'm'), `${c}: the name matches its folder`);
        const graders = path.join(dir, c, 'graders');
        if (!fs.existsSync(graders)) { assert.match(y, /^\s+arm: both$/m, `${c}: arm both`); continue; }
        const both = fs.readdirSync(graders).filter((g) =>
        {
            const fm = (/^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(path.join(graders, g), 'utf8')) || [])[1] || '';
            return !/^arm: with-only$/m.test(fm) && (!/^tool: Skill$/m.test(fm) || /^arm: both$/m.test(fm));
        });
        assert.ok(both.length, `${c}: no grader is scored on both arms - the case has no delta`);
    }
});

// A path-scoped project rule never attaches inside `claude plugin eval` (the same scaffolded rule
// attaches under plain `claude -p` - measured 2026-09-24), so a language skill's case can only give its
// DESCRIPTION a real file to trigger on: the scaffold writes it, the prompt edits it.
test('a case that edits a file carries an executable scaffold that writes every file its prompt names', () =>
{
    const dir = path.join(REPO, 'meta', 'evals', 'library');
    const scaffolded = [];
    for (const c of fs.readdirSync(dir))
    {
        const y = fs.readFileSync(path.join(dir, c, 'case.yaml'), 'utf8');
        const m = /^\s+scaffold_script:\s*(\S+)\s*$/m.exec(y);
        if (!m) continue;
        scaffolded.push(c);
        const script = path.join(dir, c, m[1]);
        assert.ok(fs.existsSync(script), `${c}: ${m[1]} exists`);
        const named = [...y.matchAll(/\b(src\/[\w./-]+\.[a-z]+)\b/g)].map((n) => n[1]);
        // A language skill's case names the file its description must trigger on; a size-first case
        // edits the workspace its scaffold lays out, and its prompt names no path.
        if (c.startsWith('skill-')) assert.ok(named.length, `${c}: the prompt names the file it edits`);
        // Windows carries no exec bit and runs no bash scaffold; the eval CLI runs these on macOS / Linux.
        if (process.platform === 'win32') continue;
        assert.ok(fs.statSync(script).mode & 0o100, `${c}: ${m[1]} is executable`);
        const ws = tmp('scaffold-');
        execFileSync(script, { cwd: ws, stdio: 'pipe' });
        for (const f of named) assert.ok(fs.existsSync(path.join(ws, f)), `${c}: the scaffold writes ${f}`);
    }
    for (const c of ['skill-typescript', 'skill-javascript']) assert.ok(scaffolded.includes(c), `${c} edits a scaffolded file`);
});

test('the bundle passes claude plugin validate --strict when the CLI is here', { skip: !hasClaude() && 'claude CLI not on PATH' }, () =>
{
    const out = path.join(tmp('bundle-'), 'b');
    execFileSync(process.execPath, [SCRIPT, out]);
    const cfg = tmp('cfg-');
    execFileSync('claude', ['plugin', 'validate', '--strict', out], { env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, HOME: cfg }, stdio: 'pipe' });
});
