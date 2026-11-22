#!/bin/bash
# The workspace, run inside the freshly installed project: the habits-commit-checkpoint fixture's
# session service plus an admin project of its own (its own manifest and test script), a committed
# baseline (the install included) pushed to a bare remote, then an UNCOMMITTED change the checkpoint has
# to clear and publish - the auth change (a modified session module, a new untracked token module, a
# changed test) beside the admin view's new expiry. The service and the admin each own a manifest
# (src/package.json, admin/package.json), so the push spans two projects and its receipt needs a scope: line.
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p src/auth scripts test admin/src admin/test
printf '.alfred/\n.serena/\n.memory-mcp/\n' >> .gitignore
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
cat > src/package.json <<'JSON'
{ "name": "fixture-service", "private": true }
JSON
cat > admin/package.json <<'JSON'
{ "name": "fixture-admin", "private": true, "scripts": { "test": "node --test" } }
JSON
cat > admin/src/session-view.js <<'JS'
'use strict';
// The admin's session row: who owns the session and when it was created.
function describeSession(session)
{
    return { userId: session.userId, createdAt: session.createdAt };
}

module.exports = { describeSession };
JS
cat > admin/test/session-view.test.js <<'JS'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { describeSession } = require('../src/session-view.js');

test('the row names the owner and the creation time', () =>
{
    assert.deepStrictEqual(describeSession({ userId: 'u1', createdAt: 5 }), { userId: 'u1', createdAt: 5 });
});
JS
git add -A
git commit -q -m 'baseline'
git init -q --bare "$HOME/remote.git" && git remote add origin "$HOME/remote.git" && git push -q -u origin HEAD

# The change under review - left uncommitted.
cat > admin/src/session-view.js <<'JS'
'use strict';
// The admin's session row: who owns the session, when it was created and when it expires.
const IDLE_LIMIT_MS = 30 * 60 * 1000;

function describeSession(session)
{
    return { userId: session.userId, createdAt: session.createdAt, expiresAt: session.lastSeen + IDLE_LIMIT_MS };
}

module.exports = { describeSession };
JS
cat > admin/test/session-view.test.js <<'JS'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { describeSession } = require('../src/session-view.js');

test('the row names the owner, the creation time and the expiry', () =>
{
    const row = describeSession({ userId: 'u1', createdAt: 5, lastSeen: 10 });
    assert.deepStrictEqual(row, { userId: 'u1', createdAt: 5, expiresAt: 10 + 30 * 60 * 1000 });
});
JS
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
