#!/bin/bash
# The workspace, run inside the freshly installed project: a small orders service (a route table, the
# order rules, the SQL behind them) with a docs root that holds an architecture map, one architecture
# preference (A1: routes go through the service) and one recorded weakness (W1: findById builds its SQL
# by concatenation). The loop's task asks for a plan file under the docs root's work/plans/, so the
# scorer has a plan to grade before it is written; the scorer is switched on in settings.local.json.
# The calibration fixtures beside this file cite these files and lines.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p src/db/migrations src/orders src/http test .alfred/docs .claude
printf '.alfred/\n.serena/\n.memory-mcp/\n' >> .gitignore
cp -R "$HERE/fixtures/inputs/." .alfred/docs/
node -e "const f='.claude/settings.local.json';const fs=require('fs');let o={};try{o=JSON.parse(fs.readFileSync(f,'utf8'))}catch{}o.env={...(o.env||{}),ALFRED_CODE_SCORER:'1'};fs.writeFileSync(f,JSON.stringify(o,null,2)+'\n')"
cat > package.json <<'JSON'
{ "name": "orders", "private": true, "scripts": { "test": "node --test" } }
JSON
cat > CLAUDE.md <<'MD'
# orders

The orders service: a route table, the order rules and the SQL behind them.

## Commands

- Test: `npm test` (one file: `node --test test/orderService.test.js`)
MD
cat > src/db/db.js <<'JS'
'use strict';
// The one door to the database: run(sql, params) sends one statement with bound parameters.
let driver = null;

function connect(d)
{
    driver = d;
}

function run(sql, params = [])
{
    return driver.query(sql, params);
}

module.exports = { connect, run };
JS
cat > src/db/migrations/001_orders.sql <<'SQL'
CREATE TABLE orders (id TEXT PRIMARY KEY, status TEXT NOT NULL, total_cents INTEGER NOT NULL);
SQL
cat > src/orders/orderRepository.js <<'JS'
'use strict';
const db = require('../db/db.js');

class OrderRepository
{
    findById(id)
    {
        return db.run('SELECT * FROM orders WHERE id = ' + id)[0] || null;
    }

    save(order)
    {
        return db.run('INSERT INTO orders (id, status, total_cents) VALUES (?, ?, ?)', [order.id, order.status, order.totalCents]);
    }

    setStatus(id, status)
    {
        return db.run('UPDATE orders SET status = ? WHERE id = ?', [status, id]);
    }
}

module.exports = { OrderRepository };
JS
cat > src/orders/orderService.js <<'JS'
'use strict';

function placeOrder(repo, order)
{
    if (!Number.isInteger(order.totalCents) || order.totalCents <= 0) throw new Error('totalCents must be a positive integer');
    repo.save({ ...order, status: 'placed' });
    return order.id;
}

function cancelOrder(repo, id)
{
    const order = repo.findById(id);
    if (!order) throw new Error(`order ${id} not found`);
    if (order.status === 'shipped') throw new Error(`order ${id} has shipped`);
    repo.setStatus(id, 'cancelled');
}

module.exports = { placeOrder, cancelOrder };
JS
cat > src/http/routes.js <<'JS'
'use strict';
const { placeOrder, cancelOrder } = require('../orders/orderService.js');

// Each route: [method, path, handler(req, deps)]; deps.orders is the OrderRepository.
const routes = [
    ['POST', '/orders', (req, deps) => ({ status: 201, body: { id: placeOrder(deps.orders, req.body) } })],
    ['POST', '/orders/:id/cancel', (req, deps) => { cancelOrder(deps.orders, req.params.id); return { status: 204 }; }],
];

module.exports = { routes };
JS
cat > test/orderService.test.js <<'JS'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { placeOrder, cancelOrder } = require('../src/orders/orderService.js');

const fakeRepo = (order) => ({ saved: [], statuses: [], findById: () => order, save(o) { this.saved.push(o); }, setStatus(id, s) { this.statuses.push([id, s]); } });

test('a placed order is saved as placed', () =>
{
    const repo = fakeRepo(null);
    placeOrder(repo, { id: 'o1', totalCents: 500 });
    assert.strictEqual(repo.saved[0].status, 'placed');
});

test('a shipped order cannot be cancelled', () =>
{
    assert.throws(() => cancelOrder(fakeRepo({ id: 'o1', status: 'shipped' }), 'o1'), /has shipped/);
});
JS
git add -A
git commit -q -m 'baseline'
