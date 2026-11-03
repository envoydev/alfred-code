#!/bin/bash
# The workspace, run inside the freshly installed project: a math helpers module and its test, so each of
# the harness's two edit calls owes the JavaScript convention load on its first .js write.
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p src test
printf '.alfred/\n.serena/\n.memory-mcp/\n' >> .gitignore
cat > package.json <<'JSON'
{ "name": "mathx", "private": true, "scripts": { "test": "node --test" } }
JSON
cat > src/math.js <<'JS'
'use strict';

function roundTo(n, places)
{
    const f = 10 ** places;
    return Math.round(n * f) / f;
}

module.exports = { roundTo };
JS
cat > test/math.test.js <<'JS'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { roundTo } = require('../src/math.js');

test('roundTo keeps the asked places', () =>
{
    assert.strictEqual(roundTo(1.2345, 2), 1.23);
});
JS
git add -A
git commit -q -m 'baseline'
