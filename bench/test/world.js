'use strict';
// A throwaway benchmark world for the harness tests: arms, tasks (with hidden tests), a real tagged
// fixture repo and a price table, all under one temp dir the test removes. Sessions run the fake CLI.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FAKE = [process.execPath, path.join(__dirname, 'fake-claude.js')];
const AUTH = 'world-test-auth-value-0123456789';
const OAUTH = 'world-test-oauth-token-0123456789';

// `fixture: { source, lock }` uses a given fixture (the real tag) instead of a throwaway repo.
function makeWorld(t, { arms, tasks, run = 'r-test', fixture = null })
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-world-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const bench = path.join(dir, 'bench');
    const armsDir = path.join(bench, 'arms');
    const tasksDir = path.join(bench, 'tasks');
    fs.mkdirSync(armsDir, { recursive: true });
    fs.writeFileSync(path.join(armsDir, 'common.json'), JSON.stringify({
        model: 'claude-sonnet-5', effort: 'medium', permissionMode: 'acceptEdits', settings: 'harness.settings.json',
        env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' }, graceSec: 1, auth: ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'], scrub: [],
    }));
    fs.writeFileSync(path.join(armsDir, 'harness.settings.json'), '{}');
    for (const [name, a] of Object.entries(arms))
    {
        fs.writeFileSync(path.join(armsDir, `${name}.json`), JSON.stringify({ name, pin: { kind: 'cli', value: 'claude' }, setup: a.setup || [], onboarding: a.onboarding || [], env: a.env || {} }));
    }
    for (const [id, spec] of Object.entries(tasks))
    {
        const td = path.join(tasksDir, id);
        fs.mkdirSync(td, { recursive: true });
        fs.writeFileSync(path.join(td, 'prompt.md'), spec.prompt || `Do ${id}.\n`);
        const meta = { id, group: spec.group || 'api', tags: spec.tags || [], timeLimitMin: spec.timeLimitMin || 1, startRef: 'bench-fixture-v1' };
        if (spec.setup) meta.setup = spec.setup;
        fs.writeFileSync(path.join(td, 'meta.json'), JSON.stringify(meta));
        for (const [rel, body] of Object.entries(spec.files || {})) fs.writeFileSync(path.join(td, rel), body);
        if (spec.grade)
        {
            fs.mkdirSync(path.join(td, 'hidden'), { recursive: true });
            fs.writeFileSync(path.join(td, 'hidden', 'grade.json'), JSON.stringify(spec.grade));
            for (const [rel, body] of Object.entries(spec.hidden || {}))
            {
                fs.mkdirSync(path.dirname(path.join(td, 'hidden', rel)), { recursive: true });
                fs.writeFileSync(path.join(td, 'hidden', rel), body);
            }
        }
    }
    let src = fixture && fixture.source;
    let lock = fixture && fixture.lock;
    if (!fixture)
    {
        src = path.join(dir, 'fixture');
        fs.mkdirSync(src);
        const git = (...a) => execFileSync('git', ['-C', src, ...a], { stdio: 'pipe' }).toString().trim();
        git('init', '-q');
        fs.writeFileSync(path.join(src, 'app.txt'), 'app\n');
        git('add', '.');
        git('-c', 'user.name=b', '-c', 'user.email=b@example.invalid', 'commit', '-q', '-m', 'fixture');
        git('tag', 'bench-fixture-v1');
        lock = { tag: 'bench-fixture-v1', commit: git('rev-parse', 'HEAD') };
    }
    // The real, dated price table: a stub would price every cell at nothing.
    const prices = path.join(__dirname, '..', '..', 'meta', 'model-prices.json');
    const lines = [];
    const opts = {
        benchDir: bench, armsDir, tasksDir, pricesFile: prices, preregFile: path.join(bench, 'PREREGISTRATION.md'),
        fixtureSource: src, lock, root: dir, claude: FAKE,
        base: { PATH: process.env.PATH, ANTHROPIC_API_KEY: AUTH }, log: (l) => lines.push(l),
        arms: Object.keys(arms), tasks: 'all', reps: 1, parallel: 2, seed: 7, run, mode: 'plain',
    };
    return { dir, bench, opts, lines, prices, runDir: path.join(bench, 'results', run) };
}

module.exports = { makeWorld, FAKE, AUTH, OAUTH };
