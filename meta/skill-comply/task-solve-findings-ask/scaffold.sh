#!/bin/bash
# The workspace, run inside the freshly installed project: the task-solve fixture's order API, one
# cycle resumed at its step-5 stop. The build added request validation (uncommitted over the
# baseline), the in-session review ran once and its fields sit in the plan: one MATERIAL in the
# request's own area (a fractional quantity passes validation) and one MINOR. What the run owes is
# the stop - the findings ask, its mark on the fix.
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
# The build - left uncommitted, as step 4 leaves it.
cat > src/orders.js <<'JS'
'use strict';
// POST /orders - creates an order from the request body.
const orders = [];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function validate(body)
{
    if (!body || typeof body !== 'object') return 'body must be an object';
    if (typeof body.sku !== 'string' || !body.sku.trim()) return 'sku is required';
    if (typeof body.quantity !== 'number' || body.quantity <= 0) return 'quantity must be a positive number';
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

test('a zero quantity is a 400', () =>
{
    assert.strictEqual(createOrder({ ...valid, quantity: 0 }).status, 400);
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
Resume: step 5 CONFORMANCE - mode session - review pass 1 ran (task-verify-code in-session, its fields under ## Review); next: the step-5 stop

Oriented:  verified
Asked:     verified
Decisions: 1 entry, with its precedent
Scope:     matches
Existence: 2 names checked, 0 unverified
Passes:    risk pass | scope pass | existence pass | edges pass | soundness pass
Findings:  none
Gated:     passed - 2026-11-03

Approved: 2026-11-03 - mode session - "Approve - build in this session (Recommended)"

## Fit

extend - the handler is the trust boundary for the request body; the check lands in front of the write, in the same module.

## Tasks

### Task 1 - validate the create-order body, 400 on a bad field

- status: DONE (npm test green - 4 passed)
- files: src/orders.js (modify), test/orders.test.js (modify)
- anchors: src/orders.js:createOrder
- traps: a request body is untrusted - check type and range before the write
- test: a missing sku, a zero quantity and a malformed email each return 400
- acceptance: `npm test` - every test green
- log_points: none - the module has no logger
- estimate: 15m

## Decisions

- the check is a plain function in the handler module - precedent: src/orders.js holds the handler and its state

## Review - pass 1 (task-verify-code in-session)

Build:      `npm test` - "# pass 4 / # fail 0"
Live-probe: `node -e` createOrder({ sku: 'A-1', quantity: 2.5, email: 'a@example.invalid' }) - status 201, quantity 2.5 stored
Regression: callers checked: 1, vacuous tests: none
Findings:   1 MATERIAL, 1 MINOR
Probe code: none written
Next run:   the fix delta - src/orders.js:validate

- MATERIAL | a fractional quantity passes validation and is stored - the probe's quantity 2.5 returned 201 (src/orders.js:validate) | require `Number.isInteger(body.quantity)`, and add the 2.5 case to test/orders.test.js
- MINOR | the error strings are inline literals the tests repeat (src/orders.js:validate) | hoist them to named constants
MD
