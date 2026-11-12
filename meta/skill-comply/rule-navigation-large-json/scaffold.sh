#!/bin/bash
# The navigation rule's large-file clause of the G2 A/B: a 1,500-product catalog (about 9,000 lines) to query.
# Stock is 0 for every id divisible by 40 - ids 40 to 1,480, 37 products - and 1 to 9 for the rest.
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p data
printf '.alfred/\n.serena/\n.memory-mcp/\nbin/\nobj/\n' >> .gitignore
cat > package.json <<'JSON'
{ "name": "catalog", "private": true, "scripts": { "test": "node --test" } }
JSON
node -e "
const items = [];
for (let id = 1; id <= 1500; id++)
    items.push({ id, name: 'Product ' + id, price: Number((1 + (id * 7) % 200 + 0.99).toFixed(2)), stock: id % 40 === 0 ? 0 : 1 + (id % 9) });
require('fs').writeFileSync('data/catalog.json', JSON.stringify(items, null, 2) + '\n');
"
git add -A
git commit -q -m 'baseline'
node -e "console.log(require('./data/catalog.json').filter((p) => p.stock === 0).length)" | grep -qx 37
