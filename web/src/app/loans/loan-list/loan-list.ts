import { Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Loan, LoanStatus } from '../../core/models';
import { DEFAULT_LOAN_FILTER, LoansStore } from '../loans-store';

@Component({
  selector: 'app-loan-list',
  imports: [RouterLink],
  templateUrl: './loan-list.html',
})
export class LoanList implements OnInit {
  protected readonly store = inject(LoansStore);
  protected readonly statuses: LoanStatus[] = ['Active', 'Overdue', 'Returned'];

  ngOnInit(): void {
    this.store.load(DEFAULT_LOAN_FILTER);
  }

  protected setStatus(event: Event): void {
    const status = (event.target as HTMLSelectElement).value as LoanStatus | '';
    this.store.load({ ...this.store.filter(), page: 1, status });
  }

  protected goTo(page: number): void {
    this.store.load({ ...this.store.filter(), page });
  }

  protected returnLoan(loan: Loan): void {
    this.store.returnLoan(loan.id);
  }
}
