#!/usr/bin/env node
// Copied into each repo as .claude/kit/settings.mjs by claude-kit's sync - edit it in claude-kit, never here.
//
// Prints the values the kit's skills run on, one per line with where each came from, and saves them:
//
//   node .claude/kit/settings.mjs                       print every value
//   node .claude/kit/settings.mjs set <name> <value>    save one in .claude/kit/settings.json, where it holds until changed
//   node .claude/kit/settings.mjs unset <name>          remove it from that file and print what it falls back to
//
// The names are plan_model, audit_model, review_model, implement_model, search_model (a model), pass_score (1 to 100), and scoring,
// auto_run and auto_approve (on or off). kit-settings.mjs, beside this file, says in what order a value is taken and does the work.
// Exits 0, or 1 with the reason on stderr when a set or unset fails, the arguments are not one of these, or a set or
// unset is run from a checkout (bin/settings.mjs) instead of a repo's .claude/kit.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSettingsCommand } from './kit-settings.mjs';

const folder = dirname(fileURLToPath(import.meta.url));
const { exitCode, stdout, stderr } = runSettingsCommand(process.argv.slice(2), process.env, join(folder, '..', '..'), folder);

if (stdout !== '') console.log(stdout);
if (stderr !== '') console.error(stderr);
process.exitCode = exitCode;
