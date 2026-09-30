'use strict';
// THE INSTALL AUDITS ITS OWN AGENT CONFIG - what the stack or the user wired into a project, never
// the project's code. Advisory: rows, no fixes, exit 0.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { audit } = require('./audit-install.js');

const roots = [];
test.after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });
function project(files)
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'));
    roots.push(root);
    for (const [rel, body] of Object.entries(files))
    {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), typeof body === 'string' ? body : JSON.stringify(body));
    }
    return root;
}
const finds = (root) => audit(root).map((r) => r.finding);
const npx = (...args) => ({ command: 'npx', args });
// Built at run time so this file never holds a credential-shaped literal itself.
const TOKEN = ['ghp', '0123456789abcdefghij0123456789abcdef'].join('_');

test('a clean install yields no rows', () =>
{
    const root = project({
        '.mcp.json': { mcpServers: {
            'playwright-chrome': npx('-y', '@playwright/mcp@0.0.82', '--browser', 'chrome'),
            serena: { command: 'uvx', args: ['--from', 'serena-agent@1.7.0', 'serena', 'start-mcp-server'] },
            memory: { command: 'uvx', args: ['--with', 'numpy', '--from', 'mcp-memory-service[sqlite]==11.13.0', 'memory'] },
            'angular-cli': npx('-y', '@angular/cli', 'mcp'),
            sentry: { type: 'http', url: 'https://mcp.sentry.dev/mcp/${SENTRY_SLUG}', headers: { Authorization: 'Sentry-Bearer ${SENTRY_ACCESS_TOKEN}' } },
        } },
        '.claude/settings.json': { permissions: { allow: ['Bash(npm test:*)'] },
            hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node x.js', timeout: 10 }] }] } },
    });
    assert.deepStrictEqual(audit(root), []);
});

test('an unpinned launch is one row per server, whatever the launcher spelling; angular-cli is the named exception', () =>
{
    const root = project({ '.mcp.json': { mcpServers: {
        a: npx('-y', 'some-mcp@latest'),
        b: npx('-y', 'other-mcp'),
        c: npx('-y', '@scope/pkg'),
        d: { command: 'cmd', args: ['/c', 'npx', '-y', 'win-mcp@latest'] },
        e: { command: 'uvx', args: ['--from', 'serena-agent', 'serena'] },
        f: { command: 'uvx', args: ['--with', 'numpy', 'tool-mcp'] },
        pinnedByFlag: npx('-y', '-p', 'pkg-mcp@1.2.3', 'pkg-bin'),
        'angular-cli': npx('-y', '@angular/cli', 'mcp'),
    } } });
    assert.deepStrictEqual(finds(root), ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => `mcp server ${n} launches an unpinned package`));
});

test('a wide shell allow, a hook with no timeout, a hook splicing tool input and a credential literal are one row each', () =>
{
    const root = project({
        '.claude/settings.json': {
            permissions: { allow: ['Bash(*)', 'PowerShell', 'Bash(git status)'] },
            hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node y.js' }] }],
                PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'sh -c "echo ${tool_input}"', timeout: 10 }] }] },
        },
        'CLAUDE.md': `token: ${TOKEN}\n`,
    });
    const rows = audit(root);
    assert.deepStrictEqual(rows.map((r) => r.finding).sort(), [
        'CLAUDE.md holds a credential-shaped literal',
        'a hook command interpolates tool input into a shell string: sh -c "echo ${tool_input}"',
        'a hook wiring has no timeout (600s default): node y.js',
        'permissions.allow holds an unrestricted shell grant: Bash(*)',
        'permissions.allow holds an unrestricted shell grant: PowerShell',
    ]);
    assert.ok(!JSON.stringify(rows).includes(TOKEN), 'a row echoed the credential it found');
});

// R12: the add-back line a retirement prints is the stack's own advice, so obeying it must not earn
// a high row here. Every npx / uvx line names a version - the last one the stack pinned - except the
// audit's own named exception, which must match the ng the workspace resolves.
test('every retired server\'s add-back line launches a pinned package, so obeying it audits clean', () =>
{
    const rows = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'retired-plugins.json'), 'utf8')).plugins;
    const servers = {};
    for (const row of rows)
    {
        const words = String(row.addBack || '').split(/\s+/);
        const cut = words.indexOf('--');
        if (cut < 0 || !['npx', 'uvx'].includes(words[cut + 1])) continue;
        servers[row.name] = { command: words[cut + 1], args: words.slice(cut + 2) };
    }
    assert.ok(Object.keys(servers).length >= 3, `too few npx / uvx add-back lines parsed: ${Object.keys(servers)}`);
    assert.deepStrictEqual(finds(project({ '.mcp.json': { mcpServers: servers } })), []);
});

test('garbage JSON is one unreadable row, an absent file is none', () =>
{
    assert.deepStrictEqual(finds(project({ '.mcp.json': '{nope' })), ['.mcp.json is unreadable']);
    assert.deepStrictEqual(audit(project({})), []);
});

test('a config of the wrong shape is one row, never a crash (audit F8)', () =>
{
    const root = project({
        '.mcp.json': { mcpServers: { a: { command: 'npx', args: '-y pkg' }, b: null } },
        '.claude/settings.json': { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: 'nope' }, { hooks: [null, { type: 'command', command: 'x', timeout: 5 }] }] } },
    });
    const script = path.join(__dirname, 'audit-install.js');
    const out = execFileSync(process.execPath, [script, root, '--json'], { encoding: 'utf8' });
    const found = JSON.parse(out).map((r) => r.finding);
    assert.deepStrictEqual(found, ['.mcp.json: mcp server a has an unreadable shape (args is not a list)', '.claude/settings.json: a hook group has an unreadable shape (hooks is not a list)', '.claude/settings.json: a hook entry has an unreadable shape (not an object)']);
});

test('the CLI prints a table or the all-clear, --json prints the rows, and it always exits 0', () =>
{
    const script = path.join(__dirname, 'audit-install.js');
    const run = (root, ...flags) => execFileSync(process.execPath, [script, root, ...flags], { encoding: 'utf8' });
    assert.strictEqual(run(project({})).trim(), 'install audit: nothing to report');
    const dirty = project({ '.mcp.json': { mcpServers: { a: npx('-y', 'x-mcp@latest') } } });
    assert.match(run(dirty), /^\| Severity \| Where \| Finding \| Fix \|\n\|---\|---\|---\|---\|\n\| high \| \.mcp\.json \| mcp server a launches an unpinned package \|/);
    assert.deepStrictEqual(JSON.parse(run(dirty, '--json')).map((r) => r.severity), ['high']);
});
