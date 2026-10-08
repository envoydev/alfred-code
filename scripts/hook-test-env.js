// scripts/hook-test-env.js - the containment every hook suite applies before it spawns a hook (2.1.5 M5).
// A suite run from a Claude Code session inherits that session's stack settings (an installed checkout seeds
// ALFRED_CODE_DOCS_PATH and the rest into every tool call), its CLAUDE_CODE_ENTRYPOINT and possibly its
// project dir. A hook that reads one of them judges the RUNNER's install - 8 commit-gate cases failed on an
// inherited docs path - and a hook that writes lands in the runner's tree, or, with CLAUDE_PROJECT_DIR pointed
// at os.tmpdir(), in `$TMPDIR/<docs-path>/hook-blocks`: a stray folder that broke the benchmark isolation checks.
// One call at the top of each hook suite, after `require('node:test')` and before any env value is set or
// copied: every inherited stack key, the entrypoint, the plugin root and profile and the project dir go, a
// fresh project dir comes back for the suite's own spawns, and the suite FAILS if anything it ran wrote under
// os.tmpdir()'s own docs root, or into the checkout's own hook-blocks ledger, while it ran.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const STACK_KEY = /^ALFRED_CODE_/;
const SESSION_KEYS = ['CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_PLUGIN_ROOT', 'CLAUDE_PLUGIN_OPTION_HOOK_PROFILE', 'CLAUDE_PROJECT_DIR'];

// The docs roots a hook falls back to under a project dir of os.tmpdir(): the default and the old one - plus the
// RUNNER's own ledger: a hook spawned with no project dir and no cwd writes its block row under process.cwd(), the
// checkout itself (audit 2026-10-08: layer-table-gate.test.js left 494 rows in the repo's nosession.jsonl unseen).
// Only the ledger folder is watched there, never the whole docs root, which a person edits while a suite runs.
const strayRoots = () => [...['.alfred', '.claude'].map((d) => path.join(os.tmpdir(), d, 'docs')), path.join(process.cwd(), '.alfred', 'docs', 'hook-blocks')];

// Every file under the stray roots written at or after `since` (ms), as paths.
function strayWrites(since, roots = strayRoots())
{
    const out = [];
    const walk = (dir) =>
    {
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries)
        {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else { try { if (fs.statSync(p).mtimeMs >= since) out.push(p); } catch { /* gone */ } }
        }
    };
    for (const root of roots) walk(root);
    return out;
}

// A copy of `env` with none of the keys a runner's session hands down.
function scrubbed(env = process.env)
{
    const out = { ...env };
    for (const k of Object.keys(out)) if (STACK_KEY.test(k) || SESSION_KEYS.includes(k)) delete out[k];
    return out;
}

// `ownTmp`: the suite and every hook it spawns get a temp dir of their own (TMPDIR, TEMP and TMP), removed after
// the run - the read and stop hooks keep per-session state files under os.tmpdir(), and the suites left thousands of
// them in the machine's temp dir (audit 2026-10-08: 5,910 `guard-read-*.json`). The stray check reads both temp dirs.
function isolateHookSuite({ ownTmp = false } = {})
{
    for (const k of Object.keys(process.env)) if (STACK_KEY.test(k) || SESSION_KEYS.includes(k)) delete process.env[k];
    const machineRoots = strayRoots();
    let tmp = null;
    if (ownTmp)
    {
        tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hook-suite-tmp-')));
        for (const k of ['TMPDIR', 'TEMP', 'TMP']) process.env[k] = tmp;
    }
    const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hook-suite-project-')));
    const since = Date.now() - 1000;   // a coarse filesystem clock never hides a write made this second
    const test = require('node:test');
    test.after(() =>
    {
        fs.rmSync(project, { recursive: true, force: true });
        const stray = [...new Set([...strayWrites(since), ...strayWrites(since, machineRoots)])];
        if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
        if (stray.length) throw new Error(`this suite wrote under os.tmpdir()'s own docs root or the checkout's ledger - a hook ran with the temp dir or the runner's cwd as its project: ${stray.join(', ')}`);
    });
    return { project, tmp };
}

module.exports = { isolateHookSuite, scrubbed, strayWrites, strayRoots, STACK_KEY, SESSION_KEYS };
