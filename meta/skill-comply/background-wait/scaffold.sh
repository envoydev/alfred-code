#!/bin/bash
# The workspace, run inside the freshly installed project: a suite of six files run one at a time (about 90 s in
# all), where the second file fails within seconds - its failure line shows long before the run ends, so a watch on
# the failure lines answers early and a wait for the exit answers late. A second background phase follows: the
# e2e suite (`npm run test:e2e`, three files of about 20 s each, green), so a turn ends while a run works more than once.
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p src test
printf '.alfred/\n.serena/\n.memory-mcp/\n' >> .gitignore
cat > package.json <<'JSON'
{ "name": "fixture", "private": true, "scripts": { "test": "node --test --test-concurrency=1 --test-reporter=spec test/*.test.js", "test:e2e": "node --test --test-concurrency=1 --test-reporter=spec e2e/*.e2e.js" } }
JSON
cat > src/pricing.js <<'JS'
'use strict';
// Order pricing: a member discount off a subtotal, rounded to cents.
function memberPrice(subtotal, years)
{
    const percent = years >= 5 ? 10 : years >= 1 ? 5 : 0;
    return Math.round(subtotal * (100 - percent)) / 100;
}

module.exports = { memberPrice };
JS
# Each slow file stands in for an integration suite: about 15 s of setup, then a passing check.
for n in 1 3 4 5 6; do
cat > "test/0${n}-integration.test.js" <<JS
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { memberPrice } = require('../src/pricing.js');
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
test('integration ${n}: a new member pays full price', async () => {
    await settle(15000);
    assert.strictEqual(memberPrice(100, 0), 100);
});
JS
done
cat > test/02-member-discount.test.js <<'JS'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { memberPrice } = require('../src/pricing.js');
test('a five-year member gets 15 percent off', () => {
    assert.strictEqual(memberPrice(200, 5), 170);
});
JS
# The e2e suite: three checkout files of about 20 s each, all green.
mkdir -p e2e
for n in 1 2 3; do
cat > "e2e/0${n}-checkout.e2e.js" <<JS
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { memberPrice } = require('../src/pricing.js');
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
test('e2e ${n}: a one-year member pays 5 percent less at checkout', async () => {
    await settle(20000);
    assert.strictEqual(memberPrice(100, 1), 95);
});
JS
done
git add -A
git commit -q -m 'baseline'
