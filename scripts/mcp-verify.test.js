'use strict';
// The update/install MCP verify pass, both twins. The bug it exists for: `claude mcp add` over an
// existing server name prints 'already exists' and exits 0, so a `remove` that did not take (an old
// CLI, a scope mismatch, a shadowing registration) is INDISTINGUISHABLE from a successful rewrite -
// the run reports the mcp refreshed and the stale entry survives forever (measured on a consuming
// project still carrying the pre-0.2.34 stdio sentry registration).
//
// The stub `claude` on PATH is exactly that failure: every CLI call exits 0 and writes nothing. A
// run against it must still leave .mcp.json in the manifest shape, because the verify pass reads the
// file back and repairs the one entry that drifted.
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pythonRequest } = require('../stack/mcp/uv-python.js');

const ROOT = path.join(__dirname, '..');
const SH = path.join(ROOT, 'scripts', 'os', 'claude-stack.sh');
const PS1 = path.join(ROOT, 'scripts', 'os', 'claude-stack.ps1');

// The ps1 twin runs where PowerShell is installed (windows-latest and macos-latest carry pwsh; a
// bare ubuntu does not) - a visible SKIP elsewhere, never a silent gap.
const hasPwsh = spawnSync('pwsh', ['-v'], { encoding: 'utf8' }).status === 0;
const skipNoPwsh = hasPwsh ? false : 'pwsh not installed - ps1 behavioral test skipped';

const SENTRY_URL = 'https://mcp.sentry.dev/mcp/${SENTRY_SLUG}';
const SENTRY_HDR = 'Sentry-Bearer ${SENTRY_ACCESS_TOKEN}';

// The registration the screenshot from a consuming project carried: the pre-0.2.34 stdio sentry,
// Windows-flavoured (cmd /c npx), with the retired SENTRY_HOST env.
const STALE_SENTRY = {
    type: 'stdio',
    command: 'cmd',
    args: ['/c', 'npx', '-y', '@sentry/mcp-server@latest'],
    env: { SENTRY_ACCESS_TOKEN: '${SENTRY_ACCESS_TOKEN}', SENTRY_HOST: '${SENTRY_HOST}' },
};
// A server the project added by hand - never a stack name, so the pass must not touch it.
const HAND_ADDED = { type: 'stdio', command: 'node', args: ['tools/my-server.js'] };

function sandbox(mcpServers)
{
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpv-'));
    const repo = path.join(work, 'repo');
    fs.mkdirSync(repo);
    execFileSync('git', ['init', '-q', repo]);
    const acct = path.join(work, 'acct');
    fs.mkdirSync(acct);
    const bin = path.join(work, 'bin');
    fs.mkdirSync(bin);
    const log = path.join(work, 'claude-calls.log');
    const plugins = path.join(work, 'plugins.json');
    fs.writeFileSync(plugins, '[]');
    // Stub CLI: logs every invocation, answers `plugin list --json` from a fixture, exits 0 for
    // everything else - the silent-no-op the real CLI performs on `mcp add` over an existing name.
    // `mcp get` answers from a fixture when one is set (the user-scope route reads shapes through it)
    // and `mcp add` promotes the 'after' fixture over it - a CLI whose add actually works.
    fs.writeFileSync(path.join(bin, 'claude'), [
        '#!/bin/sh',
        'printf \'%s\\n\' "$*" >> "$CLAUDE_STUB_LOG"',
        'if [ "$1" = "plugin" ] && [ "$2" = "list" ]; then cat "$CLAUDE_STUB_PLUGINS"; fi',
        'if [ "$1" = "mcp" ] && [ "$2" = "get" ] && [ -s "$CLAUDE_STUB_MCPGET" ]; then cat "$CLAUDE_STUB_MCPGET"; fi',
        'if [ "$1" = "mcp" ] && [ "$2" = "list" ] && [ -s "$CLAUDE_STUB_MCPLIST" ]; then cat "$CLAUDE_STUB_MCPLIST"; fi',
        // a CLI whose `mcp remove` works at project scope - the real CLI's behaviour
        'if [ "$1" = "mcp" ] && [ "$2" = "remove" ] && [ "$CLAUDE_STUB_REMOVE_WORKS" = "1" ] && [ -f .mcp.json ]; then node -e \'const fs=require("fs");const d=JSON.parse(fs.readFileSync(".mcp.json","utf8"));delete d.mcpServers[process.argv[1]];fs.writeFileSync(".mcp.json",JSON.stringify(d,null,2)+"\\n")\' "$3"; fi',
        'if [ "$1" = "mcp" ] && [ "$2" = "add" ] && [ -s "$CLAUDE_STUB_MCPGET_NEW" ]; then cat "$CLAUDE_STUB_MCPGET_NEW" > "$CLAUDE_STUB_MCPGET"; fi',
        'exit 0',
        ''].join('\n'), { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'claude.cmd'), [
        '@echo off',
        '>>"%CLAUDE_STUB_LOG%" echo %*',
        'if "%~1"=="plugin" if "%~2"=="list" type "%CLAUDE_STUB_PLUGINS%"',
        'if "%~1"=="mcp" if "%~2"=="get" if exist "%CLAUDE_STUB_MCPGET%" type "%CLAUDE_STUB_MCPGET%"',
        'if "%~1"=="mcp" if "%~2"=="list" if exist "%CLAUDE_STUB_MCPLIST%" type "%CLAUDE_STUB_MCPLIST%"',
        'if "%~1"=="mcp" if "%~2"=="add" if exist "%CLAUDE_STUB_MCPGET_NEW%" copy /y "%CLAUDE_STUB_MCPGET_NEW%" "%CLAUDE_STUB_MCPGET%" >nul',
        // the same working `mcp remove` as the sh stub: without it a ps1 prune that relies on the CLI alone passes everywhere but Windows
        'if "%~1"=="mcp" if "%~2"=="remove" if "%CLAUDE_STUB_REMOVE_WORKS%"=="1" if exist .mcp.json node "%~dp0mcp-remove.js" "%~3"',
        'exit /b 0',
        ''].join('\r\n'));
    fs.writeFileSync(path.join(bin, 'mcp-remove.js'),
        'const fs=require("fs");const d=JSON.parse(fs.readFileSync(".mcp.json","utf8"));delete d.mcpServers[process.argv[2]];fs.writeFileSync(".mcp.json",JSON.stringify(d,null,2)+"\\n");\n');
    // Stub npx: the playwright browser download is the one npx call a run makes - logged, never run.
    const npxLog = path.join(work, 'npx-calls.log');
    fs.writeFileSync(path.join(bin, 'npx'), ['#!/bin/sh', 'printf \'%s\\n\' "$*" >> "$NPX_STUB_LOG"', 'exit 0', ''].join('\n'), { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'npx.cmd'), ['@echo off', '>>"%NPX_STUB_LOG%" echo %*', 'exit /b 0', ''].join('\r\n'));
    const sel = path.join(work, 'sel.txt');
    fs.writeFileSync(sel, 'skill markdown-style\nrule markdown-docs\nhook guard-secret-value\nmcp sentry\nmcp serena\n');
    if (mcpServers) fs.writeFileSync(path.join(repo, '.mcp.json'), JSON.stringify({ mcpServers }, null, 2) + '\n');
    // The installer writes every key it finds in its launch environment, and this runner may itself
    // sit in a session whose account env carries the real ones - scrub them so no real value lands.
    const env = {
        ...process.env, HOME: work, USERPROFILE: work, CLAUDE_CONFIG_DIR: acct,
        PATH: bin + path.delimiter + process.env.PATH,
        CLAUDE_STUB_LOG: log, CLAUDE_STUB_PLUGINS: plugins,
        CLAUDE_STUB_MCPGET: path.join(work, 'mcp-get.txt'), CLAUDE_STUB_MCPGET_NEW: path.join(work, 'mcp-get-after.txt'),
        CLAUDE_STUB_MCPLIST: path.join(work, 'mcp-list.txt'),
        NPX_STUB_LOG: npxLog,
        // This file is about the `claude mcp add` ROUTE - registering servers into .mcp.json, reading
        // them back, repairing drift, and the per-engine playwright expansion. From Phase 6 that route
        // is off by default: the eight servers arrive through the plugins named for them and the
        // installer registers nothing. The route still ships, still has to work for the migration
        // window, and this is what proves it - so every case here pins it ON, and the plugin-route
        // cases below turn it back off explicitly.
        CLAUDE_STACK_MCPS_VIA_PLUGIN: 'false',
        // The skills switch goes with it, for the reason Phase 6's R7 records: serena, context7 and
        // memory are plugins installed beside the core while ANY plugin route is on, and the
        // installer registers none of the three - registering as well would run each server twice. The full copy route is the only place their registrations
        // exist to be verified, which is what this file is for.
        CLAUDE_STACK_SKILLS_VIA_PLUGIN: 'false',
        CLAUDE_STACK_HOOKS_VIA_PLUGIN: 'false',
    };
    for (const k of ['SENTRY_SLUG', 'SENTRY_ACCESS_TOKEN', 'CONTEXT7_API_KEY']) delete env[k];
    return { work, repo, acct, sel, env, log, npxLog, plugins, mcpList: path.join(work, 'mcp-list.txt'), mcpGet: path.join(work, 'mcp-get.txt'), mcpGetAfter: path.join(work, 'mcp-get-after.txt') };
}

// The scope defaults to project and a caller passing its own (the global-install tests) replaces it -
// PowerShell rejects a parameter bound twice.
const runSh = (sb, action, args = [], scope = 'project') => execFileSync('bash', [SH, action, '--scope', scope, '--selection', sb.sel, '--source', ROOT, ...args],
    { cwd: sb.repo, encoding: 'utf8', env: sb.env });
const runPs = (sb, action, args = [], scope = 'project') => execFileSync('pwsh', ['-NoProfile', '-File', PS1, action, '-Scope', scope, '-Selection', sb.sel, '-Source', ROOT, ...args],
    { cwd: sb.repo, encoding: 'utf8', env: sb.env });

const servers = (sb) => JSON.parse(fs.readFileSync(path.join(sb.repo, '.mcp.json'), 'utf8')).mcpServers;

// The sandbox above pins the FULL COPY ROUTE, because that is what this file verifies. A handful of
// cases here are about the DEFAULT plugin routes instead (the hooks entry, the computed closure, the
// superpowers dependency, the shadow-copy prune) - they drop the pins and let the installer's own
// defaults decide.
const DEFAULT_ROUTES = (sb) =>
{
    delete sb.env.CLAUDE_STACK_MCPS_VIA_PLUGIN;
    delete sb.env.CLAUDE_STACK_SKILLS_VIA_PLUGIN;
    delete sb.env.CLAUDE_STACK_HOOKS_VIA_PLUGIN;
    return sb;
};
const calls = (sb) => (fs.existsSync(sb.log) ? fs.readFileSync(sb.log, 'utf8') : '');

function assertSentryRepaired(sb, out, twin)
{
    const s = servers(sb);
    assert.deepStrictEqual(s.sentry, { type: 'http', url: SENTRY_URL, headers: { Authorization: SENTRY_HDR } },
        `${twin}: the stale stdio sentry registration was not repaired`);
    assert.deepStrictEqual(s['hand-added'], HAND_ADDED, `${twin}: a hand-added server was rewritten`);
    assert.match(out, /mcp repaired: sentry/, `${twin}: the repair is not reported`);
}

function assertSerenaShape(sb, twin)
{
    const s = servers(sb);
    assert.strictEqual(s.serena.type, 'stdio', `${twin}: serena type`);
    assert.strictEqual(s.serena.command, 'uvx', `${twin}: serena command`);
    // Native separators on Windows: serena execs the TypeScript server through npm's .bin shim, and
    // cmd.exe reads an unquoted relative '.serena/home\\...' only as far as its first '/'.
    assert.deepStrictEqual(s.serena.env, { SERENA_HOME: process.platform === 'win32' ? '.serena\\home' : '.serena/home' }, `${twin}: serena env`);
    assert.deepStrictEqual(s.serena.args.slice(0, 2), ['--python', pythonRequest()], `${twin}: serena is not on the pinned Python`);
    // The version pin is resolved from the network and is empty offline - assert the shape, not the pin.
    assert.ok(s.serena.args.includes('--project-from-cwd'), `${twin}: serena args lost --project-from-cwd`);
    assert.ok(s.serena.args.includes('--context') && s.serena.args.includes('claude-code'), `${twin}: serena args lost the context`);
    assert.ok(!s.serena.args.includes('--project'), `${twin}: serena kept the retired --project flag`);
}

test('sh: update repairs a stale MCP registration the CLI silently refused to rewrite', () =>
{
    const sb = sandbox({ sentry: STALE_SENTRY, 'hand-added': HAND_ADDED });
    try
    {
        const out = runSh(sb, 'update');
        assertSentryRepaired(sb, out, 'sh');
        assert.match(calls(sb), /mcp remove sentry/, 'sh: the CLI route still runs first');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('sh: install repairs it too - install SKIPS a name the CLI reports as already configured', () =>
{
    const sb = sandbox({ sentry: STALE_SENTRY, 'hand-added': HAND_ADDED });
    try
    {
        const out = runSh(sb, 'install');
        assertSentryRepaired(sb, out, 'sh');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('sh: a stdio server drifted off the manifest args is rewritten to the current spec', () =>
{
    const stale = { type: 'stdio', command: 'uvx', args: ['--from', 'serena-agent', 'serena', 'start-mcp-server', '--project', '${CLAUDE_PROJECT_DIR}'], env: {} };
    const sb = sandbox({ serena: stale, 'hand-added': HAND_ADDED });
    try
    {
        const out = runSh(sb, 'update');
        assertSerenaShape(sb, 'sh');
        assert.match(out, /mcp repaired: serena/, 'sh: the serena repair is not reported');
        assert.deepStrictEqual(servers(sb)['hand-added'], HAND_ADDED, 'sh: a hand-added server was rewritten');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('sh: a registration already in the manifest shape is left byte-identical and reported as nothing to repair', () =>
{
    const sb = sandbox({ sentry: STALE_SENTRY, 'hand-added': HAND_ADDED });
    try
    {
        runSh(sb, 'update');
        const first = fs.readFileSync(path.join(sb.repo, '.mcp.json'), 'utf8');
        const out = runSh(sb, 'update');
        assert.strictEqual(fs.readFileSync(path.join(sb.repo, '.mcp.json'), 'utf8'), first, 'sh: a no-drift run rewrote the file');
        assert.doesNotMatch(out, /mcp repaired:/, 'sh: a no-drift run claimed a repair');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('sh: update runs `plugin update` at the scope the plugin is actually installed at', () =>
{
    const sb = sandbox({ sentry: STALE_SENTRY });
    // A PICK, not superpowers: from Phase 4 superpowers arrives as the core entry's dependency and
    // never travels this loop, so it would prove nothing about the scope the loop passes.
    fs.writeFileSync(sb.sel, fs.readFileSync(sb.sel, 'utf8') + 'plugin security-guidance\n');
    // Installed at USER scope while the run is --scope project: today the run passes its own scope
    // and `claude plugin update --scope project` is a no-op, so the plugin stays on its old version.
    fs.writeFileSync(sb.plugins, JSON.stringify([
        { id: 'security-guidance@claude-plugins-official', version: '6.2.0', scope: 'user', enabled: true },
    ]));
    try
    {
        const out = runSh(sb, 'update');
        assert.match(calls(sb), /plugin update security-guidance@claude-plugins-official --scope user/, 'sh: the plugin was updated at the wrong scope');
        assert.match(out, /plugin security-guidance/, 'sh: the plugin version state is not reported');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

// Claude Code registers claude-plugins-official only on its first INTERACTIVE launch
// (code.claude.com/docs/en/plugins), so an install on a machine that never ran it interactively
// failed 5 of 6 plugins with 'not found in marketplace' (measured on a fresh config 2026-09-15).
for (const twin of ['sh', 'ps1'])
{
    test(`${twin}: install registers and refreshes the official marketplace before the first plugin install`, { skip: twin === 'ps1' && skipNoPwsh }, () =>
    {
        const sb = sandbox({ sentry: STALE_SENTRY });
        // A PICK: superpowers leaves this loop in Phase 4 (the core entry's dependency carries it).
        fs.writeFileSync(sb.sel, fs.readFileSync(sb.sel, 'utf8') + 'plugin security-guidance\n');
        try
        {
            twin === 'sh' ? runSh(sb, 'install') : runPs(sb, 'install');
            const log = calls(sb).split(/\r?\n/);
            const add = log.findIndex((l) => /^plugin marketplace add anthropics\/claude-plugins-official\b/.test(l));
            const upd = log.findIndex((l) => /^plugin marketplace update claude-plugins-official\b/.test(l));
            const inst = log.findIndex((l) => /^plugin install security-guidance@claude-plugins-official\b/.test(l));
            assert.ok(inst >= 0, `${twin}: the plugin was never installed:\n${log.join('\n')}`);
            assert.ok(add >= 0 && add < inst, `${twin}: the official marketplace is not added before the install`);
            assert.ok(upd >= 0 && upd < inst, `${twin}: the official marketplace is not refreshed before the install`);
        }
        finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
    });
}

// Phase 2 of the plugin migration: the thirteen wired hooks ship as claude-stack-hooks@claude-stack
// instead of being copied into .claude/hooks and wired in settings.json. The two routes are one
// switch (CLAUDE_STACK_HOOKS_VIA_PLUGIN), and both are proven here - the plugin one is the default.
for (const twin of ['sh', 'ps1'])
{
    test(`${twin}: the plugin route registers the stack marketplace, installs the hooks plugin, and copies no guard`, { skip: twin === 'ps1' && skipNoPwsh }, () =>
    {
        const sb = DEFAULT_ROUTES(sandbox({ sentry: STALE_SENTRY }));
        try
        {
            twin === 'sh' ? runSh(sb, 'install') : runPs(sb, 'install');
            const log = calls(sb).split(/\r?\n/);
            const add = log.findIndex((l) => /^plugin marketplace add envoydev\/claude-stack\b/.test(l));
            const upd = log.findIndex((l) => /^plugin marketplace update claude-stack\b/.test(l));
            const inst = log.findIndex((l) => /^plugin install claude-stack-hooks@claude-stack --scope project -y\b/.test(l));
            assert.ok(inst >= 0, `${twin}: the hooks plugin was never installed:\n${log.join('\n')}`);
            assert.ok(add >= 0 && add < inst, `${twin}: the stack marketplace is not added before the install`);
            assert.ok(upd >= 0 && upd < inst, `${twin}: the stack marketplace is not refreshed before the install`);
            const hooks = path.join(sb.repo, '.claude', 'hooks');
            const copied = fs.existsSync(hooks) ? fs.readdirSync(hooks).sort() : [];
            assert.ok(!copied.some((f) => f.startsWith('guard-')), `${twin}: a guard was copied on the plugin route: ${copied.join(' ')}`);
            const settings = JSON.parse(fs.readFileSync(path.join(sb.repo, '.claude', 'settings.json'), 'utf8'));
            assert.ok(!JSON.stringify(settings.hooks || {}).includes('.claude/hooks/guard-'), `${twin}: a guard was wired on the plugin route`);
            // The walk's hooks LAYER lands here now: this selection picked guard-secret-value alone,
            // so every OTHER shipped hook is what the user dropped, and that is the value.
            const off = String(settings.env.CLAUDE_STACK_HOOKS_OFF || '').split(',').filter(Boolean);
            assert.ok(off.length > 5, `${twin}: the dropped hooks did not reach CLAUDE_STACK_HOOKS_OFF: ${off.join(',')}`);
            assert.ok(!off.includes('guard-secret-value.js'), `${twin}: the SELECTED hook was switched off`);
            assert.ok(off.includes('guard-read-whole-file.js'), `${twin}: a dropped hook is missing from the value`);
        }
        finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
    });

    test(`${twin}: a selection that never answers the hooks layer leaves every hook running`, { skip: twin === 'ps1' && skipNoPwsh }, () =>
    {
        const sb = sandbox({ sentry: STALE_SENTRY });
        // No 'hook' line at all - the pre-layer shape, and what `update --installed-only` produces on
        // the plugin route, where no hook file is on disk to read back. It must NOT read as 'all off'.
        fs.writeFileSync(sb.sel, fs.readFileSync(sb.sel, 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('hook ')).join('\n'));
        try
        {
            twin === 'sh' ? runSh(sb, 'install') : runPs(sb, 'install');
            const settings = JSON.parse(fs.readFileSync(path.join(sb.repo, '.claude', 'settings.json'), 'utf8'));
            assert.strictEqual(settings.env.CLAUDE_STACK_HOOKS_OFF, '', `${twin}: an unanswered layer switched hooks off`);
        }
        finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
    });

    // Phase 3: the DEFAULT route. A picked skill is carried by the plugin its placement puts it in,
    // so it must not be copied as well - spike S6 measured that a leftover copy silently shadows the
    // plugin's own, with no error and no sign in the transcript.
    test(`${twin}: the plugin route enables the computed closure and copies no skill a plugin carries`, { skip: 'D1: the shell seed is refused from 2.0.0; the twin goes in 7b' }, () =>
    {
        const sb = DEFAULT_ROUTES(sandbox({ sentry: STALE_SENTRY }));
        try
        {
            twin === 'sh' ? runSh(sb, 'install') : runPs(sb, 'install');
            const log = calls(sb);
            assert.ok(/plugin marketplace add envoydev\/claude-stack/.test(log), `${twin}: the stack marketplace was never registered`);
            assert.ok(/plugin install claude-stack@claude-stack --scope project/.test(log), `${twin}: the core plugin was not installed at the run's scope`);
            assert.ok(!fs.existsSync(path.join(sb.repo, '.claude', 'skills', 'markdown-style')),
                `${twin}: a skill the core plugin carries was copied too, and would shadow it`);
            // and the selection is what decides: this one names no item outside the core, so no
            // per-stack entry may be enabled off the back of it.
            assert.ok(!/plugin install claude-stack-wpf@/.test(log), `${twin}: a stack no selection picked was installed`);
        }
        finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
    });

    test(`${twin}: the copy route touches no stack marketplace and still copies and wires the guard`, { skip: twin === 'ps1' && skipNoPwsh }, () =>
    {
        const sb = sandbox({ sentry: STALE_SENTRY });
        // BOTH route switches: from Phase 3 the skills and agents are served by the stack's own
        // marketplace too, so a run with only the hooks switch off still registers it. The claim
        // here is the whole 0.2.x route - nothing of the stack's own marketplace is touched.
        sb.env.CLAUDE_STACK_HOOKS_VIA_PLUGIN = 'false';
        sb.env.CLAUDE_STACK_SKILLS_VIA_PLUGIN = 'false';
        try
        {
            twin === 'sh' ? runSh(sb, 'install') : runPs(sb, 'install');
            const log = calls(sb);
            assert.ok(!/plugin marketplace add envoydev\/claude-stack/.test(log), `${twin}: the stack marketplace was registered on the copy route`);
            assert.ok(!/plugin install claude-stack-hooks/.test(log), `${twin}: the hooks plugin was installed on the copy route`);
            assert.ok(fs.existsSync(path.join(sb.repo, '.claude', 'hooks', 'guard-secret-value.js')), `${twin}: the selected guard was not copied`);
            const wired = JSON.stringify(JSON.parse(fs.readFileSync(path.join(sb.repo, '.claude', 'settings.json'), 'utf8')).hooks || {});
            assert.ok(wired.includes('.claude/hooks/guard-secret-value.js'), `${twin}: the selected guard was not wired`);
        }
        finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
    });
}

// ponytail left both PLUGINS lists in 0.2.7x but never joined RETIRED_PLUGINS, so every existing
// install kept it installed and enabled with no command able to remove it (measured 2026-09-15).
for (const twin of ['sh', 'ps1'])
{
    test(`${twin}: update uninstalls a retired plugin at its own scope and leaves a user plugin alone`, { skip: twin === 'ps1' && skipNoPwsh }, () =>
    {
        const sb = sandbox({ sentry: STALE_SENTRY });
        fs.writeFileSync(sb.plugins, JSON.stringify([
            { id: 'ponytail@ponytail', version: '1.0.0', scope: 'user', enabled: true },
            { id: 'my-own@somewhere', version: '1.0.0', scope: 'project', enabled: true },
        ]));
        try
        {
            const out = twin === 'sh' ? runSh(sb, 'update') : runPs(sb, 'update');
            assert.match(calls(sb), /plugin uninstall ponytail --scope user/, `${twin}: the retired plugin was not uninstalled at its scope`);
            assert.doesNotMatch(calls(sb), /plugin uninstall my-own/, `${twin}: a user plugin was uninstalled`);
            assert.match(out, /plugin pruned \(retired upstream\) \[user\]: ponytail/, `${twin}: the prune is not logged`);
        }
        finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
    });
}

test('ps1: update repairs a stale MCP registration the CLI silently refused to rewrite (pwsh required)', { skip: skipNoPwsh }, () =>
{
    const sb = sandbox({ sentry: STALE_SENTRY, 'hand-added': HAND_ADDED });
    try
    {
        assertSentryRepaired(sb, runPs(sb, 'update'), 'ps1');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('ps1: install repairs it too, and a second run rewrites nothing (pwsh required)', { skip: skipNoPwsh }, () =>
{
    const sb = sandbox({ sentry: STALE_SENTRY, 'hand-added': HAND_ADDED });
    try
    {
        assertSentryRepaired(sb, runPs(sb, 'install'), 'ps1');
        const first = fs.readFileSync(path.join(sb.repo, '.mcp.json'), 'utf8');
        const out = runPs(sb, 'update');
        assert.strictEqual(fs.readFileSync(path.join(sb.repo, '.mcp.json'), 'utf8'), first, 'ps1: a no-drift run rewrote the file');
        assert.doesNotMatch(out, /mcp repaired:/, 'ps1: a no-drift run claimed a repair');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('ps1: a stdio server drifted off the manifest args is rewritten to the current spec (pwsh required)', { skip: skipNoPwsh }, () =>
{
    const stale = { type: 'stdio', command: 'uvx', args: ['--from', 'serena-agent', 'serena', 'start-mcp-server', '--project', '${CLAUDE_PROJECT_DIR}'], env: {} };
    const sb = sandbox({ serena: stale, 'hand-added': HAND_ADDED });
    try
    {
        runPs(sb, 'update');
        assertSerenaShape(sb, 'ps1');
        assert.deepStrictEqual(servers(sb)['hand-added'], HAND_ADDED, 'ps1: a hand-added server was rewritten');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('the repaired entries match byte-for-byte what `claude mcp add` itself writes', () =>
{
    // Captured from the real CLI (claude mcp add --transport http ... --header / -e K=V -- cmd args).
    // The verify pass writes these shapes without the CLI, so a drift in the CLI's format shows up here.
    const sb = sandbox({ context7: { type: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'], env: {} } });
    fs.writeFileSync(sb.sel, 'skill markdown-style\nrule markdown-docs\nhook guard-secret-value\nmcp context7\n');
    try
    {
        runSh(sb, 'update');
        assert.deepStrictEqual(servers(sb).context7, {
            type: 'http',
            url: 'https://mcp.context7.com/mcp',
            headers: { CONTEXT7_API_KEY: '${CONTEXT7_API_KEY:-}' },
        }, 'sh: the context7 remote registration is not the shape the CLI writes');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('ps1 leaves a project the sh twin already repaired untouched (cross-OS parity)', { skip: skipNoPwsh }, () =>
{
    // A repo shared by a macOS and a Windows developer: whichever twin runs second must agree that
    // the entry is already the manifest shape, or every update flips the file back and forth.
    const sb = sandbox({ sentry: STALE_SENTRY, 'hand-added': HAND_ADDED });
    try
    {
        runSh(sb, 'update');
        const afterSh = fs.readFileSync(path.join(sb.repo, '.mcp.json'), 'utf8');
        const out = runPs(sb, 'update');
        assert.doesNotMatch(out, /mcp repaired:/, 'ps1: rewrote what the sh twin had already repaired');
        assert.strictEqual(fs.readFileSync(path.join(sb.repo, '.mcp.json'), 'utf8'), afterSh, 'ps1: reformatted the file the sh twin wrote');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

// --- user scope (a global install) ------------------------------------------------------------
// There is no .mcp.json to own: the registration lives in the account config, which the installers
// never hand-edit. The shape is read through `claude mcp get` and a mismatch is retried once.
const GET_STALE = [
    'sentry:', '  Scope: User config', '  Type: stdio',
    '  Command: cmd', '  Args: /c npx -y @sentry/mcp-server@latest', '',
].join('\n');
const GET_FIXED = [
    'sentry:', '  Scope: User config', '  Type: http',
    `  URL: ${SENTRY_URL}`, '',
].join('\n');
const userSel = 'skill markdown-style\nmcp sentry\n';

// `claude mcp get` (CLI 2.1.272) PRINTS a stored `${VAR:-default}` as `${VAR}` - the stored entry keeps the
// default. Compared as printed, every global install flagged the playwright servers as drifted,
// re-registered them and failed the run (measured on a fresh account 2026-09-15).
for (const twin of ['sh', 'ps1'])
{
    test(`${twin}: user scope - a \${VAR:-default} argument printed as \${VAR} by \`mcp get\` is not drift`, { skip: twin === 'ps1' && skipNoPwsh }, () =>
    {
        const sb = sandbox();
        fs.writeFileSync(sb.sel, 'skill markdown-style\nmcp playwright\n');
        // pin the resolved version so the expected args are fixed offline (npm.cmd: native pwsh on Windows
        // resolves a command through PATHEXT and never runs the extensionless script)
        fs.writeFileSync(path.join(sb.work, 'bin', 'npm'), ['#!/bin/sh', 'echo 0.0.80', ''].join('\n'), { mode: 0o755 });
        fs.writeFileSync(path.join(sb.work, 'bin', 'npm.cmd'), ['@echo off', 'echo 0.0.80', ''].join('\r\n'));
        // the ps1 twin on Windows registers npx through `cmd /c` (a spawned stdio server cannot resolve
        // npx.cmd), so the CLI prints that shape back
        const winPs = twin === 'ps1' && process.platform === 'win32';
        fs.writeFileSync(sb.mcpGet, ['playwright-chrome:', '  Scope: User config (available in all your projects)', '  Status: ✔ Connected', '  Type: stdio', `  Command: ${winPs ? 'cmd' : 'npx'}`,
            `  Args: ${winPs ? '/c npx ' : ''}-y @playwright/mcp@0.0.80 --browser chrome --user-data-dir \${CLAUDE_PROJECT_DIR}/.playwright/chrome --output-dir \${CLAUDE_PROJECT_DIR}/.playwright/output`,
            '  Environment:', ''].join('\n'));
        try
        {
            const out = twin === 'sh' ? runSh(sb, 'install', ['--playwright-browsers', 'chrome'], 'global')
                : runPs(sb, 'install', ['-PlaywrightBrowsers', 'chrome'], 'global');
            assert.doesNotMatch(out, /shape drifted at user scope: playwright-chrome/, `${twin}: the printed \${VAR} form read as drift:\n${out.split('\n').filter((l) => /playwright/.test(l)).join('\n')}`);
            assert.doesNotMatch(out, /mcp playwright-chrome could not be brought/, `${twin}: the run failed on it`);
        }
        finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
    });
}

// install is the route that reaches this branch: it SKIPS the add for a name the CLI already
// reports as configured, so an old-shaped registration survives it untouched until the verify pass.
test('sh: a user-scope registration in the old shape is re-registered through the CLI and confirmed', () =>
{
    const sb = sandbox();
    fs.writeFileSync(sb.sel, userSel);
    fs.writeFileSync(sb.mcpGet, GET_STALE);
    fs.writeFileSync(sb.mcpGetAfter, GET_FIXED);
    try
    {
        const out = runSh(sb, 'install', [], 'global');
        assert.match(out, /mcp shape drifted at user scope: sentry/, 'sh: the drift was not detected at user scope');
        assert.match(out, /mcp repaired: sentry \(user scope\)/, 'sh: the retry was not confirmed');
        assert.strictEqual(fs.readFileSync(sb.mcpGet, 'utf8'), GET_FIXED, 'sh: the CLI was not re-run');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('sh: a user-scope registration the retry cannot fix is reported, never silently accepted', () =>
{
    const sb = sandbox();
    fs.writeFileSync(sb.sel, userSel);
    fs.writeFileSync(sb.mcpGet, GET_STALE);   // no 'after' fixture: the CLI keeps reporting the old shape
    try
    {
        const out = runSh(sb, 'update', [], 'global');
        assert.match(out, /could not be brought to the current shape at user scope/, 'sh: an unrepairable registration was not reported');
        assert.match(out, /item\(s\) failed above/, 'sh: it did not count as a run failure');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('ps1: a user-scope registration in the old shape is re-registered through the CLI and confirmed (pwsh required)', { skip: skipNoPwsh }, () =>
{
    const sb = sandbox();
    fs.writeFileSync(sb.sel, userSel);
    fs.writeFileSync(sb.mcpGet, GET_STALE);
    fs.writeFileSync(sb.mcpGetAfter, GET_FIXED);
    try
    {
        const out = runPs(sb, 'install', [], 'global');
        assert.match(out, /mcp shape drifted at user scope: sentry/, 'ps1: the drift was not detected at user scope');
        assert.match(out, /mcp repaired: sentry \(user scope\)/, 'ps1: the retry was not confirmed');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

// --- playwright engines ---------------------------------------------------------------------
// One server drives ONE browser (--browser, fixed at launch), so the manifest's single `playwright`
// entry expands into one registration per kept engine: playwright-chrome / -msedge / -firefox /
// -webkit, each with an explicit --browser and its own profile folder. Disabling is the user's
// `/mcp disable`, which the close prints when an enabled engine is named - the installer writes no
// toggle state. A legacy `playwright` registration is migrated to its engine and removed.
const pwSel = 'skill markdown-style\nmcp playwright\n';
const PW_DIR = '${CLAUDE_PROJECT_DIR:-.}/.playwright';
const npxCalls = (sb) => (fs.existsSync(sb.npxLog) ? fs.readFileSync(sb.npxLog, 'utf8') : '');
const pwNames = (sb) => Object.keys(servers(sb)).filter((n) => n.startsWith('playwright')).sort();
const pwServer = (engine, pin = '0.0.80') => ({
    type: 'stdio', command: 'npx', env: {},
    args: ['-y', `@playwright/mcp@${pin}`, '--browser', engine, '--user-data-dir', `${PW_DIR}/${engine}`, '--output-dir', `${PW_DIR}/output`],
});
const LEGACY_PW = (browserArgs = []) => ({
    type: 'stdio', command: 'npx', env: {},
    args: ['-y', '@playwright/mcp@0.0.70', ...browserArgs, '--user-data-dir', PW_DIR, '--output-dir', `${PW_DIR}/output`],
});

function assertPwEngine(sb, engine, twin)
{
    const a = servers(sb)[`playwright-${engine}`].args;
    assert.strictEqual(a[a.indexOf('--browser') + 1], engine, `${twin}: playwright-${engine} lost --browser ${engine}`);
    assert.strictEqual(a[a.indexOf('--user-data-dir') + 1], `${PW_DIR}/${engine}`, `${twin}: ${engine} needs its own profile folder`);
    assert.strictEqual(a[a.indexOf('--output-dir') + 1], `${PW_DIR}/output`, `${twin}: the output dir is shared and unchanged`);
    assert.ok(/^@playwright\/mcp(@\S+)?$/.test(a[a.indexOf('--browser') - 1]), `${twin}: --browser must follow the package`);
}

test('sh: playwright defaults to one playwright-chrome server with an explicit --browser', () =>
{
    const sb = sandbox();
    fs.writeFileSync(sb.sel, pwSel);
    try
    {
        const out = runSh(sb, 'install');
        assert.deepStrictEqual(pwNames(sb), ['playwright-chrome'], 'sh: the default is exactly one chrome server');
        assertPwEngine(sb, 'chrome', 'sh');
        assert.doesNotMatch(npxCalls(sb), /playwright install/, 'sh: chrome uses the machine\'s Chrome - nothing to download');
        assert.match(out, /playwright=chrome/, 'sh: the summary does not name the engine');
        assert.doesNotMatch(out, /\/mcp disable/, 'sh: nothing to disable with one engine');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('sh: several engines register one server each, download their builds, and print the disable lines', () =>
{
    const sb = sandbox();
    fs.writeFileSync(sb.sel, pwSel);
    try
    {
        const out = runSh(sb, 'install', ['--playwright-browsers', 'WebKit,chrome,firefox', '--playwright-enabled', 'firefox']);
        assert.deepStrictEqual(pwNames(sb), ['playwright-chrome', 'playwright-firefox', 'playwright-webkit'], 'sh: one server per kept engine');
        for (const e of ['chrome', 'firefox', 'webkit']) assertPwEngine(sb, e, 'sh');
        assert.match(npxCalls(sb), /-p @playwright\/mcp(@\S+)? playwright install firefox/, 'sh: firefox was not downloaded through the server\'s own playwright');
        assert.match(npxCalls(sb), /-p @playwright\/mcp(@\S+)? playwright install webkit/, 'sh: webkit was not downloaded');
        assert.match(out, /\/mcp disable playwright-chrome/, 'sh: the close does not tell the user to disable chrome');
        assert.match(out, /\/mcp disable playwright-webkit/, 'sh: the close does not tell the user to disable webkit');
        assert.doesNotMatch(out, /\/mcp disable playwright-firefox/, 'sh: the enabled engine must stay on');
        const enabled = JSON.parse(fs.readFileSync(path.join(sb.repo, '.claude', 'settings.json'), 'utf8')).enabledMcpjsonServers;
        for (const e of ['chrome', 'firefox', 'webkit']) assert.ok(enabled.includes(`playwright-${e}`), `sh: playwright-${e} is not pre-approved`);
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('sh: update migrates a legacy `playwright` registration to its engine and removes the old name', () =>
{
    const sb = sandbox({ playwright: LEGACY_PW(['--browser', 'webkit']), 'hand-added': HAND_ADDED });
    fs.writeFileSync(sb.sel, pwSel);
    try
    {
        runSh(sb, 'update');
        assert.deepStrictEqual(pwNames(sb), ['playwright-webkit'], 'sh: the legacy server was not migrated to its engine');
        assertPwEngine(sb, 'webkit', 'sh');
        assert.deepStrictEqual(servers(sb)['hand-added'], HAND_ADDED, 'sh: a hand-added server was touched');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

// Measured 2026-09-15 on temp projects with the real CLI.
for (const twin of ['sh', 'ps1'])
{
    const skip = twin === 'ps1' && skipNoPwsh;
    const go = (sb, action, args = [], scope) => (twin === 'sh' ? runSh(sb, action, args, scope) : runPs(sb, action, args.map((a) => a
        .replace('--playwright-browsers', '-PlaywrightBrowsers').replace('--playwright-enabled', '-PlaywrightEnabled')), scope));

    // sh read `playwright: ... --browser webkit` off `claude mcp list` as BOTH webkit and chrome: the
    // chrome fallback in the sed tested the line the webkit substitution had just rewritten.
    test(`${twin}: global scope - a legacy \`playwright --browser webkit\` read off \`claude mcp list\` is webkit only`, { skip }, () =>
    {
        const sb = sandbox();
        fs.writeFileSync(sb.sel, pwSel);
        fs.writeFileSync(sb.mcpList, 'Checking MCP server health...\n\nplaywright: npx -y @playwright/mcp@0.0.70 --browser webkit --user-data-dir x - ✓ Connected\n');
        try
        {
            go(sb, 'update', [], 'global');
            const adds = calls(sb).split(/\r?\n/).filter((l) => /^mcp add .*playwright-/.test(l));
            assert.ok(adds.some((l) => /playwright-webkit/.test(l)), `${twin}: webkit not registered:\n${adds.join('\n')}`);
            assert.ok(!adds.some((l) => /playwright-chrome/.test(l)), `${twin}: a stray chrome server was registered:\n${adds.join('\n')}`);
        }
        finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
    });

    // With a CLI whose remove WORKS, sh's report step found nothing left and printed nothing.
    test(`${twin}: a dropped engine is reported removed when the CLI remove itself succeeded`, { skip }, () =>
    {
        const sb = sandbox({ 'playwright-chrome': pwServer('chrome'), 'playwright-firefox': pwServer('firefox'), 'hand-added': HAND_ADDED });
        fs.writeFileSync(sb.sel, pwSel);
        sb.env.CLAUDE_STUB_REMOVE_WORKS = '1';
        try
        {
            const out = go(sb, 'update', ['--playwright-browsers', 'chrome']);
            assert.deepStrictEqual(pwNames(sb), ['playwright-chrome'], `${twin}: firefox was not removed`);
            assert.match(out, /mcp removed: playwright-firefox/, `${twin}: the removal is not reported`);
            assert.deepStrictEqual(servers(sb)['hand-added'], HAND_ADDED, `${twin}: a hand-added server was touched`);
        }
        finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
    });

    test(`${twin}: a legacy \`--browser=<engine>\` keeps its engine`, { skip }, () =>
    {
        const sb = sandbox({ playwright: LEGACY_PW(['--browser=webkit']) });
        fs.writeFileSync(sb.sel, pwSel);
        try
        {
            go(sb, 'update');
            assert.deepStrictEqual(pwNames(sb), ['playwright-webkit'], `${twin}: --browser=webkit migrated to the wrong engine`);
        }
        finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
    });

    test(`${twin}: an explicitly EMPTY engine flag is an error, never 'no flag'`, { skip }, () =>
    {
        const sb = sandbox();
        fs.writeFileSync(sb.sel, pwSel);
        try
        {
            const flagSets = twin === 'sh'
                ? [['--playwright-browsers', ''], ['--playwright-browsers='], ['--playwright-browsers', ','], ['--playwright-enabled=']]
                : [['-PlaywrightBrowsers', ''], ['-PlaywrightBrowsers', ','], ['-PlaywrightEnabled', '']];
            for (const flags of flagSets)
            {
                const r = twin === 'sh'
                    ? spawnSync('bash', [SH, 'install', '--scope', 'project', '--selection', sb.sel, '--source', ROOT, ...flags], { cwd: sb.repo, encoding: 'utf8', env: sb.env })
                    : spawnSync('pwsh', ['-NoProfile', '-File', PS1, 'install', '-Scope', 'project', '-Selection', sb.sel, '-Source', ROOT, ...flags], { cwd: sb.repo, encoding: 'utf8', env: sb.env });
                assert.strictEqual(r.status, 1, `${twin} ${JSON.stringify(flags)}: exit ${r.status}, expected 1`);
                assert.ok(!fs.existsSync(path.join(sb.repo, '.mcp.json')), `${twin} ${JSON.stringify(flags)}: nothing may run before the error`);
            }
        }
        finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
    });
}

test('sh: a legacy `playwright` with no --browser migrates to chrome', () =>
{
    const sb = sandbox({ playwright: LEGACY_PW() });
    fs.writeFileSync(sb.sel, pwSel);
    try
    {
        runSh(sb, 'update');
        assert.deepStrictEqual(pwNames(sb), ['playwright-chrome'], 'sh: a flagless legacy server is chrome');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('sh: update with no flag keeps the registered set and prints no disable lines', () =>
{
    const sb = sandbox({ 'playwright-chrome': pwServer('chrome'), 'playwright-firefox': pwServer('firefox') });
    fs.writeFileSync(sb.sel, pwSel);
    try
    {
        const out = runSh(sb, 'update');
        assert.deepStrictEqual(pwNames(sb), ['playwright-chrome', 'playwright-firefox'], 'sh: update changed the kept set');
        assert.doesNotMatch(out, /\/mcp disable/, 'sh: update must never re-ask the user to toggle');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('sh: dropping an engine removes its server; --playwright-enabled alone adds to the set', () =>
{
    const sb = sandbox({ 'playwright-chrome': pwServer('chrome'), 'playwright-firefox': pwServer('firefox') });
    fs.writeFileSync(sb.sel, pwSel);
    try
    {
        runSh(sb, 'update', ['--playwright-browsers', 'chrome']);
        assert.deepStrictEqual(pwNames(sb), ['playwright-chrome'], 'sh: the dropped firefox server survived');
        const out = runSh(sb, 'update', ['--playwright-enabled', 'msedge']);
        assert.deepStrictEqual(pwNames(sb), ['playwright-chrome', 'playwright-msedge'], 'sh: an enabled engine outside the set was not added');
        assert.match(out, /\/mcp disable playwright-chrome/, 'sh: the switch does not print the disable line');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('sh: unknown engines and an enabled engine outside the list are rejected before anything runs', () =>
{
    const sb = sandbox();
    try
    {
        const run = (...args) => spawnSync('bash', [SH, 'install', '--scope', 'project', '--selection', sb.sel, '--source', ROOT, ...args],
            { cwd: sb.repo, encoding: 'utf8', env: sb.env });
        const bad = run('--playwright-browsers', 'chrome,safari');
        assert.notStrictEqual(bad.status, 0, 'sh: safari was accepted');
        assert.match(bad.stderr, /--playwright-browsers takes chrome, msedge, firefox, webkit/, 'sh: the error does not list the choices');
        const outside = run('--playwright-browsers', 'chrome', '--playwright-enabled', 'webkit');
        assert.notStrictEqual(outside.status, 0, 'sh: an enabled engine outside the list was accepted');
        assert.match(outside.stderr, /--playwright-enabled must be one of the kept engines/, 'sh: the error does not say why');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('sh: --installed-only reads playwright-* servers back as the one manifest entry', () =>
{
    const sb = sandbox({ 'playwright-firefox': pwServer('firefox') });
    fs.mkdirSync(path.join(sb.repo, '.claude', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(sb.repo, '.claude', 'rules', 'markdown-docs.md'), 'x\n');   // installed-only needs an install to read
    try
    {
        const r = spawnSync('bash', [SH, 'update', '--scope', 'project', '--installed-only', '--print-plan', '--source', ROOT],
            { cwd: sb.repo, encoding: 'utf8', env: sb.env });
        const plan = (r.stdout.match(/^plan mcps:(.*)$/m) || [])[1] || '';
        assert.match(plan, /(^| )playwright( |$)/, `sh: the plan lost playwright (${plan})`);
        assert.doesNotMatch(plan, /playwright-firefox/, 'sh: a registration name leaked into the manifest plan');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('ps1: several engines, their downloads and disable lines, and the legacy migration (pwsh required)', { skip: skipNoPwsh }, () =>
{
    const sb = sandbox({ playwright: LEGACY_PW(['--browser', 'firefox']) });
    fs.writeFileSync(sb.sel, pwSel);
    try
    {
        runPs(sb, 'update');
        assert.deepStrictEqual(pwNames(sb), ['playwright-firefox'], 'ps1: the legacy server was not migrated to its engine');
        const out = runPs(sb, 'update', ['-PlaywrightBrowsers', 'webkit,firefox', '-PlaywrightEnabled', 'WebKit']);
        assert.deepStrictEqual(pwNames(sb), ['playwright-firefox', 'playwright-webkit'], 'ps1: one server per kept engine');
        for (const e of ['firefox', 'webkit']) assertPwEngine(sb, e, 'ps1');
        assert.match(npxCalls(sb), /-p @playwright\/mcp(@\S+)? playwright install webkit/, 'ps1: webkit was not downloaded');
        assert.match(out, /\/mcp disable playwright-firefox/, 'ps1: the close does not print the disable line');
        assert.doesNotMatch(out, /\/mcp disable playwright-webkit/, 'ps1: the enabled engine must stay on');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('ps1: the default is playwright-chrome, and sh agrees with the file ps1 wrote (pwsh required)', { skip: skipNoPwsh }, () =>
{
    const sb = sandbox();
    fs.writeFileSync(sb.sel, pwSel);
    try
    {
        const out = runPs(sb, 'install');
        assert.deepStrictEqual(pwNames(sb), ['playwright-chrome'], 'ps1: the default is exactly one chrome server');
        assertPwEngine(sb, 'chrome', 'ps1');
        assert.match(out, /playwright=chrome/, 'ps1: the summary does not name the engine');
        // The cross-twin half holds off Windows only: there ps1 launches `cmd /c npx` (the bare npx.cmd shim dies
        // with JSON-RPC -32000) and sh under Git Bash launches `npx`, so each twin reads the other's entry as drift.
        if (process.platform === 'win32') return;
        const afterPs = fs.readFileSync(path.join(sb.repo, '.mcp.json'), 'utf8');
        assert.doesNotMatch(runSh(sb, 'update'), /mcp repaired:/, 'sh: rewrote the chrome server ps1 wrote');
        assert.strictEqual(fs.readFileSync(path.join(sb.repo, '.mcp.json'), 'utf8'), afterPs, 'sh: reformatted the file ps1 wrote');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

// 1.1.0: the core declares no dependencies. `claude plugin update` over an older core installs none a
// release adds, and a plugin missing one is disabled at load, its commands with it (measured on
// 2.1.280, a 0.2.87 -> 1.0.0 upgrade) - so every route installs superpowers itself, and 27 skills and
// agents that cite it find it whichever route the project took.
for (const twin of ['sh', 'ps1'])
{
    test(`${twin}: the plugin route installs superpowers itself - the core no longer pulls it in`, { skip: 'D1: the shell seed is refused from 2.0.0; the twin goes in 7b' }, () =>
    {
        const sb = DEFAULT_ROUTES(sandbox({ sentry: STALE_SENTRY }));
        try
        {
            twin === 'sh' ? runSh(sb, 'install') : runPs(sb, 'install');
            const log = calls(sb);
            assert.ok(/plugin install claude-stack@claude-stack --scope project/.test(log), `${twin}: the core plugin was not installed`);
            assert.ok(/plugin install superpowers@claude-plugins-official --scope project/.test(log), `${twin}: the plugin route left superpowers to a dependency the core no longer declares:\n${log}`);
        }
        finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
    });

    test(`${twin}: the copy route installs superpowers itself too, or it would simply be absent`, { skip: twin === 'ps1' && skipNoPwsh }, () =>
    {
        const sb = sandbox({ sentry: STALE_SENTRY });
        sb.env.CLAUDE_STACK_HOOKS_VIA_PLUGIN = 'false';
        sb.env.CLAUDE_STACK_SKILLS_VIA_PLUGIN = 'false';
        try
        {
            twin === 'sh' ? runSh(sb, 'install') : runPs(sb, 'install');
            const log = calls(sb);
            assert.ok(/plugin install superpowers@claude-plugins-official --scope project/.test(log), `${twin}: the copy route did not install superpowers:\n${log}`);
            assert.ok(!/plugin install claude-stack@claude-stack/.test(log), `${twin}: the copy route installed a stack plugin`);
        }
        finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
    });

    test(`${twin}: update carries the same fallback - a copy-route update does not drop the dependency`, { skip: twin === 'ps1' && skipNoPwsh }, () =>
    {
        const sb = sandbox({ sentry: STALE_SENTRY });
        sb.env.CLAUDE_STACK_HOOKS_VIA_PLUGIN = 'false';
        sb.env.CLAUDE_STACK_SKILLS_VIA_PLUGIN = 'false';
        try
        {
            twin === 'sh' ? runSh(sb, 'update') : runPs(sb, 'update');
            assert.match(calls(sb), /plugin install superpowers@claude-plugins-official/, `${twin}: a copy-route update left superpowers absent`);
        }
        finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
    });
}

// A failed plugin install is reported as itself. The core declares no dependencies (1.1.0), so there
// is no 'a dependency is disabled' lock left to explain - the hint that did is gone from both twins.
for (const twin of ['sh', 'ps1'])
{
    test(`${twin}: a plugin failure with superpowers ENABLED says nothing about the dependency`, { skip: twin === 'ps1' && skipNoPwsh }, () =>
    {
        const sb = sandbox({ sentry: STALE_SENTRY });
        fs.writeFileSync(sb.plugins, JSON.stringify([
            { id: 'superpowers@claude-plugins-official', version: '6.2.0', scope: 'user', enabled: true },
        ]));
        const shStub = path.join(sb.work, 'bin', 'claude');
        fs.writeFileSync(shStub, fs.readFileSync(shStub, 'utf8').replace(
            'exit 0\n', 'if [ "$1" = "plugin" ] && [ "$2" = "install" ]; then exit 1; fi\nexit 0\n'), { mode: 0o755 });
        const cmdStub = path.join(sb.work, 'bin', 'claude.cmd');
        fs.writeFileSync(cmdStub, fs.readFileSync(cmdStub, 'utf8').replace(
            'exit /b 0', 'if "%~1"=="plugin" if "%~2"=="install" exit /b 1\r\nexit /b 0'));
        try
        {
            const out = twin === 'sh' ? runSh(sb, 'install') : runPs(sb, 'install');
            assert.doesNotMatch(out, /is DISABLED and/, `${twin}: a run that failed for an unrelated reason was sent chasing the dependency`);
        }
        finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
    });
}

// A listing with exactly ONE row: ConvertFrom-Json unwraps a one-element array into a single
// PSCustomObject, which is not IEnumerable - the ps1 shape test dropped the whole listing, so every
// caller silently kept its defaults (the wrong update scope, a parked plugin never enabled). Found
// by the Phase 4 dependency-lock case, which is the first fixture with a single row.
test('ps1: a one-plugin listing is read, not dropped', { skip: skipNoPwsh }, () =>
{
    const sb = sandbox({ sentry: STALE_SENTRY });
    fs.writeFileSync(sb.sel, fs.readFileSync(sb.sel, 'utf8') + 'plugin security-guidance\n');
    fs.writeFileSync(sb.plugins, JSON.stringify([
        { id: 'security-guidance@claude-plugins-official', version: '1.0.0', scope: 'user', enabled: true },
    ]));
    try
    {
        runPs(sb, 'update');
        assert.match(calls(sb), /plugin update security-guidance@claude-plugins-official --scope user/,
            'ps1: the single-row listing was dropped, so the update ran at the wrong scope');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

// Phase 5 pins the distinction the roadmap missed: the plugin route's prune and the RETIRED lists
// do DIFFERENT jobs, and deleting either strands files in every 0.2.x project.
//   - a copy a plugin now CARRIES is removed by the Phase 3 prune (it would shadow the plugin's own);
//   - a copy of something the stack no longer ships AT ALL is carried by no plugin, so only
//     RETIRED_SKILLS / RETIRED_AGENTS reach it.
for (const twin of ['sh', 'ps1'])
{
    test(`${twin}: the plugin route removes BOTH a plugin-carried copy and a retired-upstream one`, { skip: twin === 'ps1' && skipNoPwsh }, () =>
    {
        const sb = DEFAULT_ROUTES(sandbox({ sentry: STALE_SENTRY }));
        const skills = path.join(sb.repo, '.claude', 'skills');
        const agents = path.join(sb.repo, '.claude', 'agents');
        // what a 0.2.x install left behind: one skill a plugin now carries, one retired upstream,
        // one retired agent, and one the user wrote themselves.
        for (const [dir, name] of [[skills, 'markdown-style'], [skills, 'frontend'], [skills, 'my-own-skill']])
        {
            fs.mkdirSync(path.join(dir, name), { recursive: true });
            fs.writeFileSync(path.join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: x\n---\nbody\n`);
        }
        fs.mkdirSync(agents, { recursive: true });
        fs.writeFileSync(path.join(agents, 'code-analyzer.md'), '---\nname: code-analyzer\n---\nbody\n');
        fs.writeFileSync(path.join(agents, 'my-own-agent.md'), '---\nname: my-own-agent\n---\nbody\n');
        try
        {
            twin === 'sh' ? runSh(sb, 'update') : runPs(sb, 'update');
            assert.ok(!fs.existsSync(path.join(skills, 'markdown-style')), `${twin}: the plugin-carried copy was left to shadow the plugin`);
            assert.ok(!fs.existsSync(path.join(skills, 'frontend')), `${twin}: the retired-upstream copy was stranded - RETIRED_SKILLS is what reaches it`);
            assert.ok(!fs.existsSync(path.join(agents, 'code-analyzer.md')), `${twin}: the retired-upstream agent was stranded`);
            assert.ok(fs.existsSync(path.join(skills, 'my-own-skill')), `${twin}: a skill the project wrote itself was removed`);
            assert.ok(fs.existsSync(path.join(agents, 'my-own-agent.md')), `${twin}: an agent the project wrote itself was removed`);
        }
        finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
    });
}

// ---------------------------------------------------------------------------------------------
// PHASE 6 - the plugin route. The eight catalog servers arrive through the plugins NAMED for them
// (serena, context7, memory, playwright, angular-cli, chrome-devtools, appium-mcp, sentry), so this
// script registers nothing at all. What it still has to do is take the OLD registrations out: a
// project that carries both would run every server twice, once from .mcp.json and once from the
// plugin, and pay both sets of tool schemas on every session - the exact cost class RETIRED_MCPS
// was created for (24 playwright schemas re-injected into a headless backend project, measured).
const PLUGIN_ROUTE_MCPS = (sb) =>
{
    sb.env.CLAUDE_STACK_MCPS_VIA_PLUGIN = 'true';
    // ... and the other two back to their own defaults, since the sandbox pins the full copy route.
    delete sb.env.CLAUDE_STACK_SKILLS_VIA_PLUGIN;
    delete sb.env.CLAUDE_STACK_HOOKS_VIA_PLUGIN;
    return sb;
};

// The locked three are PLUGINS whenever any plugin route is on - installed beside the core by the
// installer, since the core declares no dependencies - so the installer registers none of them there
// (R7). This is the middle case: the MCP route is off, but the hooks route keeps the core enabled -
// the droppable picks come back to .mcp.json and the three are installed as plugins instead.
const HOOKS_PLUGIN_ONLY = (sb) =>
{
    sb.env.CLAUDE_STACK_MCPS_VIA_PLUGIN = 'false';
    sb.env.CLAUDE_STACK_SKILLS_VIA_PLUGIN = 'false';
    delete sb.env.CLAUDE_STACK_HOOKS_VIA_PLUGIN;
    return sb;
};

// The eight names plus the four per-engine playwright spellings an older install may have written.
const STACK_SERVER_NAMES = ['serena', 'context7', 'memory', 'angular-cli', 'chrome-devtools',
    'appium-mcp', 'sentry', 'playwright', 'playwright-chrome', 'playwright-msedge',
    'playwright-firefox', 'playwright-webkit'];

for (const twin of ['sh', 'ps1'])
{
    test(`${twin}: the plugin route registers nothing`, { skip: twin === 'ps1' && skipNoPwsh }, () =>
    {
        const sb = PLUGIN_ROUTE_MCPS(sandbox());
        try
        {
            const out = twin === 'sh' ? runSh(sb, 'install') : runPs(sb, 'install');
            assert.match(out, /mcp: carried by the plugins/, `${twin}: the run did not say the servers moved`);
            assert.doesNotMatch(calls(sb), /^mcp add/m, `${twin}: a server was registered on the plugin route`);
            // .mcp.json is no longer a stack-owned artifact: absent is the right shape when the
            // project added nothing of its own.
            const file = path.join(sb.repo, '.mcp.json');
            if (fs.existsSync(file))
                assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers || {}), [],
                    `${twin}: .mcp.json still carries stack servers`);
        }
        finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
    });

    test(`${twin}: an update strips every stack registration and keeps the project's own`, { skip: twin === 'ps1' && skipNoPwsh }, () =>
    {
        // A 0.2.x install: all eight stack names plus an engine spelling, and one server the project
        // added by hand. The hand-added one is the whole point - the retirement names, never sweeps.
        const existing = {};
        for (const name of ['serena', 'context7', 'memory', 'sentry', 'playwright-chrome'])
            existing[name] = { type: 'stdio', command: 'uvx', args: ['--from', name], env: {} };
        existing['my-own-server'] = { type: 'stdio', command: 'node', args: ['./my-server.js'], env: {} };
        const sb = PLUGIN_ROUTE_MCPS(sandbox(existing));
        try
        {
            const out = twin === 'sh' ? runSh(sb, 'update') : runPs(sb, 'update');
            const removed = [...calls(sb).matchAll(/^mcp remove (\S+)/gm)].map(m => m[1]);
            for (const name of ['serena', 'context7', 'memory', 'sentry', 'playwright-chrome'])
                assert.ok(removed.includes(name), `${twin}: ${name} was left registered alongside its plugin:\n${out}`);
            assert.ok(!removed.includes('my-own-server'), `${twin}: the project's own server was unregistered`);
            assert.ok(fs.existsSync(path.join(sb.repo, '.mcp.json')), `${twin}: the file the project's own server lives in was deleted`);
        }
        finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
    });

    test(`${twin}: the prune loop survives a NON-EMPTY retired list`, { skip: twin === 'ps1' && skipNoPwsh }, () =>
    {
        // Regression. RETIRED_MCPS had been empty since the list was introduced, so the loop body
        // had never once run - and the ps1 twin's body called `Write-Log`, a function that does not
        // exist in that script. The plugin route fills the list, and the latent bug took the whole
        // run down on the first try. The test is simply that a run with servers to prune finishes.
        const existing = {};
        for (const name of STACK_SERVER_NAMES) existing[name] = { type: 'stdio', command: 'uvx', args: ['--from', name], env: {} };
        const sb = PLUGIN_ROUTE_MCPS(sandbox(existing));
        try
        {
            const out = twin === 'sh' ? runSh(sb, 'update') : runPs(sb, 'update');
            assert.doesNotMatch(out, /not recognized as a name of a cmdlet|command not found/,
                `${twin}: the prune loop called something that does not exist`);
            const removed = new Set([...calls(sb).matchAll(/^mcp remove (\S+)/gm)].map(m => m[1]));
            for (const name of STACK_SERVER_NAMES)
                assert.ok(removed.has(name), `${twin}: ${name} was never pruned - the loop stopped early`);
        }
        finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
    });
}

// R7's middle case, and the one the matrix caught: the MCP route is off but the core plugin is
// still enabled by the hooks route, so its `dependencies` already carry serena, context7 and
// memory. Registering them as well would run each server twice and pay both sets of tool schemas
// in every session - the whole cost the retirement list exists to prevent, reintroduced by the
// escape hatch. The droppable picks still come back to the file.
for (const twin of ['sh', 'ps1'])
{
    test(`${twin}: with the core plugin on, the locked three are not registered beside their plugins`, { skip: twin === 'ps1' && skipNoPwsh }, () =>
    {
        const sb = HOOKS_PLUGIN_ONLY(sandbox());
        (twin === 'sh' ? runSh : runPs)(sb, 'install');
        const names = Object.keys(servers(sb));
        for (const locked of ['serena', 'context7', 'memory'])
            assert.ok(!names.includes(locked), `${twin}: ${locked} was registered although the core plugin carries it (${names.join(',')})`);
        assert.ok(names.includes('sentry'), `${twin}: the droppable pick was not registered (${names.join(',')})`);
    });

    test(`${twin}: with the core plugin on and the MCP route off, the locked three are installed as plugins`, { skip: twin === 'ps1' && skipNoPwsh }, () =>
    {
        // No dependency edge brings them any more, and no registration either - so the install does.
        const sb = HOOKS_PLUGIN_ONLY(sandbox());
        (twin === 'sh' ? runSh : runPs)(sb, 'install');
        const log = calls(sb);
        for (const locked of ['serena', 'context7', 'memory'])
            assert.match(log, new RegExp(`plugin install ${locked}@claude-stack `), `${twin}: ${locked} was neither registered nor installed:\n${log}`);
        assert.match(log, /plugin install superpowers@claude-plugins-official /, `${twin}: superpowers was not installed`);
    });

    test(`${twin}: an update with the core plugin on takes an older install's locked registrations OUT`, { skip: twin === 'ps1' && skipNoPwsh }, () =>
    {
        const sb = HOOKS_PLUGIN_ONLY(sandbox());
        sb.env.CLAUDE_STUB_REMOVE_WORKS = '1';   // the real CLI's `mcp remove` at project scope, which is the route the prune takes
        fs.writeFileSync(path.join(sb.repo, '.mcp.json'), JSON.stringify({ mcpServers: {
            serena: { type: 'stdio', command: 'uvx', args: ['--from', 'serena-agent@0.1.0'] },
            context7: { type: 'http', url: 'https://mcp.context7.com/mcp' },
            memory: { type: 'stdio', command: 'uvx', args: ['--from', 'mcp-memory-service[sqlite]'] },
            'my-own-server': { type: 'stdio', command: 'node', args: ['x.js'] },
        } }, null, 2) + '\n');
        (twin === 'sh' ? runSh : runPs)(sb, 'update');
        const names = Object.keys(servers(sb));
        for (const locked of ['serena', 'context7', 'memory'])
            assert.ok(!names.includes(locked), `${twin}: the old ${locked} registration survived (${names.join(',')})`);
        assert.ok(names.includes('my-own-server'), `${twin}: the project's own server was removed (${names.join(',')})`);
    });
}
