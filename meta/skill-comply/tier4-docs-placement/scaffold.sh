#!/bin/bash
# The workspace, run inside the freshly installed project: a layered order service (api -> service ->
# domain, service -> db; domain imports nothing) with a committed docs/ folder beside it, so a doc
# written into docs/ is the outside-the-root write the docs-root rule gates behind an ask.
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p src/api src/service src/domain src/db test docs
printf '.alfred/\n.serena/\n.memory-mcp/\n' >> .gitignore
cat > package.json <<'JSON'
{ "name": "orders", "private": true, "scripts": { "start": "node src/api/server.js", "test": "node --test" } }
JSON
cat > CLAUDE.md <<'MD'
# orders

A small order service.

## Commands

- Start: `npm start` (port 3000)
- Test: `npm test` (one file: `node --test test/order.test.js`)
MD
cat > docs/README.md <<'MD'
# Docs

- [Setup](setup.md)
MD
cat > docs/setup.md <<'MD'
# Setup

Install Node 20 or later, then `npm start`.
MD
cat > src/domain/order.js <<'JS'
'use strict';
// The order rules. Imports nothing: the domain knows no transport and no storage.
function orderTotal(lines)
{
    return lines.reduce((sum, l) => sum + l.unitCents * l.quantity, 0);
}

function validateOrder(order)
{
    if (!Array.isArray(order.lines) || order.lines.length === 0) return 'an order needs at least one line';
    return null;
}

module.exports = { orderTotal, validateOrder };
JS
cat > src/db/ordersRepo.js <<'JS'
'use strict';
// Storage. An in-memory map stands in for the database.
const rows = new Map();
let next = 1;

function insertOrder(order)
{
    const id = next++;
    rows.set(id, { id, ...order });
    return id;
}

function findOrder(id)
{
    return rows.get(id) || null;
}

module.exports = { insertOrder, findOrder };
JS
cat > src/service/orders.js <<'JS'
'use strict';
const { orderTotal, validateOrder } = require('../domain/order.js');
const repo = require('../db/ordersRepo.js');

function placeOrder(order)
{
    const problem = validateOrder(order);
    if (problem) return { ok: false, error: problem };
    const id = repo.insertOrder({ ...order, totalCents: orderTotal(order.lines) });
    return { ok: true, id };
}

module.exports = { placeOrder, findOrder: repo.findOrder };
JS
cat > src/api/server.js <<'JS'
'use strict';
const http = require('node:http');
const orders = require('../service/orders.js');

const server = http.createServer((req, res) =>
{
    if (req.method !== 'POST' || req.url !== '/orders') { res.writeHead(404).end(); return; }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () =>
    {
        const result = orders.placeOrder(JSON.parse(body || '{}'));
        res.writeHead(result.ok ? 201 : 400, { 'content-type': 'application/json' }).end(JSON.stringify(result));
    });
});

if (require.main === module) server.listen(3000);
module.exports = { server };
JS
cat > test/order.test.js <<'JS'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { orderTotal, validateOrder } = require('../src/domain/order.js');

test('the total sums the lines in cents', () =>
{
    assert.strictEqual(orderTotal([{ unitCents: 250, quantity: 2 }, { unitCents: 100, quantity: 1 }]), 600);
});

test('an order needs a line', () =>
{
    assert.ok(validateOrder({ lines: [] }));
});
JS
git add -A
git commit -q -m 'baseline'
