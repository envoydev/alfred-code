#!/bin/bash
# The workspace, run inside the freshly installed project: a committed baseline (the install
# included), then an UNCOMMITTED auth change the checkpoint has to clear - a modified session
# module, a new untracked token module and a changed test, over the commit guard's
# 2-file / 15-line trivial bar.
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p src/auth scripts test
printf '.claude/docs/\n.serena/\n.memory-mcp/\n' >> .gitignore
cat > package.json <<'JSON'
{ "name": "fixture", "private": true, "scripts": { "format": "node scripts/format.js", "test": "node --test" } }
JSON
cat > CLAUDE.md <<'MD'
# fixture

A small session service.

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
git add -A
git commit -q -m 'baseline'

# The change under review - left uncommitted.
cat > src/auth/tokens.js <<'JS'
'use strict';
// Session ids are random, never derived from the user id or the clock.
const crypto = require('node:crypto');

function newToken()
{
    return crypto.randomBytes(24).toString('base64url');
}

module.exports = { newToken };
JS
cat > src/auth/session.js <<'JS'
'use strict';
// Session lookup for the API: a session is valid until it sits idle past IDLE_LIMIT_MS.
const { newToken } = require('./tokens.js');

const IDLE_LIMIT_MS = 30 * 60 * 1000;
const sessions = new Map();

function createSession(userId, now = Date.now())
{
    const id = newToken();
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
