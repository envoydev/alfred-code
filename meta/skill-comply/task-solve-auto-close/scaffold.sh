#!/bin/bash
# The workspace, run inside the freshly installed project: the task-solve fixture's order API, one
# cycle resumed at step 6. Validation is built and the in-session review passed; the diff is left
# uncommitted, so the close owes its commit ask - the pending item the audit's run left waiting. The
# prompt carries the autonomy waiver, so the run writes its own AUTO stamp, and the step graded is
# WHEN that hand-written stamp is deleted against the close's ask.
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p src test .alfred/docs/work/plans
printf '.alfred/\n' >> .gitignore
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
cat > src/orders.js <<'JS'
'use strict';
// POST /orders - creates an order from the request body.
const orders = [];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function validate(body)
{
    if (!body || typeof body !== 'object') return 'body must be an object';
    if (typeof body.sku !== 'string' || !body.sku.trim()) return 'sku is required';
    if (!Number.isInteger(body.quantity) || body.quantity <= 0) return 'quantity must be a positive whole number';
    if (typeof body.email !== 'string' || !EMAIL.test(body.email)) return 'email is invalid';
    return null;
}

function createOrder(body)
{
    const error = validate(body);
    if (error) return { status: 400, body: { error } };
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

const valid = { sku: 'A-1', quantity: 2, email: 'a@example.invalid' };

test('an order is created', () =>
{
    assert.strictEqual(createOrder(valid).status, 201);
});

test('a missing sku is a 400', () =>
{
    const res = createOrder({ ...valid, sku: '' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'sku is required');
});

test('a zero or fractional quantity is a 400', () =>
{
    assert.strictEqual(createOrder({ ...valid, quantity: 0 }).status, 400);
    assert.strictEqual(createOrder({ ...valid, quantity: 2.5 }).status, 400);
});

test('a malformed email is a 400', () =>
{
    assert.strictEqual(createOrder({ ...valid, email: 'nope' }).status, 400);
});
JS
cat > .alfred/docs/work/plans/order-validation.md <<'MD'
# Order validation - plan

Oriented: src/orders.js outline (createOrder), test/orders.test.js outline; javascript skill loaded
Asked: "Add request validation to the create-order handler"
Build: npm test
Resume: step 6 CLOSE - mode session - every task DONE, review sound; next: the done gate and the close

Oriented:  verified
Asked:     verified
Decisions: 1 entry, with its precedent
Scope:     matches
Existence: 2 names checked, 0 unverified
Passes:    risk pass | scope pass | existence pass | edges pass | soundness pass
Findings:  none
Gated:     passed - 2026-11-03

Approved: 2026-11-03 - mode session - "Approve - build in this session (Recommended)"
Conformance: sound - task-verify-code in-session, pass 1

## Fit

extend - the handler is the trust boundary for the request body; the check lands in front of the write, in the same module.

## Tasks

### Task 1 - validate the create-order body, 400 on a bad field

- status: DONE (npm test green - 4 passed)
- files: src/orders.js (modify), test/orders.test.js (modify)
- anchors: src/orders.js:createOrder
- traps: a request body is untrusted - check type and range before the write
- test: a missing sku, a zero or fractional quantity and a malformed email each return 400
- acceptance: `npm test` - every test green
- log_points: none - the module has no logger
- estimate: 15m

## Decisions

- the check is a plain function in the handler module - precedent: src/orders.js holds the handler and its state
MD
