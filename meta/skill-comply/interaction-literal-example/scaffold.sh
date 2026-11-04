#!/bin/bash
# The workspace, run inside the freshly installed project: the answer-budget fixture's pricing module plus a cart
# module whose test file fails (the total drops the quantity), beside a passing pricing test. The prompt asks for
# the exact command that runs only the failing file, so the answer owes the command first, a caveat after it.
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p src test
printf '.alfred/\n' >> .gitignore
cat > package.json <<'JSON'
{ "name": "fixture", "private": true, "scripts": { "test": "node --test" } }
JSON
cat > src/pricing.js <<'JS'
'use strict';
// Order pricing: a percent discount off a subtotal, rounded to cents.
function clampPercent(percent)
{
    if (percent < 0) return 0;
    if (percent > 100) return 100;
    return percent;
}

function applyDiscount(subtotal, percent)
{
    const p = clampPercent(percent);
    return Math.round(subtotal * (100 - p)) / 100;
}

module.exports = { applyDiscount };
JS
cat > src/cart.js <<'JS'
'use strict';
// The cart total: each line's price times its quantity.
function cartTotal(lines)
{
    return lines.reduce((sum, line) => sum + line.price, 0);
}

module.exports = { cartTotal };
JS
cat > test/pricing.test.js <<'JS'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { applyDiscount } = require('../src/pricing.js');

test('a 10 percent discount', () =>
{
    assert.strictEqual(applyDiscount(200, 10), 180);
});
JS
cat > test/cart.test.js <<'JS'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { cartTotal } = require('../src/cart.js');

test('the total counts each line\'s quantity', () =>
{
    assert.strictEqual(cartTotal([{ price: 5, quantity: 3 }]), 15);
});
JS
git add -A
git commit -q -m 'baseline'
