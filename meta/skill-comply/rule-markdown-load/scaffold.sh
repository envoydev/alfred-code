#!/bin/bash
# The markdown path rule clause of the G2 A/B: a small package whose README gains one section.
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p src test
printf '.alfred/\n.serena/\n.memory-mcp/\nbin/\nobj/\n' >> .gitignore
cat > package.json <<'JSON'
{ "name": "pricing", "private": true, "scripts": { "test": "node --test" } }
JSON
cat > src/pricing.js <<'JS'
'use strict';
// A price after a percentage discount, in the price's own unit.
function applyDiscount(price, percent)
{
    return price - (price * percent) / 100;
}

module.exports = { applyDiscount };
JS
cat > test/pricing.test.js <<'JS'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { applyDiscount } = require('../src/pricing.js');

test('ten percent off a hundred is ninety', () =>
{
    assert.strictEqual(applyDiscount(100, 10), 90);
});
JS
cat > README.md <<'MD'
# pricing

Discount arithmetic for the shop.

## Install

Clone the repository; there are no dependencies.

## Usage

```js
const { applyDiscount } = require('./src/pricing.js');
applyDiscount(100, 10); // 90
```
MD
git add -A
git commit -q -m 'baseline'
