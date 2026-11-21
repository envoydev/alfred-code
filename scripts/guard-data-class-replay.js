#!/usr/bin/env node
// Replays local Claude Code transcripts through the data-class guard's judges and prints counts only.
'use strict';
const { run } = require('./guard-data-class-replay/effects');
const { FLAG } = require('./guard-data-class-replay/constants');

function valueOf(argv, flag) {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}

const argv = process.argv.slice(2);
const limit = valueOf(argv, FLAG.sampleLimit);
run({ root: valueOf(argv, FLAG.root), samplesFile: valueOf(argv, FLAG.samples), sampleLimit: limit === undefined ? undefined : Number(limit) })
  .then((report) => process.stdout.write(JSON.stringify(report) + '\n'))
  .catch((error) => {
    process.stderr.write(`replay failed: ${error.message}\n`);
    process.exit(1);
  });
