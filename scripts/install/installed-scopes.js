#!/usr/bin/env node
'use strict';
// THE SCOPES OF THE INSTALLED SET - /alfred-code:configure and init's walk (references/walk.md) read where each installed
// optional item lives from the installer's own read-back (`update --installed-only --print-plan --plan-out <file>`).
//
//   node scripts/install/installed-scopes.js <read-back file>
//
// Prints the read-back's `scopes` map as one JSON line, `{"<item>":"global|project|local|managed"}`, and `{}` when the
// read-back holds none. Exit 0, 2 on a usage error, 1 on a file that is missing or not JSON.
const fs = require('node:fs');

const { parseJson } = require('./json-file.js');

const EXIT = Object.freeze({ ok: 0, failed: 1, usage: 2 });
const ENCODING = 'utf8';

const scopesOf = (readBack) => (readBack && typeof readBack === 'object' && readBack.scopes && typeof readBack.scopes === 'object' ? readBack.scopes : {});

function main(argv)
{
    if (argv.length !== 1) { console.error('usage: installed-scopes.js <read-back file>'); return EXIT.usage; }
    try { console.log(JSON.stringify(scopesOf(parseJson(fs.readFileSync(argv[0], ENCODING))))); }
    catch (error) { console.error(`installed-scopes: ${argv[0]} is not a readable read-back (${error.message})`); return EXIT.failed; }
    return EXIT.ok;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { scopesOf, main };
