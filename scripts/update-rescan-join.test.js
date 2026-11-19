'use strict';
// THE UPDATE'S RESCAN-JOIN-FIT FLOW, END TO END (2026-11-19) - a root holds `agent aspnet-implementer`, `aspnet-verifier`
// and `rule markdown-docs`, and an Angular project below it, its own git repo, installed alone with the same selection.
// The cases run update-workspace.md's own commands in its order: plan --rescan, join, the root's installer run, the
// parent read, the evidence scan, stack-select --redundant, ignore, cascade. A sibling that recorded `role: standalone`
// is never a row. The source is a clean export, so this repo's machine-local `.mcp.json` cannot leak into the run.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { seedRun, POSIX_ONLY, scrubStackEnv } = require('./seed-sandbox.js');
const { cleanExport } = require('./clean-export.js');
const { putWorkspace } = require('./workspace-fixture.js');

const REPO = path.join(__dirname, '..');
const SCRIPTS = path.join(REPO, 'scripts');
const SELECTION = 'agent aspnet-implementer\nagent aspnet-verifier\nrule markdown-docs\n';
const COPY_ROUTE = { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' };
const PLUGINS = JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true, scope: 'user' }]);
const REDUNDANT_LINE = /^redundant: (\S+) (\S+) - /;

const SOURCE = fs.mkdtempSync(path.join(os.tmpdir(), 'rescan-join-source-'));
test.after(() => fs.rmSync(SOURCE, { recursive: true, force: true }));
cleanExport(REPO, SOURCE);

function layOutProjects(repo)
{
    const work = path.dirname(repo);
    const web = path.join(repo, 'web');
    fs.mkdirSync(web);
    execFileSync('git', ['init', '-q', web]);
    fs.writeFileSync(path.join(web, 'angular.json'), '{}\n');
    fs.writeFileSync(path.join(web, 'package.json'), JSON.stringify({ name: 'web', dependencies: { '@angular/core': '^19.0.0' } }));
    const standalone = path.join(repo, 'std');
    fs.mkdirSync(standalone);
    execFileSync('git', ['init', '-q', standalone]);
    return work;
}

// The environment the walk's own commands run in: the sandbox's, as seedRun builds it.
function walkEnv(work)
{
    const env = scrubStackEnv({ ...process.env, HOME: work, CLAUDE_CONFIG_DIR: path.join(work, 'acct'),
        PATH: `${path.join(work, 'bin')}${path.delimiter}${process.env.PATH}`,
        CLAUDE_STUB_LOG: path.join(work, 'claude-calls.log'), CLAUDE_STUB_PLUGINS: path.join(work, 'plugins.json') });
    for (const key of Object.keys(env)) if (key.startsWith('CLAUDE_CODE_')) delete env[key];
    return { ...env, ...COPY_ROUTE, ALFRED_CODE_WORKSPACE: '1', ALFRED_CODE_MEMORY_WARM: '0' };
}

const agentCopy = (project, name) => path.join(project, '.claude', 'agents', `${name}.md`);

test('update joins the project it finds below, checks its fit and ignores what it inherits and does not need', POSIX_ONLY, () =>
{
    const { result } = seedRun(['install', 'install', 'install'], SELECTION, {
        plugins: PLUGINS, env: COPY_ROUTE, source: SOURCE, cwds: ['repo', 'repo/web', 'repo/std'],
        prepare: (repo) => layOutProjects(repo),
        inspect(repo)
        {
            const work = path.dirname(repo);
            const env = walkEnv(work);
            const run = (script, args, cwd = repo) => execFileSync(process.execPath, [path.join(SCRIPTS, script), ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
            const workspace = (...args) => run('workspace.js', args);
            putWorkspace(path.join(repo, 'std'), { role: 'standalone' });

            const plan = workspace('plan', '--root', '.', '--rescan', '--source', SOURCE);
            const rows = [...plan.matchAll(/^rescan: (.+)$/gm)].map((m) => m[1]);
            const joined = workspace('join', '--root', 'web', '--answer', 'join');
            const scope = run('install/stamp.js', ['scope', '.']).trim();
            run('install/alfred-code.js', ['update', '--source', SOURCE, '--scope', scope, '--installed-only', '--keep-pins']);
            const parent = path.join(work, 'parent.json');
            run('install/alfred-code.js', ['update', '--source', SOURCE, '--scope', scope, '--installed-only', '--print-plan', '--plan-out', parent]);
            const found = path.join(work, 'found-1.json');
            run('scan-evidence.js', ['--root', 'web', '--catalog', path.join(SOURCE, 'meta', 'evidence.json'), '--out', found]);
            const redundant = run('stack-select.js', ['--redundant', '--installed', parent, '--found', found,
                '--recs', path.join(SOURCE, 'meta', 'recommendations.json'), '--graph', path.join(SOURCE, 'meta', 'stack-graph.json'), '--stacks', 'web-angular']);
            const lines = redundant.split('\n').filter((l) => REDUNDANT_LINE.test(l));
            const ignores = lines.map((l) => workspace('ignore', '--root', 'web', '--add', REDUNDANT_LINE.exec(l).slice(1, 3).join(' ')));
            const beforeCascade = { web: fs.existsSync(agentCopy(path.join(repo, 'web'), 'aspnet-implementer')) };
            const cascade = workspace('cascade', '--root', '.', '--source', SOURCE, '--answers', path.join(work, 'answers.json'));
            return {
                rows, joined, lines, ignores, cascade, beforeCascade,
                webImplementer: fs.existsSync(agentCopy(path.join(repo, 'web'), 'aspnet-implementer')),
                rootImplementer: fs.existsSync(agentCopy(repo, 'aspnet-implementer')),
                rootVerifier: fs.existsSync(agentCopy(repo, 'aspnet-verifier')),
            };
        },
    });
    assert.deepStrictEqual(result.rows, ['web'], 'the project with a recorded role is no row');
    assert.match(result.joined, /^role: child of /m);
    assert.match(result.joined, /^join: join$/m);
    assert.ok(result.lines.some((l) => l.startsWith('redundant: agent aspnet-implementer - ')), 'the child inherits a seat that fits no Angular stack');
    assert.ok(result.ignores.length === result.lines.length && result.ignores.every((out) => /^workspace: ignore \S+ \S+ added$/m.test(out)), 'each ignore is written');
    assert.match(result.cascade, /^cascade: web\tupdated$/m);
    assert.strictEqual(result.beforeCascade.web, true, 'the child installed the seat before it joined');
    assert.strictEqual(result.webImplementer, false, 'the ignored seat is gone from the child');
    assert.strictEqual(result.rootImplementer, true, 'the root keeps it');
    assert.strictEqual(result.rootVerifier, true, 'the root keeps its other seat');
});
