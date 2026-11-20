#!/usr/bin/env node
'use strict';
// PreToolUse (Bash): inside a typed /alfred-code:init, update, configure or validate, approves the shipped resolve block and
// the walk's own narrow forms on this session's run dir, and denies a call that names another session's run dir - only on
// proof: a marker this user owns that names a dir holding this session's id. Everything else is silent, so Claude Code's own
// prompt stays. Lives in the PLUGIN beside the bodies it reads: the table is generated from setup-plugin/ (npm run protocol-blocks).
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..', '..');
const PRELUDE = path.join(ROOT, 'stack', 'hooks', 'hook-prelude.js');
const GATE = path.join(ROOT, 'scripts', 'run-dir-gate');

function main()
{
    let payload;
    try { payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}') || {}; } catch { return; }
    const { QUICK_REJECT, TOOL } = require(path.join(GATE, 'constants.js'));
    const command = payload.tool_input && payload.tool_input.command;
    if (payload.tool_name !== TOOL || typeof command !== 'string' || !command.includes(QUICK_REJECT)) return;
    const prelude = require(PRELUDE);
    if (typeof prelude.pluginWalkNow !== 'function' || !prelude.pluginWalkNow(payload)) return;
    if (prelude.standDown('run-dir-gate', process.env, process.argv, { setUp: false })) return;
    if (prelude.cursorStandDown(payload, __filename)) return;
    const { judge, emit } = require(path.join(GATE, 'effects.js'));
    emit(judge(payload, process.env, ROOT), payload, { record: !prelude.neverSetUp(), env: process.env });
}

try { main(); } catch { /* fail-open */ }
