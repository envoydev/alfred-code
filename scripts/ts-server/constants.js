'use strict';

// typescript-lsp's server, and the file it loads from the TypeScript it resolves from its own package. TypeScript 7
// ships no tsserver.js, so a global TypeScript 7 beside the server leaves it unable to start.
const SERVER_PACKAGE = 'typescript-language-server';
const TYPESCRIPT_PACKAGE = 'typescript';
const TSSERVER_FILE = 'tsserver.js';
const PACKAGE_FILE = 'package.json';
// Where npm's Windows shim keeps the package it starts: below the shim's own folder.
const SHIM_PACKAGES = 'node_modules';
const STATE = Object.freeze({ ok: 'ok', missing: 'missing', unknown: 'unknown' });

module.exports = { SERVER_PACKAGE, TYPESCRIPT_PACKAGE, TSSERVER_FILE, PACKAGE_FILE, SHIM_PACKAGES, STATE };
