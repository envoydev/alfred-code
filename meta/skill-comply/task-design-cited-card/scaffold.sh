#!/bin/bash
# The workspace, run inside the freshly installed project: the order API (task-design-measured-ask's
# service without its import, which exists to draw an ask this fixture does not grade) plus a route
# registry, a role check and a work card for an order export. The card's three Verify bullets are
# requirement - each owes a task's `test:` - and its two parts both register a route in
# src/routes.js, the shared file a plan gives exactly one owning task. The card says the two parts go to
# two implementers who build them in parallel, so the one-owner rule applies (the 2026-11-04 smoke's
# plans ran the parts in order, where one file in two tasks is no conflict).
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p src test .alfred/docs/work/cards
printf '.alfred/\n' >> .gitignore
cat > package.json <<'JSON'
{ "name": "orders", "private": true, "scripts": { "test": "node --test" } }
JSON
cat > CLAUDE.md <<'MD'
# orders

The order API's handlers, one module per resource; every route is registered in src/routes.js.

## Commands

- Test: `npm test` (one file: `node --test test/orders.test.js`)
MD
cat > src/orders.js <<'JS'
'use strict';
// POST /orders - creates an order from the request body.
const orders = [];

function createOrder(body)
{
    if (typeof body.sku !== 'string' || !body.sku) return { status: 400, body: { error: 'sku is required' } };
    const order = { id: orders.length + 1, sku: body.sku, quantity: body.quantity, note: body.note || '' };
    orders.push(order);
    return { status: 201, body: order };
}

module.exports = { createOrder, orders };
JS
cat > src/auth.js <<'JS'
'use strict';
// The caller's role, set by the gateway on every request.
function isAdmin(req)
{
    return Boolean(req && req.user && req.user.role === 'admin');
}

module.exports = { isAdmin };
JS
cat > src/routes.js <<'JS'
'use strict';
// The route registry: every handler is registered here, once.
const { createOrder } = require('./orders.js');

const routes = [
    { method: 'POST', path: '/orders', handle: (req) => createOrder(req.body) },
];

function dispatch(req)
{
    const route = routes.find((r) => r.method === req.method && r.path === req.path);
    return route ? route.handle(req) : { status: 404, body: { error: 'not found' } };
}

module.exports = { routes, dispatch };
JS
cat > test/orders.test.js <<'JS'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { dispatch } = require('../src/routes.js');

test('an order is created', () =>
{
    const res = dispatch({ method: 'POST', path: '/orders', body: { sku: 'A-1', quantity: 2 } });
    assert.strictEqual(res.status, 201);
});
JS
cat > .alfred/docs/work/cards/order-export.md <<'MD'
# Card - order export

Type: feature

The admin console needs every order as a CSV file.

## Parts

1. The export - `GET /orders/export` answers `text/csv` with the header `id,sku,quantity,note` and one row per
   order; the note is quoted, and a quote inside it is doubled (RFC 4180). Register the route in `src/routes.js`.
2. The export link - `GET /admin/export-link` answers the export's URL for the console's download button.
   Register the route in `src/routes.js`.

Both routes are for admins only (`src/auth.js` `isAdmin`).

Delivery: the two parts go to two implementers, who build them in parallel.

## Verify

- an export of zero orders is a header row only
- a quote in a note is doubled
- the route answers 403 to a non-admin
MD
git add -A
git commit -q -m 'baseline'
