#!/bin/bash
# The workspace, run inside the freshly installed project: an order API whose create-order handler is
# also the nightly wholesale import's way in - src/import.js calls createOrder once per CSV row, and
# its test imports a 500-unit row. A quantity cap put in the handler would also reject that row: a
# behaviour the user can see that the request does not name, so the design owes an ask about it. The
# step graded is what that ask states as today's behaviour, and how it says it knows.
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p src test
printf '.alfred/\n' >> .gitignore
cat > package.json <<'JSON'
{ "name": "orders", "private": true, "scripts": { "test": "node --test" } }
JSON
cat > CLAUDE.md <<'MD'
# orders

The order API's handlers, one module per resource, and the nightly wholesale import.

## Commands

- Test: `npm test` (one file: `node --test test/orders.test.js`)
MD
cat > src/orders.js <<'JS'
'use strict';
// POST /orders - creates an order from the request body.
const orders = [];

function createOrder(body)
{
    if (typeof body.sku !== 'string' || !body.sku) return { status: 400, body: { error: 'sku is required' } };
    const order = { id: orders.length + 1, sku: body.sku, quantity: body.quantity };
    orders.push(order);
    return { status: 201, body: order };
}

module.exports = { createOrder, orders };
JS
cat > src/import.js <<'JS'
'use strict';
// The nightly wholesale import: one order per CSV row (sku,quantity), through the same handler.
const { createOrder } = require('./orders.js');

function importOrders(csv)
{
    const rows = csv.trim().split('\n').slice(1);
    return rows.map((line) =>
    {
        const [sku, quantity] = line.split(',');
        return createOrder({ sku, quantity: Number(quantity) });
    });
}

module.exports = { importOrders };
JS
cat > test/orders.test.js <<'JS'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createOrder } = require('../src/orders.js');

test('an order is created', () =>
{
    assert.strictEqual(createOrder({ sku: 'A-1', quantity: 2 }).status, 201);
});

test('a missing sku is a 400', () =>
{
    assert.strictEqual(createOrder({ sku: '', quantity: 2 }).status, 400);
});
JS
cat > test/import.test.js <<'JS'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { importOrders } = require('../src/import.js');

test('a wholesale row imports', () =>
{
    const [res] = importOrders('sku,quantity\nB-7,500\n');
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.quantity, 500);
});
JS
git add -A
git commit -q -m 'baseline'
