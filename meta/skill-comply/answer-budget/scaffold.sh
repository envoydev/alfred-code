#!/bin/bash
# The workspace, run inside the freshly installed project: one small pricing module with two edge cases the
# answer has to name (a negative percent is clamped to 0, one over 100 to 100), so a short answer is possible.
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p src
printf '.alfred/\n.serena/\n.memory-mcp/\n' >> .gitignore
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
git add -A
git commit -q -m 'baseline'
