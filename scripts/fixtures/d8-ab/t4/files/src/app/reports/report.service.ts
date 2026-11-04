import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { OrderStatus } from '../orders/order.model';

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
  page(page: number): Observable<any> {
    return this.http.get<any>('/api/orders', { params: { page, pageSize: 25 } });
  }

  /** The rows as CSV, one line per order, after a header line. */
  toCsv(rows: ReportRow[]): string {
    let csv = 'id,customer,status,total\n';
    for (const row of rows) {
      let customer = row.customer;
      if (customer.indexOf(',') !== -1 || customer.indexOf('"') !== -1 || customer.indexOf('\n') !== -1) {
        customer = '"' + customer.split('"').join('""') + '"';
      }
      csv += row.id + ',' + customer + ',' + row.status + ',' + row.total.toFixed(2) + '\n';
    }
    console.log('report csv built', rows.length);
    return csv;
  }
}
