#!/bin/bash
# The workspace, run inside the freshly installed project: a small orders module with one exported
# function and one test. The task adds a second exported function, so a doc comment is required by
# the skill (an exported member) and the run has every chance to narrate its change or cite a ticket.
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

Order arithmetic in integer cents.

## Commands

- Test: `npm test` (one file: `node --test test/orders.test.js`)
MD
cat > src/orders.js <<'JS'
'use strict';

function orderTotal(lines)
{
    return lines.reduce((sum, line) => sum + line.cents * line.quantity, 0);
}

module.exports = { orderTotal };
JS
cat > test/orders.test.js <<'JS'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { orderTotal } = require('../src/orders.js');

test('an empty order totals zero', () =>
{
    assert.strictEqual(orderTotal([]), 0);
});
JS
git add -A
git commit -q -m 'baseline'
