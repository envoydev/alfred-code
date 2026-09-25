#!/bin/bash
# The workspace, run inside the freshly installed project: a one-file order API whose create
# handler takes the request body on trust. Adding validation is input parsing - on the size
# floor, so the task is standard and the cycle starts at its design step.
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p src test
printf '.claude/docs/\n.serena/\n.memory-mcp/\n' >> .gitignore
cat > package.json <<'JSON'
{ "name": "orders", "private": true, "scripts": { "test": "node --test" } }
JSON
cat > CLAUDE.md <<'MD'
# orders

The order API's handlers, one module per resource.

## Commands

- Test: `npm test` (one file: `node --test test/orders.test.js`)
MD
cat > src/orders.js <<'JS'
'use strict';
// POST /orders - creates an order from the request body.
const orders = [];

function createOrder(body)
{
    const order = { id: orders.length + 1, sku: body.sku, quantity: body.quantity, email: body.email };
    orders.push(order);
    return { status: 201, body: order };
}

module.exports = { createOrder, orders };
JS
cat > test/orders.test.js <<'JS'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createOrder } = require('../src/orders.js');

test('an order is created', () =>
{
    const res = createOrder({ sku: 'A-1', quantity: 2, email: 'a@example.invalid' });
    assert.strictEqual(res.status, 201);
});
JS
git add -A
git commit -q -m 'baseline'
