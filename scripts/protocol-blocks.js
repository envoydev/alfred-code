#!/usr/bin/env node
'use strict';
// Writes setup-plugin/hooks/protocol-blocks.json, the table run-dir-gate.js reads; `--check` only reports.
const path = require('node:path');
const { writeTable } = require('./run-dir-gate/effects.js');

const check = process.argv.includes('--check');
const result = writeTable(path.join(__dirname, '..'), { check });
console.log(`${result.file}: ${result.current ? 'current' : check ? 'STALE - run npm run protocol-blocks' : 'written'}`);
process.exitCode = check && !result.current ? 1 : 0;
