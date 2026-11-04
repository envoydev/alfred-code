import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { Order, OrderStatus } from '../orders/order.model';

/** Orders per report page. */
export const REPORT_PAGE_SIZE = 25;

export interface ReportRow {
  id: number;
  customer: string;
  status: OrderStatus;
  total: number;
}

@Injectable({ providedIn: 'root' })
export class ReportService {
  private readonly http = inject(HttpClient);

  /** One page of the sales report, from 1. */
  page(page: number): Observable<ReportRow[]> {
    return this.http
      .get<Order[]>('/api/orders', { params: { page, pageSize: REPORT_PAGE_SIZE } })
      .pipe(map((orders) => orders.map(({ id, customer, status, total }) => ({ id, customer, status, total }))));
  }
}
