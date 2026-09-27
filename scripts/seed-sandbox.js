// scripts/seed-sandbox.js - one throwaway project per case, for the tests that run the Node seed END TO
// END against a recording `claude`: every CLI call is logged, `plugin list --json` answers from a
// fixture, and the tools other layers reach for (uvx for the notes import, npx for the browser
// download, npm and curl - which the seed no longer calls since its pins are the release's) answer
// 'no' - so no run reaches registry.npmjs.org or pypi.org unless a case hands in its own stub. The unit tests prove what each layer does with what it
// is handed; these prove the seed hands it. A shell-script stub cannot be spawned without a shell on
// Windows, so callers pass POSIX_ONLY as the test options.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const rt = require('./install/runtime.js');  // R105: every external command through the one Windows-safe spawn

const ROOT = path.join(__dirname, '..');
const SEED = path.join(__dirname, 'install', 'alfred-code.js');
const POSIX_ONLY = { skip: process.platform === 'win32' && 'the recording stub is a shell script' };

// A 1.x install's shell may still export CLAUDE_STACK_* alongside the current ALFRED_CODE_* names - // legacy-name
// both prefixes are stripped so neither reaches the sandbox, in place, returning the same object.
function scrubLegacyEnv(env)
{
    for (const k of Object.keys(env)) if (k.startsWith('ALFRED_CODE_') || k.startsWith('CLAUDE_STACK_')) delete env[k]; // legacy-name
    return env;
}

// `prepare(repo)` lays the project out before the run; `inspect(repo)` reads it after, before the
// sandbox is removed. `env` adds to (or, with undefined, removes from) the run's environment -
// one object for every step, or an array with one PER STEP (a route flip between two runs).
// A tool mapped to `null` in `tools` is ABSENT: no stub, and PATH is cut to the sandbox bin, node's own dir
// and the system dirs, so a real copy on this machine cannot answer instead.
// `source: null` runs with no --source, so the seed resolves its own snapshot (the plugin cache under the
// sandbox account, which `prepare(repo, work)` can lay out). `tools` puts a stub on PATH per name (`{ npm: '<sh body>' }`), replacing the default 'no', for a case
// that needs a registry lookup to answer one fixed way. `action` may be a list - the runs share one sandbox, in order, and
// `each(repo, i)` reads (or, like the 1.2.0-stamp prune test above, mutates) the tree after run `i`
// (its answers come back as `steps`); `out` is the last run's output, `outs` every run's. `args` are
// appended to every run's command line. `source` and `args` are each either ONE value shared by
// every step (the common case - a bare array of flag strings for `args` still means that), or an
// array with one entry PER STEP, for a case whose steps need different `--source` snapshots or
// different flags (only an array of arrays switches `args` to per-step). A per-step entry may be a
// function of (repo, work), called just before its step runs - for flags built from an earlier step.
// `failOk` keeps a run that exits non-zero (a refusal) from throwing: the tree still reaches `inspect`,
// and the last run's exit status and stderr come back as `code` and `err`.
function seedRun(action, selection, { plugins = '[]', env: extra = {}, tools = {}, source = ROOT, args = [], prepare = () => {}, inspect = () => null, each = () => null, failOk = false } = {})
{
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-sandbox-'));
    const repo = path.join(work, 'repo');
    fs.mkdirSync(repo);
    rt.execCommand('git', ['init', '-q', repo]);
    const bin = path.join(work, 'bin');
    fs.mkdirSync(bin);
    const log = path.join(work, 'claude-calls.log');
    fs.writeFileSync(path.join(work, 'plugins.json'), plugins);
    fs.writeFileSync(path.join(bin, 'claude'), ['#!/bin/sh', 'printf \'%s\\n\' "$*" >> "$CLAUDE_STUB_LOG"',
        'if [ "$1" = "plugin" ] && [ "$2" = "list" ]; then cat "$CLAUDE_STUB_PLUGINS"; fi', 'exit 0', ''].join('\n'), { mode: 0o755 });
    for (const tool of ['uvx', 'npx', 'npm', 'curl']) fs.writeFileSync(path.join(bin, tool), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    for (const [tool, body] of Object.entries(tools))
    {
        if (body === null) fs.rmSync(path.join(bin, tool), { force: true });
        else fs.writeFileSync(path.join(bin, tool), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    }
    const absent = Object.values(tools).some((body) => body === null);
    const searchPath = absent ? [bin, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter) : bin + path.delimiter + process.env.PATH;
    fs.writeFileSync(path.join(work, 'sel.txt'), selection);
    const env = { ...process.env, HOME: work, CLAUDE_CONFIG_DIR: path.join(work, 'acct'), PATH: searchPath,
        CLAUDE_STUB_LOG: log, CLAUDE_STUB_PLUGINS: path.join(work, 'plugins.json') };
    // This runner may sit in a session whose account env carries real keys and stack settings - none
    // of them may reach the run, or land in the sandbox.
    for (const k of ['SENTRY_SLUG', 'SENTRY_ACCESS_TOKEN', 'CONTEXT7_API_KEY']) delete env[k];
    scrubLegacyEnv(env);
    const envAt = (i) =>
    {
        const out = { ...env };
        for (const [k, v] of Object.entries((Array.isArray(extra) ? extra[i] : extra) || {})) { if (v === undefined) delete out[k]; else out[k] = v; }
        return out;
    };
    try
    {
        prepare(repo, work);
        const outs = [];
        const steps = [];
        let code = 0;
        let err = '';
        const actions = [].concat(action);
        const sourceAt = (i) => (Array.isArray(source) ? source[i] : source);
        // A step's args may be a function of (repo, work) - a later step built from an earlier one's output.
        const perStep = Array.isArray(args) && (Array.isArray(args[0]) || typeof args[0] === 'function');
        const argsAt = (i) => { const a = perStep ? args[i] : args; return typeof a === 'function' ? a(repo, work) : a; };
        for (const [i, act] of actions.entries())
        {
            const src = sourceAt(i);
            try
            {
                outs.push(execFileSync(process.execPath, [SEED, act, '--selection', path.join(work, 'sel.txt'), ...(src ? ['--source', src] : []), ...argsAt(i)],
                    { cwd: repo, env: envAt(i), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
                code = 0;
                err = '';
            }
            catch (e)
            {
                if (!failOk) throw e;
                outs.push(String(e.stdout || ''));
                code = e.status ?? 1;
                err = String(e.stderr || '');
            }
            steps.push(each(repo, steps.length));
        }
        const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
        return { calls, out: outs[outs.length - 1], outs, steps, result: inspect(repo), code, err };
    }
    finally { fs.rmSync(work, { recursive: true, force: true }); }
}

module.exports = { seedRun, POSIX_ONLY, scrubLegacyEnv };
