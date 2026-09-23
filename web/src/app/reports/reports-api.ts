import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_URL } from '../core/api';
import { OverdueLoan } from '../core/models';

@Injectable({ providedIn: 'root' })
export class ReportsApi {
  private readonly http = inject(HttpClient);

  overdue(): Observable<OverdueLoan[]> {
    return this.http.get<OverdueLoan[]>(`${API_URL}/reports/overdue`);
  }
}
