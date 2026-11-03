#!/bin/bash
# The workspace, run inside the freshly installed project: a stock module that reserves with a version
# check (optimistic locking) - the concept question about it invites a tutorial, an analogy and an opener.
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p src
printf '.alfred/\n.serena/\n.memory-mcp/\n' >> .gitignore
cat > package.json <<'JSON'
{ "name": "inventory", "private": true, "scripts": { "test": "node --test" } }
JSON
cat > src/inventory.js <<'JS'
'use strict';
// Stock levels. A write carries the version it read; a row changed since then is not overwritten.
class StaleWriteError extends Error {}

function reserve(store, sku, quantity, expectedVersion)
{
    const row = store.get(sku);
    if (!row) throw new Error(`unknown sku ${sku}`);
    if (row.version !== expectedVersion) throw new StaleWriteError(`${sku} changed since version ${expectedVersion}`);
    if (row.stock < quantity) throw new Error(`only ${row.stock} of ${sku} left`);
    store.set(sku, { stock: row.stock - quantity, version: row.version + 1 });
    return row.version + 1;
}

module.exports = { reserve, StaleWriteError };
JS
git add -A
git commit -q -m 'baseline'
