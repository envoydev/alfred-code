import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_URL, queryParams } from '../core/api';
import { Loan, LoanInput, LoanStatus, Paged } from '../core/models';

export interface LoanQuery {
  page: number;
  pageSize: number;
  memberId?: number;
  status?: LoanStatus | '';
}

@Injectable({ providedIn: 'root' })
export class LoansApi {
  private readonly http = inject(HttpClient);
  private readonly url = `${API_URL}/loans`;

  list(query: LoanQuery): Observable<Paged<Loan>> {
    return this.http.get<Paged<Loan>>(this.url, { params: queryParams({ ...query }) });
  }

  create(loan: LoanInput): Observable<Loan> {
    return this.http.post<Loan>(this.url, loan);
  }

  returnLoan(id: number): Observable<Loan> {
    return this.http.post<Loan>(`${this.url}/${id}/return`, null);
  }
}
