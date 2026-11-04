#!/bin/bash
# The workspace, run inside the freshly installed project: the habits-root-cause fixture's cart, one
# diagnosis resumed at its step-4 fork. The findings file is stamped through step 3 - the observable,
# tier 1, the gathered test run and a proven cause (src/money.js:toCents, parseFloat stops at the
# thousands comma) - and the cursor note on the handoff bus says step 4. The prompt picks 'plan the
# fix as tasks', so what the run owes is 4b: the execution strategy loaded, the cards written under
# '## Tasks', and the close ask that carries the strategy's Execution line. The suite stays RED.
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p src test .alfred/docs/work/diagnoses
printf '.alfred/\n' >> .gitignore
cat > package.json <<'JSON'
{ "name": "cart", "private": true, "scripts": { "test": "node --test" } }
JSON
cat > CLAUDE.md <<'MD'
# cart

The shop's cart arithmetic, in integer cents.

## Commands

- Test: `npm test` (one file: `node --test test/cart.test.js`)
MD
cat > src/money.js <<'JS'
'use strict';
// Prices arrive as the catalog prints them: '0.50', '12.00', '1,299.00'.
function toCents(price)
{
    return Math.round(parseFloat(price) * 100);
}

module.exports = { toCents };
JS
cat > src/cart.js <<'JS'
'use strict';
const { toCents } = require('./money.js');

// The cart total in cents.
function cartTotal(lines)
{
    return lines.reduce((sum, line) => sum + toCents(line.price) * line.quantity, 0);
}

module.exports = { cartTotal };
JS
cat > test/cart.test.js <<'JS'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { cartTotal } = require('../src/cart.js');

test('an empty cart totals zero', () =>
{
    assert.strictEqual(cartTotal([]), 0);
});

test('small prices total in cents', () =>
{
    assert.strictEqual(cartTotal([{ price: '0.50', quantity: 2 }, { price: '12.00', quantity: 1 }]), 1300);
});

test('a thousand-priced item totals in cents', () =>
{
    assert.strictEqual(cartTotal([{ price: '1,299.00', quantity: 1 }, { price: '0.50', quantity: 2 }]), 130000);
});
JS
cat > .alfred/docs/work/diagnoses/cart-total.md <<'MD'
# Diagnosis - the cart total is wrong for a thousand-priced item

Observable: `npm test` fails 'a thousand-priced item totals in cents' - `cartTotal` returns 200 for one
1,299.00 line and two 0.50 lines; expected 130000.
Tier: 1 (a failing test - test/cart.test.js, 'a thousand-priced item totals in cents')
Gathered: 1 source - the test run, reproduced inline with `node --test test/cart.test.js`
Cause: src/money.js:toCents - `parseFloat('1,299.00')` stops at the thousands comma and returns 1, so the
line counts 100 cents instead of 129900. Proven by `node -e "console.log(require('./src/money.js').toCents('1,299.00'))"`, which prints 100.
Severity: high - every price of 1,000 or more is charged wrong. Priority: P1.
Outcome: <pending>

## Evidence

```text
$ node --test test/cart.test.js
✖ a thousand-priced item totals in cents
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  200 !== 130000
ℹ tests 3
ℹ pass 2
ℹ fail 1
```

## Hypotheses

1. `cartTotal` multiplies the quantity wrong - killed: 'small prices total in cents' passes with a quantity of 2.
2. `toCents` misreads a price with a thousands separator - confirmed: `toCents('1,299.00')` is 100.

## Cause

`toCents` in src/money.js hands the catalog's printed price straight to `parseFloat`, which reads up to
the first character that is not part of a number. The comma in '1,299.00' ends the read at 1. The
symptom shows where the lines are summed (src/cart.js), but cart.js is right; the root fix is one line
in `toCents`. Blast radius: every caller of `toCents` - today `cartTotal` alone.
MD
node .claude/hooks/handoff.js put cart-total/diagnosis/cursor <<'NOTE'
step 4 THE FORK - mode inline - cause proven at src/money.js:toCents (parseFloat stops at the thousands comma)
findings: .alfred/docs/work/diagnoses/cart-total.md - Tier 1, Gathered, Cause stamped; Outcome pending
next: the fork - report, plan the fix as tasks, or add log points - on the user's pick
NOTE
git add -A
git commit -q -m 'baseline'
