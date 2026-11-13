#!/bin/bash
# The workspace, run inside the freshly installed project: the task-solve fixture's order API, one
# cycle resumed AT its step-3 approval. The plan is designed and gated, nothing is built. The
# project's fresh-session triggers are set low (30,000 tokens on every window tier) and the payback
# window wide, so the cycle is past its trigger when the approve ask is put and a fresh session pays
# back - the case where the approve template's fresh-session row is required and marked first. The
# plan ends in a long `## Task notes` appendix the resume reads, which lifts the carry past the
# first reply's floor.
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
# The stack's variables: every fresh-session trigger at 30,000 tokens, the payback window at its
# widest. The installer may already have written the file, so its lines for these keys are replaced.
V=.alfred/.variables
touch "$V"
grep -v -E '^(export )?ALFRED_CODE_(CONTEXT_WINDOW_(FOR_1M|FOR_300K|FOR_200K|DEFAULT)|FRESH_SESSION_PAYBACK)=' "$V" > "$V.next" || true
mv "$V.next" "$V"
cat >> "$V" <<'VARS'
ALFRED_CODE_CONTEXT_WINDOW_FOR_1M=30000
ALFRED_CODE_CONTEXT_WINDOW_FOR_300K=30000
ALFRED_CODE_CONTEXT_WINDOW_FOR_200K=30000
ALFRED_CODE_CONTEXT_WINDOW_DEFAULT=30000
ALFRED_CODE_FRESH_SESSION_PAYBACK=1000
VARS
PLANS=.alfred/docs/work/plans
if [ -f .claude/hooks/plan-status.js ]; then
# the after arm: this install carries the writer script - the plan is a folder, gated through it and not approved.
# resume prints the Markdown up to ## Tasks, then the open cards, so the notes sit ABOVE ## Tasks, after ## Fit.
PS="node .claude/hooks/plan-status.js"
mkdir -p "$PLANS/order-validation"
MDF="$PLANS/order-validation/order-validation.md"
cat > "$MDF" <<'MD'
# Order validation - plan

Oriented: src/orders.js outline (createOrder), test/orders.test.js outline; javascript skill loaded
Asked: "Add request validation to the create-order handler"
Size: standard
Build: npm test

## Fit

extend - the handler is the trust boundary for the request body; the check lands in front of the write, in the same module.

## Design notes

Context for the build, gathered while the plan was designed. None of it changes the scope below.
MD
# About 60,000 characters of plain notes, one per review pass over a field or a seam of the handler.
TOPICS=('the sku field' 'the quantity field' 'the email field' 'the order id counter' 'the 400 response body'
  'the 201 response body' 'the in-memory store' 'the test file layout' 'the module exports' 'the request body shape'
  'the error strings' 'the npm test command')
for i in $(seq 1 77); do
  T=${TOPICS[$(( i % 12 ))]}
  cat >> "$MDF" <<MD

### Note $i - $T

Note $i reads $T as it stands in src/orders.js before the build. The handler takes the request body on trust today, so $T reaches the store exactly as the caller sent it, and nothing in test/orders.test.js covers a bad value yet. Task 1 adds the check in front of the write; this note records what a reviewer looks at when the check lands: that $T is read once, that a missing or malformed value returns status 400 with one error string, and that a good value still returns 201 with the stored order. Pass $i of the review confirmed the module has no logger, so no log point is added, and the in-memory array stays the only state. Nothing here changes the scope; it is context for the build only.
MD
done
cat >> "$MDF" <<'MD'

## Tasks

### Task 1 - validate the create-order body, 400 on a bad field

- files: src/orders.js (modify), test/orders.test.js (modify)
- anchors: src/orders.js:createOrder
- traps: a request body is untrusted - check type and range before the write
- test: a missing sku, a fractional or zero quantity and a malformed email each return 400
- acceptance: `npm test` - every test green
- log_points: none - the module has no logger
- estimate: 15m

## Decisions

- the check is a plain function in the handler module - precedent: src/orders.js holds the handler and its state
MD
$PS sync --plan order-validation
$PS gate --plan order-validation <<'EOF'
Oriented:  verified
Asked:     verified
Decisions: 1 entry, with its precedent
Scope:     matches
Existence: 2 names checked, 0 unverified
Passes:    risk pass | scope pass | existence pass | edges pass | soundness pass
Findings:  none
Gated:     passed - 2026-11-03
EOF
$PS cursor --plan order-validation <<'EOF'
note: step 3 APPROVE
EOF
else
# the before arm (PF1 flat plan - until 4.0.0): an install from before the plan folder - the flat plan
PLAN=.alfred/docs/work/plans/order-validation.md
cat > "$PLAN" <<'MD'
# Order validation - plan

Oriented: src/orders.js outline (createOrder), test/orders.test.js outline; javascript skill loaded
Asked: "Add request validation to the create-order handler"
Size: standard
Build: npm test
Resume: step 3 APPROVE - next task 1

Oriented:  verified
Asked:     verified
Decisions: 1 entry, with its precedent
Scope:     matches
Existence: 2 names checked, 0 unverified
Passes:    risk pass | scope pass | existence pass | edges pass | soundness pass
Findings:  none
Gated:     passed - 2026-11-03

## Fit

extend - the handler is the trust boundary for the request body; the check lands in front of the write, in the same module.

## Tasks

### Task 1 - validate the create-order body, 400 on a bad field

- status: PENDING
- files: src/orders.js (modify), test/orders.test.js (modify)
- anchors: src/orders.js:createOrder
- traps: a request body is untrusted - check type and range before the write
- test: a missing sku, a fractional or zero quantity and a malformed email each return 400
- acceptance: `npm test` - every test green
- log_points: none - the module has no logger
- estimate: 15m

## Decisions

- the check is a plain function in the handler module - precedent: src/orders.js holds the handler and its state

## Task notes

Context for the build, gathered while the plan was designed. None of it changes the scope above.
MD
# About 60,000 characters of plain notes, one per review pass over a field or a seam of the handler.
TOPICS=('the sku field' 'the quantity field' 'the email field' 'the order id counter' 'the 400 response body'
  'the 201 response body' 'the in-memory store' 'the test file layout' 'the module exports' 'the request body shape'
  'the error strings' 'the npm test command')
for i in $(seq 1 77); do
  T=${TOPICS[$(( i % 12 ))]}
  cat >> "$PLAN" <<MD

### Note $i - $T

Note $i reads $T as it stands in src/orders.js before the build. The handler takes the request body on trust today, so $T reaches the store exactly as the caller sent it, and nothing in test/orders.test.js covers a bad value yet. Task 1 adds the check in front of the write; this note records what a reviewer looks at when the check lands: that $T is read once, that a missing or malformed value returns status 400 with one error string, and that a good value still returns 201 with the stored order. Pass $i of the review confirmed the module has no logger, so no log point is added, and the in-memory array stays the only state. Nothing here changes the scope; it is context for the build only.
MD
done
fi
