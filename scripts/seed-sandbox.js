// scripts/seed-sandbox.js - one throwaway project per case, for the tests that run the Node seed END TO
// END against a recording `claude`: every CLI call is logged, `plugin list --json` answers from a
// fixture, and the tools other layers reach for (uvx for the notes import, npx for the browser
// download, npm and curl for the pin lookups) answer 'no' - so no run reaches registry.npmjs.org or
// pypi.org unless a case hands in its own stub. The unit tests prove what each layer does with what it
// is handed; these prove the seed hands it. A shell-script stub cannot be spawned without a shell on
// Windows, so callers pass POSIX_ONLY as the test options.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SEED = path.join(__dirname, 'install', 'alfred-code.js');
const POSIX_ONLY = { skip: process.platform === 'win32' && 'the recording stub is a shell script' };

// `prepare(repo)` lays the project out before the run; `inspect(repo)` reads it after, before the
// sandbox is removed. `env` adds to (or, with undefined, removes from) the run's environment.
// `source: null` runs with no --source, so the seed resolves its own snapshot (the plugin cache under the
// sandbox account, which `prepare(repo, work)` can lay out). `tools` puts a stub on PATH per name (`{ npm: '<sh body>' }`), replacing the default 'no', for a case
// that needs a registry lookup to answer one fixed way. `action` may be a list - the runs share one sandbox, in order, and
// `each(repo, i)` reads the tree after run `i` (its answers come back as `steps`); `out` is the last
// run's output, `outs` every run's. `args` are appended to every run's command line.
function seedRun(action, selection, { plugins = '[]', env: extra = {}, tools = {}, source = ROOT, args = [], prepare = () => {}, inspect = () => null, each = () => null } = {})
{
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-sandbox-'));
    const repo = path.join(work, 'repo');
    fs.mkdirSync(repo);
    execFileSync('git', ['init', '-q', repo]);
    const bin = path.join(work, 'bin');
    fs.mkdirSync(bin);
    const log = path.join(work, 'claude-calls.log');
    fs.writeFileSync(path.join(work, 'plugins.json'), plugins);
    fs.writeFileSync(path.join(bin, 'claude'), ['#!/bin/sh', 'printf \'%s\\n\' "$*" >> "$CLAUDE_STUB_LOG"',
        'if [ "$1" = "plugin" ] && [ "$2" = "list" ]; then cat "$CLAUDE_STUB_PLUGINS"; fi', 'exit 0', ''].join('\n'), { mode: 0o755 });
    for (const tool of ['uvx', 'npx', 'npm', 'curl']) fs.writeFileSync(path.join(bin, tool), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    for (const [tool, body] of Object.entries(tools)) fs.writeFileSync(path.join(bin, tool), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(work, 'sel.txt'), selection);
    const env = { ...process.env, HOME: work, CLAUDE_CONFIG_DIR: path.join(work, 'acct'), PATH: bin + path.delimiter + process.env.PATH,
        CLAUDE_STUB_LOG: log, CLAUDE_STUB_PLUGINS: path.join(work, 'plugins.json') };
    // This runner may sit in a session whose account env carries real keys and stack settings - none
    // of them may reach the run, or land in the sandbox.
    for (const k of ['SENTRY_SLUG', 'SENTRY_ACCESS_TOKEN', 'CONTEXT7_API_KEY']) delete env[k];
    for (const k of Object.keys(env)) if (k.startsWith('ALFRED_CODE_')) delete env[k];
    for (const [k, v] of Object.entries(extra)) { if (v === undefined) delete env[k]; else env[k] = v; }
    try
    {
        prepare(repo, work);
        const outs = [];
        const steps = [];
        for (const act of [].concat(action))
        {
            outs.push(execFileSync(process.execPath, [SEED, act, '--selection', path.join(work, 'sel.txt'), ...(source ? ['--source', source] : []), ...args],
                { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
            steps.push(each(repo, steps.length));
        }
        const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
        return { calls, out: outs[outs.length - 1], outs, steps, result: inspect(repo) };
    }
    finally { fs.rmSync(work, { recursive: true, force: true }); }
}

module.exports = { seedRun, POSIX_ONLY };
