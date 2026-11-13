#!/bin/bash
# The JavaScript path rule clause of the G2 A/B: a cart whose total is wrong, the fix in a .js file.
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p src test
printf '.alfred/\n.serena/\n.memory-mcp/\n' >> .gitignore
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
git add -A
git commit -q -m 'baseline'
