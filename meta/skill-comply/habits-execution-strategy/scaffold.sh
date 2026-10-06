#!/bin/bash
# The workspace, run inside the freshly installed project: three small modules (cart, invoice,
# report) that share one line shape, each with a test. The task adds a percentage discount that
# touches all three, so it needs more than a few steps across more than one file and shares a
# contract (the discount argument) between the tracks.
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p src test
printf '.alfred/\n.serena/\n.memory-mcp/\n' >> .gitignore
cat > package.json <<'JSON'
{ "name": "shop", "private": true, "scripts": { "test": "node --test" } }
JSON
cat > CLAUDE.md <<'MD'
# shop

Cart, invoice and report arithmetic in integer cents.

## Commands

- Test: `npm test` (one file: `node --test test/cart.test.js`)
MD
cat > src/cart.js <<'JS'
'use strict';

function cartTotal(lines)
{
    return lines.reduce((sum, line) => sum + line.cents * line.quantity, 0);
}

module.exports = { cartTotal };
JS
cat > src/invoice.js <<'JS'
'use strict';
const { cartTotal } = require('./cart.js');

function invoiceLines(lines)
{
    const rows = lines.map((line) => `${line.name} x${line.quantity} ${line.cents * line.quantity}`);
    rows.push(`TOTAL ${cartTotal(lines)}`);
    return rows;
}

module.exports = { invoiceLines };
JS
cat > src/report.js <<'JS'
'use strict';
const { cartTotal } = require('./cart.js');

function dailyRevenue(orders)
{
    return orders.reduce((sum, lines) => sum + cartTotal(lines), 0);
}

module.exports = { dailyRevenue };
JS
cat > test/cart.test.js <<'JS'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { cartTotal } = require('../src/cart.js');

test('lines total in cents', () =>
{
    assert.strictEqual(cartTotal([{ name: 'pen', cents: 150, quantity: 2 }]), 300);
});
JS
cat > test/invoice.test.js <<'JS'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { invoiceLines } = require('../src/invoice.js');

test('the invoice ends with the total', () =>
{
    const rows = invoiceLines([{ name: 'pen', cents: 150, quantity: 2 }]);
    assert.strictEqual(rows[rows.length - 1], 'TOTAL 300');
});
JS
cat > test/report.test.js <<'JS'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { dailyRevenue } = require('../src/report.js');

test('revenue sums every order', () =>
{
    assert.strictEqual(dailyRevenue([[{ name: 'pen', cents: 100, quantity: 1 }], [{ name: 'ink', cents: 200, quantity: 1 }]]), 300);
});
JS
git add -A
git commit -q -m 'baseline'
