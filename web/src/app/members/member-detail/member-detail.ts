import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Loan, Member } from '../../core/models';
import { problemMessage } from '../../core/problem';
import { LoansStore } from '../../loans/loans-store';
import { MembersApi } from '../members-api';

@Component({
  selector: 'app-member-detail',
  imports: [RouterLink, DatePipe],
  templateUrl: './member-detail.html',
  styleUrl: './member-detail.css',
})
export class MemberDetail implements OnInit {
  private readonly api = inject(MembersApi);
  protected readonly loans = inject(LoansStore);

  /** Bound from the `:id` route parameter. */
  readonly id = input.required<string>();

  protected readonly member = signal<Member | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly suspending = signal(false);

  ngOnInit(): void {
    const id = Number(this.id());
    this.api.get(id).subscribe({
      next: (member) => this.member.set(member),
      error: (error: unknown) => this.error.set(problemMessage(error)),
    });
    this.loans.load({ page: 1, pageSize: 50, memberId: id });
  }

  protected suspend(member: Member): void {
    this.suspending.set(true);
    this.error.set(null);
    this.api.suspend(member.id).subscribe({
      next: (updated) => {
        this.member.set(updated);
        this.suspending.set(false);
      },
      error: (error: unknown) => {
        this.error.set(problemMessage(error));
        this.suspending.set(false);
      },
    });
  }

  protected returnLoan(loan: Loan): void {
    this.loans.returnLoan(loan.id);
  }
}
