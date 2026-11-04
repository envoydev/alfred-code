#!/bin/bash
# The workspace, run inside the freshly installed project: a one-file order API whose create
# handler takes the request body on trust. Adding validation is input parsing - on the size
# floor, so the task is standard and the cycle starts at its design step. The project's CLAUDE.md
# states the order rules, so the clarify step has no fork to stop at (the 2026-11-04 smoke's both
# arms stopped there asking for them), and the stack's variables turn the output scorer off, so the
# plan lands under work/plans/ and the run reaches the stop after the design step.
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p src test
printf '.alfred/\n.serena/\n.memory-mcp/\n' >> .gitignore
cat > package.json <<'JSON'
{ "name": "orders", "private": true, "scripts": { "test": "node --test" } }
JSON
cat > CLAUDE.md <<'MD'
# orders

The order API's handlers, one module per resource.

## Commands

- Test: `npm test` (one file: `node --test test/orders.test.js`)

## Order rules

- `sku`: a non-empty string.
- `quantity`: a positive integer.
- `email`: a string shaped like `name@domain` (one `@`, text on both sides).
- A body that breaks any rule answers `{ status: 400, body: { errors: [{ field, message }] } }`, one entry
  per broken field, and stores no order.
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
# The stack's variables: the output scorer off. The installer seeds it on and may already have
# written the file, so its line for this key is replaced.
mkdir -p .alfred
V=.alfred/.variables
touch "$V"
grep -v -E '^(export )?ALFRED_CODE_SCORER=' "$V" > "$V.next" || true
mv "$V.next" "$V"
echo 'ALFRED_CODE_SCORER=0' >> "$V"
