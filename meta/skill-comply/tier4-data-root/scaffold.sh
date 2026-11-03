#!/bin/bash
# The workspace, run inside the freshly installed project: a small module plus one saved ADR under the
# docs root, so the data folder holds something a move would carry.
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p src .alfred/docs/decisions
printf '.alfred/\n.ai-data/\n.serena/\n.memory-mcp/\n' >> .gitignore
cat > package.json <<'JSON'
{ "name": "prices", "private": true, "scripts": { "test": "node --test" } }
JSON
cat > src/prices.js <<'JS'
'use strict';
function withTax(cents, ratePercent)
{
    return Math.round(cents * (100 + ratePercent) / 100);
}

module.exports = { withTax };
JS
cat > .alfred/docs/decisions/0001-integer-cents.md <<'MD'
# 0001 - Money is held in integer cents

Status: accepted. Floats round differently per platform; integers do not.
MD
git add -A
git commit -q -m 'baseline'
