import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { DiscountResult, Order } from './order.model';

@Injectable({ providedIn: 'root' })
export class OrderService {
  private readonly http = inject(HttpClient);

  list(): Observable<Order[]> {
    return this.http.get<Order[]>('/api/orders');
  }

  get(id: number): Observable<Order> {
    return this.http.get<Order>(`/api/orders/${id}`);
  }

  /** Applies a discount code; the server answers 422 for a code it does not accept. */
  applyDiscount(id: number, code: string): Observable<DiscountResult> {
    return this.http.post<DiscountResult>(`/api/orders/${id}/discount`, { code });
  }
}
