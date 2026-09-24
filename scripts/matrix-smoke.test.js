'use strict';
// THE MATRIX SLICE CI RUNS. The temp-project matrix in CLAUDE.md stays mandatory by hand before every
// commit; this pins the three cases that regress most, on every push, on both delivery routes: a fresh
// install lands what it claims, a re-run changes nothing, and a project's own MCP server, settings key
// and hook survive the installer's merge. Each case drives the Node seed end to end inside the
// recording sandbox the other seed tests use (seed-sandbox.js): isolated HOME and CLAUDE_CONFIG_DIR, a
// stub `claude`, and every outward tool (npm and curl for the pin lookups, uvx, npx) answering 'no' by
// the sandbox's own default, so no registry is reached and no account on the machine is read or written.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');

const ROOT = path.join(__dirname, '..');
const SELECTION = 'skill markdown-style\nrule markdown-docs\nhook guard-secret-value\nmcp serena\nmcp context7\nmcp memory\n';
const ROUTES = {
    plugin: {},
    copy: { ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' },
};
const STAMP = path.join('repo', '.claude', 'alfred-code.stamp');
const LOCKED = ['serena', 'context7', 'memory'];

// Every file the sandbox holds after a run - the project (its .git aside) AND the HOME around it, where
// the account dir lives - so a write that lands outside the project is counted too. The stub's own call
// log grows by design and is left out.
function tree(repo)
{
    const work = path.dirname(repo);
    const files = {};
    (function walk(dir)
    {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }))
        {
            const abs = path.join(dir, e.name);
            const rel = path.relative(work, abs);
            if (rel === path.join('repo', '.git') || rel === 'claude-calls.log') continue;
            if (e.isDirectory()) walk(abs);
            else files[rel] = fs.readFileSync(abs, 'utf8');
        }
    })(work);
    return files;
}
const untimed = (stamp) => stamp.replace(/^installed: .*$/m, 'installed: <time>');
const json = (repo, rel) => JSON.parse(fs.readFileSync(path.join(repo, rel), 'utf8'));
const run = (actions, route, extra = {}) => seedRun(actions, SELECTION, { env: ROUTES[route], ...extra });

for (const route of Object.keys(ROUTES))
{
    test(`matrix ${route} route: a fresh install lands the picks, the seeds and a stamp naming the run`, POSIX_ONLY, () =>
    {
        const { result, calls } = run('install', route, {
            inspect: (repo) => ({
                rule: fs.readFileSync(path.join(repo, '.claude', 'rules', 'markdown-docs.md'), 'utf8'),
                claudeMd: fs.existsSync(path.join(repo, '.claude', 'CLAUDE.md')),
                engines: ['docs.js', 'memory.js', 'model-windows.json'].filter((f) => fs.existsSync(path.join(repo, '.claude', 'hooks', f))),
                stamp: fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8'),
                settings: json(repo, path.join('.claude', 'settings.json')),
                skill: fs.existsSync(path.join(repo, '.claude', 'skills', 'markdown-style', 'SKILL.md')),
                mcp: fs.existsSync(path.join(repo, '.mcp.json')) ? json(repo, '.mcp.json') : null,
            }),
        });
        assert.strictEqual(result.rule, fs.readFileSync(path.join(ROOT, 'stack', 'rules', 'markdown-docs.md'), 'utf8'), 'the picked rule landed byte for byte');
        assert.ok(result.claudeMd, 'the CLAUDE.md seed landed');
        assert.deepStrictEqual(result.engines, ['docs.js', 'memory.js', 'model-windows.json'], 'both hook engines and the window table are copied on every route');
        assert.match(result.stamp, /^action: install$/m, 'the stamp names the action');
        assert.match(result.stamp, /^picked-skills: markdown-style@/m, 'the stamp records the pick');
        assert.strictEqual(result.settings.env.ALFRED_CODE_DOCS_PATH, '.claude/docs', 'the settings env is seeded');
        if (route === 'plugin')
        {
            assert.ok(calls.includes('plugin install alfred-code@envoydev --scope project -y'), 'the core entry is installed');
            assert.ok(!calls.some((c) => /-hooks@/.test(c)), 'no hooks entry is installed - the hooks ride the core');
            assert.ok(!result.skill, 'the plugin carries the skill - no copy lands');
            assert.strictEqual(result.mcp, null, 'nothing is registered in .mcp.json on the plugin route');
        }
        else
        {
            assert.ok(result.skill, 'the skill is copied');
            assert.deepStrictEqual(LOCKED.filter((n) => !(n in result.mcp.mcpServers)), [], 'the three locked servers are in .mcp.json');
            const wired = JSON.stringify(result.settings.hooks || {});
            assert.match(wired, /guard-secret-value\.js/, 'the picked hook is wired');
        }
    });

    test(`matrix ${route} route: a re-run changes nothing but the stamp's time`, POSIX_ONLY, () =>
    {
        const { steps } = run(['install', 'install', 'update', 'update'], route, { each: tree });
        const [first, again, update, updateAgain] = steps;
        assert.ok(first[STAMP], 'the first run wrote a stamp');
        const rest = (snap) => Object.fromEntries(Object.entries(snap).filter(([rel]) => rel !== STAMP));
        // Every file but the stamp is byte-identical across all four runs; the stamp differs only in its
        // time between two runs of one action (install and update each name themselves in it).
        assert.deepStrictEqual(rest(again), rest(first), 'a second install changed a file');
        assert.deepStrictEqual(rest(update), rest(first), 'an update over the install changed a file');
        assert.deepStrictEqual(rest(updateAgain), rest(update), 'a second update changed a file');
        assert.strictEqual(untimed(again[STAMP]), untimed(first[STAMP]), 'a second install changed the stamp beyond its time');
        assert.strictEqual(untimed(updateAgain[STAMP]), untimed(update[STAMP]), 'a second update changed the stamp beyond its time');
    });

    test(`matrix ${route} route: the project's own MCP server, settings key and hook survive install and update`, POSIX_ONLY, () =>
    {
        const OWN_SERVER = { type: 'stdio', command: 'node', args: ['tools/own-mcp.js'], env: { OWN_MODE: 'strict' } };
        const OWN_HOOK = { matcher: 'Bash', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/tools/own-hook.js"' }] };
        const prepare = (repo) =>
        {
            fs.mkdirSync(path.join(repo, '.claude'));
            fs.writeFileSync(path.join(repo, '.mcp.json'), `${JSON.stringify({ mcpServers: { 'own-server': OWN_SERVER } }, null, 2)}\n`);
            fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), `${JSON.stringify({
                includeCoAuthoredBy: false,
                env: { OWN_FLAG: 'on' },
                hooks: { PreToolUse: [OWN_HOOK] },
            }, null, 2)}\n`);
        };
        const own = (repo) =>
        {
            const settings = json(repo, path.join('.claude', 'settings.json'));
            return {
                server: json(repo, '.mcp.json').mcpServers['own-server'],
                key: settings.includeCoAuthoredBy,
                env: settings.env.OWN_FLAG,
                hook: (settings.hooks.PreToolUse || []).find((e) => JSON.stringify(e).includes('own-hook.js')),
                stack: settings.env.ALFRED_CODE_DOCS_PATH,
            };
        };
        const { steps } = run(['install', 'update'], route, { prepare, each: own });
        for (const [i, s] of steps.entries())
        {
            const act = i ? 'update' : 'install';
            assert.deepStrictEqual(s.server, OWN_SERVER, `${act}: the hand-added MCP server changed or vanished`);
            assert.strictEqual(s.key, false, `${act}: the project's own settings key changed or vanished`);
            assert.strictEqual(s.env, 'on', `${act}: the project's own env key changed or vanished`);
            assert.deepStrictEqual(s.hook, OWN_HOOK, `${act}: the project's own hook changed or vanished`);
            assert.strictEqual(s.stack, '.claude/docs', `${act}: the stack's own env was not merged in beside them`);
        }
    });
}
