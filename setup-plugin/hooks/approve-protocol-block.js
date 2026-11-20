#!/usr/bin/env node
'use strict';
// PreToolUse (Bash): approves a call whose text is a shipped fixed protocol block, or the opener every later call starts
// with followed by one. Claude Code 2.1.329 asks before a command that sets a shell variable and uses it, even when an
// allow rule matches, and every protocol block uses $TMP; a hook's `allow` skips that ask (probe, 2026-11-20). Only the
// exact shipped text is approved - a line the model added, a filled placeholder or a merged call gets the usual prompt.
// The user's deny and ask rules still apply over it. Silent on everything else; fail-open on anything unreadable.
// Lives in the PLUGIN beside the bodies it reads: the table is generated from setup-plugin/ (npm run protocol-blocks).
const fs = require('node:fs');
const path = require('node:path');
const PRELUDE = path.join(__dirname, '..', '..', 'stack', 'hooks', 'hook-prelude.js');
const LOGIC = path.join(__dirname, '..', '..', 'scripts', 'protocol-blocks', 'blocks.js');
const TABLE = path.join(__dirname, 'protocol-blocks.json');
const REASON = 'a shipped alfred-code protocol block, unchanged';

function main()
{
    let off = false;
    try { off = require(PRELUDE).standDown('approve-protocol-block', process.env, process.argv, { setUp: false }); } catch { /* no prelude: run */ }
    if (off) return;
    let input;
    try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}') || {}; } catch { return; }
    if (input.tool_name !== 'Bash') return;
    const command = input.tool_input && input.tool_input.command;
    if (typeof command !== 'string' || !command.trim()) return;
    let approves, table;
    try { ({ approves } = require(LOGIC)); table = JSON.parse(fs.readFileSync(TABLE, 'utf8')); } catch { return; }
    if (!approves(command, table)) return;
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: REASON } }));
}

try { main(); } catch { /* fail-open */ }
