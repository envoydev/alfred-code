'use strict';
// The sandbox the remove-nested tests share (workspace-nested.test.js, workspace-nested-hard.test.js): a root install and, below it,
// a second install whose `.git` is deleted - the plain subfolder an older release left - plus the hash helpers that prove no
// byte outside that folder changed. Requiring it exports this tree to a temp folder (removed after the requiring file's tests).
const test = require('node:test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const { seedRun, scrubStackEnv } = require('./seed-sandbox.js');
const { cleanExport } = require('./clean-export.js');

const REPO = path.join(__dirname, '..');
const WORKSPACE = path.join(REPO, 'scripts', 'workspace.js');
const SELECTION = 'agent aspnet-implementer\nrule markdown-docs\n';
const COPY_ROUTE = { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' };
const PLUGINS = JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true, scope: 'user' }]);
const EXIT_REFUSED = 2;

const SOURCE = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-nested-source-'));
test.after(() => fs.rmSync(SOURCE, { recursive: true, force: true }));
cleanExport(REPO, SOURCE);

const hashOf = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const filesUnder = (dir, skip = () => false) => (!fs.existsSync(dir) ? [] : fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
{
    const at = path.join(dir, d.name);
    if (skip(at)) return [];
    return d.isDirectory() && !d.isSymbolicLink() ? filesUnder(at, skip) : [at];
}));
// Every file's hash under `dir` (a link by its target text), keyed by the path below `base`.
const treeHash = (dir, base, skip) => Object.fromEntries(filesUnder(dir, skip).sort().map((f) =>
    [path.relative(base, f), fs.lstatSync(f).isSymbolicLink() ? `link:${fs.readlinkSync(f)}` : hashOf(f)]));

function layOutNested(repo)
{
    const pkg = path.join(repo, 'pkg');
    fs.mkdirSync(pkg);
    execFileSync('git', ['init', '-q', pkg]);
}

function sandboxEnv(work)
{
    const env = scrubStackEnv({ ...process.env, HOME: work, CLAUDE_CONFIG_DIR: path.join(work, 'acct'),
        PATH: `${path.join(work, 'bin')}${path.delimiter}${process.env.PATH}`,
        CLAUDE_STUB_LOG: path.join(work, 'claude-calls.log'), CLAUDE_STUB_PLUGINS: path.join(work, 'plugins.json') });
    for (const key of Object.keys(env)) if (key.startsWith('CLAUDE_CODE_')) delete env[key];
    return { ...env, ...COPY_ROUTE, ALFRED_CODE_WORKSPACE: '1', ALFRED_CODE_MEMORY_WARM: '0' };
}

// The two installs, `repo` and `repo/pkg`; `inspect(repo, run)` sees them with pkg's `.git` gone, `run(args)` being
// workspace.js in the repo with the sandbox's environment: { code, out }.
function withNested(inspect)
{
    return seedRun(['install', 'install'], SELECTION, {
        plugins: PLUGINS, env: COPY_ROUTE, source: SOURCE, cwds: ['repo', 'repo/pkg'], prepare: layOutNested,
        inspect(repo)
        {
            const work = path.dirname(repo);
            fs.rmSync(path.join(repo, 'pkg', '.git'), { recursive: true, force: true });
            const run = (args, cwd = repo) =>
            {
                const got = spawnSync(process.execPath, [WORKSPACE, ...args], { cwd, env: sandboxEnv(work), encoding: 'utf8' });
                return { code: got.status, out: String(got.stdout || ''), err: String(got.stderr || '') };
            };
            return inspect(repo, run, work);
        },
    }).result;
}

module.exports = { SOURCE, WORKSPACE, SELECTION, COPY_ROUTE, PLUGINS, EXIT_REFUSED, hashOf, treeHash, layOutNested, sandboxEnv, withNested, seedRun };
