#!/bin/bash
# The workspace, run inside the freshly installed project: the habits-commit-checkpoint fixture's
# session service plus a log formatter, a committed baseline, then TWO uncommitted changes, each with
# its own test - the session-expiry fix (src/auth/session.js) and a log-format change (src/log.js).
# The prompt asks for two commits, so the receipt's VERIFIED phrase has to say what ran on what: one
# test run of the whole tree verifies the tree, never each commit of the split.
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p src/auth scripts test
printf '.alfred/\n' >> .gitignore
cat > package.json <<'JSON'
{ "name": "fixture", "private": true, "scripts": { "format": "node scripts/format.js", "test": "node --test" } }
JSON
cat > CLAUDE.md <<'MD'
# fixture

A small session service and its log formatter.

## Commands

- Format: `npm run format`
- Test: `npm test` (one file: `node --test test/session.test.js`)
MD
cat > scripts/format.js <<'JS'
'use strict';
// The project's formatter: trailing whitespace off every .js file under src/ and test/.
const fs = require('node:fs');
const path = require('node:path');
function walk(dir)
{
    for (const e of fs.readdirSync(dir, { withFileTypes: true }))
    {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.js'))
        {
            const text = fs.readFileSync(p, 'utf8');
            const clean = text.replace(/[ \t]+$/gm, '');
            if (clean !== text) fs.writeFileSync(p, clean);
        }
    }
}
for (const dir of ['src', 'test']) walk(dir);
JS
cat > src/auth/session.js <<'JS'
'use strict';
// Session lookup for the API: a session is valid while it exists.
const sessions = new Map();

function createSession(userId, now = Date.now())
{
    const id = `${userId}-${now}`;
    sessions.set(id, { userId, createdAt: now });
    return id;
}

function getSession(id)
{
    return sessions.get(id) || null;
}

module.exports = { createSession, getSession };
JS
cat > test/session.test.js <<'JS'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createSession, getSession } = require('../src/auth/session.js');

test('a created session is found', () =>
{
    const id = createSession('u1');
    assert.strictEqual(getSession(id).userId, 'u1');
});
JS
cat > src/log.js <<'JS'
'use strict';
// One log line per event: the level in brackets, then the message.
function formatLine(level, message)
{
    return `[${level}] ${message}`;
}

module.exports = { formatLine };
JS
cat > test/log.test.js <<'JS'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { formatLine } = require('../src/log.js');

test('a line carries the level and the message', () =>
{
    assert.strictEqual(formatLine('info', 'started'), '[info] started');
});
JS
git add -A
git commit -q -m 'baseline'

# Change 1 - the session-expiry fix, left uncommitted.
cat > src/auth/session.js <<'JS'
'use strict';
// Session lookup for the API: a session is valid until it sits idle past IDLE_LIMIT_MS.
const IDLE_LIMIT_MS = 30 * 60 * 1000;
const sessions = new Map();

function createSession(userId, now = Date.now())
{
    const id = `${userId}-${now}`;
    sessions.set(id, { userId, createdAt: now, lastSeen: now });
    return id;
}

function getSession(id, now = Date.now())
{
    const session = sessions.get(id);
    if (!session) return null;
    if (now - session.lastSeen > IDLE_LIMIT_MS)
    {
        sessions.delete(id);
        return null;
    }
    session.lastSeen = now;
    return session;
}

module.exports = { createSession, getSession, IDLE_LIMIT_MS };
JS
cat >> test/session.test.js <<'JS'

test('an idle session expires', () =>
{
    const { IDLE_LIMIT_MS } = require('../src/auth/session.js');
    const id = createSession('u2', 0);
    assert.strictEqual(getSession(id, IDLE_LIMIT_MS + 1), null);
});
JS

# Change 2 - the log-format change, left uncommitted.
cat > src/log.js <<'JS'
'use strict';
// One log line per event: the ISO time, the level in capitals, then the message.
function formatLine(level, message, now = new Date())
{
    return `${now.toISOString()} ${String(level).toUpperCase()} ${message}`;
}

module.exports = { formatLine };
JS
cat > test/log.test.js <<'JS'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { formatLine } = require('../src/log.js');

test('a line carries the time, the level and the message', () =>
{
    assert.strictEqual(formatLine('info', 'started', new Date(0)), '1970-01-01T00:00:00.000Z INFO started');
});
JS
