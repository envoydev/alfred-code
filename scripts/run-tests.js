#!/usr/bin/env node
'use strict';
// `npm test`: node's test runner over the repo's own test files, `scripts/**/*.test.js`.
//
// Why a script and not the pattern in package.json: a bare `node --test` walks every `*.test.js` under the repo,
// the git-ignored plan copies in docs/superpowers/sdd/ included - 2,113 files, 84 of them failing, about 15 minutes
// on 2026-10-28 against the 175 tracked ones in under 5. And npm appends `npm test -- <flags>` AFTER the script, where
// node ignores a flag that follows the pattern (measured on node 24: `--test-shard=1/2` after it ran every file), so
// CI's shards would each run the whole suite. Here the flags go first and the pattern last, passed with no shell, so
// no quoting reaches it (cmd.exe once kept single quotes, node matched nothing and the run passed on zero tests).
//
//   npm test [-- <node --test flags, as --flag=value>] [<test file or glob> ...]
//
// A test path given replaces the default pattern. No test file under scripts/ fails the run.
//
// The run gets a temp dir of its own (TMPDIR, TEMP and TMP), removed when it ends, pass or fail: a full run left 330
// folders and files in the machine's temp dir (measured 2026-11-03 - mkdtemp folders a suite never removed, hook
// markers, the V8 cache), and every hook's stale sweep lists that dir (52,840 entries once). The name stays short,
// since a few tests bound a message that quotes a temp path.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PATTERN = 'scripts/**/*.test.js';

const isTarget = (arg) => !arg.startsWith('-') && (/\.[cm]?js$/.test(arg) || arg.includes('*'));

function hasTestFile(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== 'node_modules' && hasTestFile(path.join(dir, entry.name))) return true;
        if (entry.isFile() && entry.name.endsWith('.test.js')) return true;
    }
    return false;
}

require('../stack/hooks/hook-prelude.js').blockingStdio();
const args = process.argv.slice(2);
if (!args.some(isTarget) && !hasTestFile(path.join(ROOT, 'scripts'))) {
    process.stderr.write(`run-tests: no test file matches ${PATTERN} under ${ROOT} - a run of zero tests is not a pass\n`);
    process.exit(1);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'at-'));
const env = { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp };
// A run that writes into the checkout's own hook-blocks ledger fails whatever its tests did (bug 2 of the complexity
// audit, 2026-11-10): a hook spawned with the checkout as its project left 213 rows there that read as sessions.
const { checkoutLedgers, ledgerSnapshot, ledgerGrowth } = require('./hook-test-env.js');
const ledgersBefore = ledgerSnapshot(checkoutLedgers(ROOT));
let r;
try { r = spawnSync(process.execPath, ['--test', ...args, ...(args.some(isTarget) ? [] : [PATTERN])], { cwd: ROOT, stdio: 'inherit', env }); }
finally { try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { process.stderr.write(`run-tests: the run's temp dir ${tmp} was not removed: ${e.message}\n`); } }
if (r.error) { process.stderr.write(`run-tests: ${r.error.message}\n`); process.exit(1); }
const grown = ledgerGrowth(ledgersBefore, ledgerSnapshot(checkoutLedgers(ROOT)));
if (grown.length)
{
    process.stderr.write(`run-tests: the run wrote into this checkout's own hook-blocks ledger - a suite or a probe ran a hook with the checkout as its project: ${grown.join(', ')}\n`);
    process.exit(1);
}
process.exit(r.status ?? 1);
