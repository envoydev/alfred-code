#!/usr/bin/env node
'use strict';
// A stand-in for the docker CLI, for the harness tests: `fake-docker.js --record <file> [--exit <n>] <args>`
// appends { argv, cwd, COMPOSE_PROJECT_NAME } to <file> as one JSON line and exits <n> (default 0).
const fs = require('node:fs');

const argv = process.argv.slice(2);
const take = (name) =>
{
    const i = argv.indexOf(name);
    if (i < 0) return undefined;
    const [, value] = argv.splice(i, 2);
    return value;
};
const record = take('--record');
const exit = Number(take('--exit') || 0);
if (record) fs.appendFileSync(record, `${JSON.stringify({ argv, cwd: process.cwd(), COMPOSE_PROJECT_NAME: process.env.COMPOSE_PROJECT_NAME })}\n`);
process.exit(exit);
