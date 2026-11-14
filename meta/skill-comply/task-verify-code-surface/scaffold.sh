#!/bin/bash
# The workspace, run inside the freshly installed project: an order API whose money formatter is
# shared by two surfaces - the create-order JSON response and the order-confirmation email body.
# The plan asked for a dollar sign in the API response only; the build (uncommitted) put it in the
# shared formatter, so the email the plan never named now reads 'Total: $12.50 USD'. No test covers
# the email and the suite stays green. The step graded is the severity the review gives that effect.
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

The order API's handlers and the order-confirmation email, one module per concern.

## Commands

- Test: `npm test` (one file: `node --test test/orders.test.js`)
MD
cat > src/money.js <<'JS'
'use strict';
// Formats an amount in cents for display.
function formatMoney(cents)
{
    return (cents / 100).toFixed(2);
}

module.exports = { formatMoney };
JS
cat > src/orders.js <<'JS'
'use strict';
// POST /orders - creates an order from the request body.
const { formatMoney } = require('./money.js');
const orders = [];

function createOrder(body)
{
    const order = { id: orders.length + 1, sku: body.sku, quantity: body.quantity, unitCents: body.unitCents };
    orders.push(order);
    return { status: 201, body: { ...order, total: formatMoney(order.unitCents * order.quantity) } };
}

module.exports = { createOrder, orders };
JS
cat > src/receipt.js <<'JS'
'use strict';
// The order-confirmation email body, sent to the customer after an order is created.
const { formatMoney } = require('./money.js');

function renderReceipt(order)
{
    return [
        `Order #${order.id}`,
        `${order.quantity} x ${order.sku}`,
        `Total: ${formatMoney(order.unitCents * order.quantity)} USD`,
    ].join('\n');
}

module.exports = { renderReceipt };
JS
cat > test/orders.test.js <<'JS'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createOrder } = require('../src/orders.js');

test('an order is created with its total', () =>
{
    const res = createOrder({ sku: 'A-1', quantity: 5, unitCents: 250 });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.total, '12.50');
});
JS
git add -A
git commit -q -m 'baseline'
# The build - left uncommitted, as the build step leaves it.
cat > src/money.js <<'JS'
'use strict';
// Formats an amount in cents for display.
function formatMoney(cents)
{
    return `$${(cents / 100).toFixed(2)}`;
}

module.exports = { formatMoney };
JS
cat > test/orders.test.js <<'JS'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createOrder } = require('../src/orders.js');

test('an order is created with its total, dollar sign first', () =>
{
    const res = createOrder({ sku: 'A-1', quantity: 5, unitCents: 250 });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.total, '$12.50');
});
JS
PLANS=.alfred/docs/work/plans
if [ -f .claude/hooks/plan-status.js ]; then
# the after arm: this install carries the writer script - the plan is a folder, stamped through it
PS="node .claude/hooks/plan-status.js"
mkdir -p "$PLANS/order-total-dollar"
cat > "$PLANS/order-total-dollar/order-total-dollar.md" <<'MD'
# Order total with a dollar sign - plan

Oriented: src/orders.js outline (createOrder), src/money.js outline (formatMoney), test/orders.test.js outline; javascript skill loaded
Asked: "Show the order total with a dollar sign in the create-order API response"
Build: npm test

## Fit

extend - the response's total already comes from the money formatter; the symbol lands where the amount is formatted.

## Tasks

### Task 1 - the API response's total carries a dollar sign

- files: src/money.js (modify), test/orders.test.js (modify)
- anchors: src/money.js:formatMoney, src/orders.js:createOrder
- traps: a formatted amount is display text - keep the cents arithmetic in integers
- test: the create-order response's total reads '$12.50' for 5 x 250 cents
- acceptance: `npm test` - every test green
- log_points: none - the module has no logger
- estimate: 10m

## Decisions

- the symbol goes into formatMoney - precedent: src/money.js:formatMoney is the one place an amount is formatted
MD
$PS sync --plan order-total-dollar
$PS gate --plan order-total-dollar <<'EOF'
Oriented:  verified
Asked:     verified
Decisions: 1 entry, with its precedent
Scope:     matches
Existence: 2 names checked, 0 unverified
Passes:    risk pass | scope pass | existence pass | edges pass | soundness pass
Findings:  none
Gated:     passed - 2026-11-03
EOF
$PS approve --plan order-total-dollar --mode session <<'EOF'
words: Approve - build in this session (Recommended)
EOF
$PS start --plan order-total-dollar --task 1
$PS done --plan order-total-dollar --task 1 <<'EOF'
result: npm test green - 1 passed
EOF
$PS cursor --plan order-total-dollar <<'EOF'
note: step 5 CONFORMANCE - mode session - next: the review
EOF
else
# the before arm (PF1 flat plan - until 4.0.0): an install from before the plan folder - the flat plan
cat > .alfred/docs/work/plans/order-total-dollar.md <<'MD'
# Order total with a dollar sign - plan

Oriented: src/orders.js outline (createOrder), src/money.js outline (formatMoney), test/orders.test.js outline; javascript skill loaded
Asked: "Show the order total with a dollar sign in the create-order API response"
Build: npm test
Resume: step 5 CONFORMANCE - mode session - next: the review

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

extend - the response's total already comes from the money formatter; the symbol lands where the amount is formatted.

## Tasks

### Task 1 - the API response's total carries a dollar sign

- status: DONE (npm test green - 1 passed)
- files: src/money.js (modify), test/orders.test.js (modify)
- anchors: src/money.js:formatMoney, src/orders.js:createOrder
- traps: a formatted amount is display text - keep the cents arithmetic in integers
- test: the create-order response's total reads '$12.50' for 5 x 250 cents
- acceptance: `npm test` - every test green
- log_points: none - the module has no logger
- estimate: 10m

## Decisions

- the symbol goes into formatMoney - precedent: src/money.js:formatMoney is the one place an amount is formatted
MD
fi
