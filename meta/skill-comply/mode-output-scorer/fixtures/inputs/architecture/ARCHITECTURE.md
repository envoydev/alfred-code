# orders - architecture

## Layers

- `src/http/routes.js` - the route table; each handler calls the order service.
- `src/orders/orderService.js` - the order rules: placing and cancelling.
- `src/orders/orderRepository.js` - the SQL for the orders table, sent through `src/db/db.js`.

## Data

- One table, `orders` (`src/db/migrations/001_orders.sql`): `id`, `status`, `total_cents`.
- Migrations are numbered SQL files run in order; a shipped migration is never edited.
