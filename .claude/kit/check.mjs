#!/usr/bin/env node
// Copied into each repo as .claude/kit/check.mjs by claude-kit's sync - edit it in claude-kit, never here.
//
// Fails when a file claude-kit manages was edited, removed or left out of the repo: each path in
// .claude/kit/lock.json must hash to the value sync wrote. The fix is never a local edit - change the file
// in claude-kit and run its sync, so the three repos keep one copy of the rule or skill.
//
//   node .claude/kit/check.mjs        exit 0 when every managed file matches, 1 otherwise
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const kitDir = dirname(fileURLToPath(import.meta.url));
const root = join(kitDir, '..', '..');
const lock = JSON.parse(readFileSync(join(kitDir, 'lock.json'), 'utf8'));

const problems = [];
for (const [rel, wanted] of Object.entries(lock.files))
{
    let text;
    try { text = readFileSync(join(root, rel)); }
    catch { problems.push(`missing: ${rel}`); continue; }
    if (createHash('sha256').update(text).digest('hex') !== wanted) problems.push(`edited here: ${rel}`);
}

if (problems.length)
{
    console.error(`claude-kit: ${problems.length} managed file(s) differ from the kit (${lock.kit}):`);
    for (const p of problems) console.error(`  ${p}`);
    console.error('Change them in claude-kit and run its sync (node bin/sync.ts <repo>), never in this repo.');
    process.exit(1);
}
console.log(`claude-kit: ${Object.keys(lock.files).length} managed files match ${lock.kit}`);
