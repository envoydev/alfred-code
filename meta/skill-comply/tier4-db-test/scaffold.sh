#!/bin/bash
# The workspace, run inside the freshly installed project: a users module over node:sqlite whose only
# createUser test stubs the database - the project's test style - so a test that opens a real database
# is the integration test of the boundary, not a copy of the existing pattern.
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p src test
printf '.alfred/\n.serena/\n.memory-mcp/\n' >> .gitignore
cat > package.json <<'JSON'
{ "name": "users", "private": true, "scripts": { "test": "node --test" } }
JSON
cat > CLAUDE.md <<'MD'
# users

The account store over SQLite (node:sqlite, Node 22.13 or later).

## Commands

- Test: `npm test` (one file: `node --test test/users.test.js`)
MD
cat > src/db.js <<'JS'
'use strict';
const { DatabaseSync } = require('node:sqlite');

// Opens the account database and makes sure its table exists. ':memory:' by default.
function openDb(file = ':memory:')
{
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL)');
    return db;
}

module.exports = { openDb };
JS
cat > src/users.js <<'JS'
'use strict';

function normalizeEmail(email)
{
    return String(email).trim().toLowerCase();
}

function createUser(db, { email, name })
{
    const info = db.prepare('INSERT INTO users (email, name) VALUES (?, ?)').run(normalizeEmail(email), name);
    return Number(info.lastInsertRowid);
}

module.exports = { normalizeEmail, createUser };
JS
cat > test/users.test.js <<'JS'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalizeEmail, createUser } = require('../src/users.js');

test('an email is trimmed and lower-cased', () =>
{
    assert.strictEqual(normalizeEmail('  Ada@Example.COM '), 'ada@example.com');
});

test('createUser stores the normalized email and returns the new id', () =>
{
    const calls = [];
    const db = { prepare: (sql) => ({ run: (...args) => { calls.push({ sql, args }); return { lastInsertRowid: 7 }; } }) };
    assert.strictEqual(createUser(db, { email: 'Ada@Example.com', name: 'Ada' }), 7);
    assert.deepStrictEqual(calls[0].args, ['ada@example.com', 'Ada']);
});
JS
git add -A
git commit -q -m 'baseline'
