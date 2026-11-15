#!/usr/bin/env node
// Copied into each repo as .claude/kit/settings.mjs by claude-kit's sync - edit it in claude-kit, never here.
//
// Prints the values the kit's skills run on, one per line with where each came from:
//
//   node .claude/kit/settings.mjs
//
// kit-settings.mjs, beside this file, lists the KIT_* variables and resolves them. Always exits 0.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveKitSettings } from './kit-settings.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

for (const [name, { value, origin }] of Object.entries(resolveKitSettings(process.env, root)))
    console.log(`${name}: ${value} (${origin})`);
