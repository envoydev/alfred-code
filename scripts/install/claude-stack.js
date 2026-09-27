#!/usr/bin/env node
'use strict';
// A 1.x command body still calls this path against a 2.0.0 snapshot; it runs the renamed entry. // legacy-name
process.exitCode = require('./alfred-code.js').main(process.argv.slice(2));
