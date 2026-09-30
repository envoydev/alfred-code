#!/usr/bin/env node
'use strict';
// THE INSTALL AUDIT - a read-only pass over an install's OWN agent config: what the stack or the user
// wired into this project (.mcp.json, the project settings files, AGENTS.md / CLAUDE.md), never the project's
// code. Advisory: it prints rows, fixes nothing and always exits 0 - /alfred-code:validate pastes
// the table and asks at most once.
//
//   node scripts/audit-install.js [<projectRoot>] [--json]
//
// A plugin-route install writes no .mcp.json and no hook wiring of its own; its servers and hooks
// are GENERATED into the marketplace, pinned and timed out there, and the lint holds them. What is
// left to audit is what a person, or the copy route, put into the project.
const fs = require('node:fs');
const { parseJson } = require('./install/json-file.js');
const path = require('node:path');
const { SECRET_SHAPE, PEM_PRIVATE } = require('./credential-shapes.js');

// Unpinned on purpose: it must match the ng the workspace itself resolves. The stack stopped
// shipping it in 2.0.0, and the add-back line the retirement prints registers it unpinned.
const UNPINNED_OK = new Set(['angular-cli']);
const LAUNCHERS = new Set(['npx', 'uvx', 'bunx', 'pnpm']);
// The flag that names the package outright, per launcher; else the first positional is it.
const PACKAGE_FLAGS = { npx: ['-p', '--package'], uvx: ['--from'], bunx: ['-p', '--package'], pnpm: [] };
// Flags whose VALUE is not the package - `uvx --with numpy --from pkg==1 bin` launches pkg.
const VALUE_FLAGS = new Set(['--with', '--python', '-p', '--package', '--from', '--index-url', '--exclude-newer']);
const WIDE_SHELL = /^(Bash|PowerShell)(\((\*|:\*|\*:\*)\))?$/;
const SPLICES_INPUT = /\$\{?(tool_input|file_path|command)\b/i;

function readJson(root, rel, rows)
{
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) return null;
    try { return parseJson(fs.readFileSync(p, 'utf8')); }
    catch
    {
        rows.push({ severity: 'medium', where: rel, finding: `${rel} is unreadable`, fix: 'repair the JSON by hand' });
        return null;
    }
}

// The package a stdio server launches, or null when the command is no package launcher.
function launchedPackage(server)
{
    let command = String(server.command || '');
    let args = (server.args || []).map(String);
    // The Windows copy route spells npx through cmd: `cmd /c npx -y <pkg>`.
    if (/^cmd(\.exe)?$/i.test(command) && /^\/c$/i.test(args[0] || '')) { command = args[1] || ''; args = args.slice(2); }
    const tool = path.basename(command).replace(/\.(cmd|exe)$/i, '');
    if (!LAUNCHERS.has(tool)) return null;
    if (tool === 'pnpm')
    {
        if (args[0] !== 'dlx') return null;
        args = args.slice(1);
    }
    for (const flag of PACKAGE_FLAGS[tool])
    {
        const i = args.indexOf(flag);
        if (i >= 0 && args[i + 1]) return args[i + 1];
        const joined = args.find((a) => a.startsWith(`${flag}=`));
        if (joined) return joined.slice(flag.length + 1);
    }
    for (let i = 0; i < args.length; i++)
    {
        if (VALUE_FLAGS.has(args[i])) { i++; continue; }
        if (!args[i].startsWith('-')) return args[i];
    }
    return null;
}

// '@1.2.3' / '@v2' after the package name, or a PEP 508 '==1.2'. A dist-tag ('@latest', '@next')
// names no version, so it is as unpinned as no suffix at all.
function isPinned(spec)
{
    const bare = spec.replace(/^@/, '');
    const at = bare.lastIndexOf('@');
    if (at > 0 && /\d/.test(bare.slice(at + 1))) return true;
    return /==\s*\d/.test(bare);
}

function audit(root)
{
    const rows = [];
    const mcp = readJson(root, '.mcp.json', rows);
    for (const [name, server] of Object.entries((mcp && mcp.mcpServers) || {}))
    {
        if (UNPINNED_OK.has(name)) continue;
        if (server && server.args !== undefined && !Array.isArray(server.args))
        {
            rows.push({ severity: 'medium', where: '.mcp.json', finding: `.mcp.json: mcp server ${name} has an unreadable shape (args is not a list)`, fix: 'repair the entry by hand' });
            continue;
        }
        const pkg = launchedPackage(server || {});
        if (pkg && !isPinned(pkg))
            rows.push({ severity: 'high', where: '.mcp.json', finding: `mcp server ${name} launches an unpinned package`, fix: 'pin it to a version, or re-run the stack update' });
    }
    for (const rel of ['.claude/settings.json', '.claude/settings.local.json'])
    {
        const s = readJson(root, rel, rows);
        if (!s) continue;
        for (const grant of (s.permissions && s.permissions.allow) || [])
        {
            if (WIDE_SHELL.test(String(grant)))
                rows.push({ severity: 'high', where: rel, finding: `permissions.allow holds an unrestricted shell grant: ${grant}`, fix: 'narrow it to the commands actually needed' });
        }
        for (const groups of Object.values(s.hooks || {}))
        {
            for (const group of Array.isArray(groups) ? groups : [])
            {
                if (group && group.hooks !== undefined && !Array.isArray(group.hooks))
                {
                    rows.push({ severity: 'medium', where: rel, finding: `${rel}: a hook group has an unreadable shape (hooks is not a list)`, fix: 'repair the wiring by hand' });
                    continue;
                }
                for (const h of (group && group.hooks) || [])
                {
                    if (!h || typeof h !== 'object')
                    {
                        rows.push({ severity: 'medium', where: rel, finding: `${rel}: a hook entry has an unreadable shape (not an object)`, fix: 'repair the wiring by hand' });
                        continue;
                    }
                    if (h.type !== 'command') continue;
                    if (!h.timeout)
                        rows.push({ severity: 'medium', where: rel, finding: `a hook wiring has no timeout (600s default): ${h.command}`, fix: 'add "timeout": 10' });
                    if (SPLICES_INPUT.test(String(h.command)))
                        rows.push({ severity: 'high', where: rel, finding: `a hook command interpolates tool input into a shell string: ${h.command}`, fix: 'read the payload from stdin inside the script' });
                }
            }
        }
    }
    for (const rel of ['AGENTS.md', '.claude/AGENTS.md', 'CLAUDE.md', '.claude/CLAUDE.md', '.mcp.json', '.claude/settings.json'])
    {
        const p = path.join(root, rel);
        if (!fs.existsSync(p)) continue;
        const text = fs.readFileSync(p, 'utf8');
        // The row names the FILE only: echoing the match would leak the credential into the report.
        if (SECRET_SHAPE.test(text) || PEM_PRIVATE.test(text))
            rows.push({ severity: 'high', where: rel, finding: `${rel} holds a credential-shaped literal`, fix: 'move it to the account settings env and rotate it' });
    }
    return rows;
}

// A pipe inside a cell would split the markdown row.
const cell = (s) => String(s).replace(/\|/g, '\\|');

if (require.main === module)
{
    const argv = process.argv.slice(2);
    const rows = audit(path.resolve(argv.find((a) => !a.startsWith('--')) || '.'));
    if (argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
    else if (!rows.length) console.log('install audit: nothing to report');
    else
    {
        console.log('| Severity | Where | Finding | Fix |\n|---|---|---|---|');
        for (const r of rows) console.log(`| ${cell(r.severity)} | ${cell(r.where)} | ${cell(r.finding)} | ${cell(r.fix)} |`);
    }
}

module.exports = { audit };
