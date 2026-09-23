import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';

import { pageCount } from '../core/api';
import { Loan, LoanInput } from '../core/models';
import { problemMessage } from '../core/problem';
import { LoanQuery, LoansApi } from './loans-api';

export const DEFAULT_LOAN_FILTER: LoanQuery = { page: 1, pageSize: 10 };

@Injectable({ providedIn: 'root' })
export class LoansStore {
  private readonly api = inject(LoansApi);

  private readonly _loans = signal<Loan[]>([]);
  private readonly _totalCount = signal(0);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _filter = signal<LoanQuery>(DEFAULT_LOAN_FILTER);

  readonly loans = this._loans.asReadonly();
  readonly totalCount = this._totalCount.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly filter = this._filter.asReadonly();

  readonly activeCount = computed(() => this.countByStatus('Active'));
  readonly overdueCount = computed(() => this.countByStatus('Overdue'));
  readonly returnedCount = computed(() => this.countByStatus('Returned'));
  readonly openCount = computed(() => this.activeCount() + this.overdueCount());
  readonly pageCount = computed(() => pageCount(this._totalCount(), this._filter().pageSize));

  /** Loads one page of loans. The filter replaces the current one. */
  load(filter: LoanQuery = this._filter()): void {
    if (filter.memberId !== this._filter().memberId) {
      this._loans.set([]);
      this._totalCount.set(0);
    }
    this._filter.set(filter);
    this._loading.set(true);
    this._error.set(null);
    this.api.list(filter).subscribe({
      next: (result) => {
        this._loans.set(result.items);
        this._totalCount.set(result.totalCount);
        this._loading.set(false);
      },
      error: (error: unknown) => {
        this._error.set(problemMessage(error));
        this._loading.set(false);
      },
    });
  }

  create(loan: LoanInput): Observable<Loan> {
    this._error.set(null);
    return this.api.create(loan).pipe(
      tap({
        next: (created) => {
          this._loans.update((loans) => [created, ...loans]);
          this._totalCount.update((count) => count + 1);
        },
        error: (error: unknown) => this._error.set(problemMessage(error)),
      }),
    );
  }

  returnLoan(id: number): void {
    this._error.set(null);
    this.api.returnLoan(id).subscribe({
      next: (returned) =>
        this._loans.update((loans) => loans.map((loan) => (loan.id === id ? returned : loan))),
      error: (error: unknown) => this._error.set(problemMessage(error)),
    });
  }

  private countByStatus(status: Loan['status']): number {
    return this._loans().filter((loan) => loan.status === status).length;
  }
}
