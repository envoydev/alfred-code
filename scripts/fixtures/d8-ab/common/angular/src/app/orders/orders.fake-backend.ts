import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';

import { Order } from './order.model';

const ORDERS: Order[] = [
  { id: 1, customer: 'Ada Lovelace', status: 'Pending', total: 120, placedAt: '2026-10-01T09:00:00Z' },
  { id: 2, customer: 'Alan Turing', status: 'Shipped', total: 75.5, placedAt: '2026-10-02T10:30:00Z' },
  { id: 3, customer: 'Barbara Liskov', status: 'Delivered', total: 42, placedAt: '2026-10-02T15:45:00Z' },
  { id: 4, customer: 'Donald Knuth', status: 'Pending', total: 310.25, placedAt: '2026-10-03T08:15:00Z' },
  { id: 5, customer: 'Edsger Dijkstra', status: 'Shipped', total: 18.99, placedAt: '2026-10-03T11:00:00Z' },
  { id: 6, customer: 'Frances Allen', status: 'Delivered', total: 64, placedAt: '2026-10-04T16:20:00Z' },
  { id: 7, customer: 'Grace Hopper', status: 'Pending', total: 100, placedAt: '2026-10-05T12:00:00Z' },
  { id: 8, customer: 'Hedy Lamarr', status: 'Shipped', total: 230, placedAt: '2026-10-06T09:40:00Z' },
];

const ORDER_URL = /^\/api\/orders\/(\d+)$/;

/**
 * Serves `/api/orders` from memory, so the app runs with no server behind it.
 * `GET /api/orders` takes optional `page` (from 1) and `pageSize` query parameters.
 */
export const ordersFakeBackend: HttpInterceptorFn = (req, next) => {
  if (req.method === 'GET' && req.url === '/api/orders') {
    const page = Number(req.params.get('page') ?? 0);
    const pageSize = Number(req.params.get('pageSize') ?? 0);
    const body = page > 0 && pageSize > 0 ? ORDERS.slice((page - 1) * pageSize, page * pageSize) : ORDERS;
    return of(new HttpResponse({ status: 200, body }));
  }

  const match = ORDER_URL.exec(req.url);
  if (req.method === 'GET' && match) {
    const order = ORDERS.find((o) => o.id === Number(match[1]));
    return order
      ? of(new HttpResponse({ status: 200, body: order }))
      : throwError(() => new HttpErrorResponse({ status: 404, statusText: 'Not Found', url: req.url }));
  }

  return next(req);
};
