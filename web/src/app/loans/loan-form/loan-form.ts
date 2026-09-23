import { Component, OnInit, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { Item, LoanInput, Member } from '../../core/models';
import { problemMessage } from '../../core/problem';
import { ItemsApi } from '../../items/items-api';
import { MembersApi } from '../../members/members-api';
import { LoansApi } from '../loans-api';

function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

@Component({
  selector: 'app-loan-form',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './loan-form.html',
})
export class LoanForm implements OnInit {
  private readonly loansApi = inject(LoansApi);
  private readonly itemsApi = inject(ItemsApi);
  private readonly membersApi = inject(MembersApi);
  private readonly router = inject(Router);

  protected readonly items = signal<Item[]>([]);
  protected readonly members = signal<Member[]>([]);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  readonly form = inject(NonNullableFormBuilder).group({
    itemId: [null as number | null, Validators.required],
    memberId: [null as number | null, Validators.required],
    startDate: [today(), Validators.required],
    dueDate: ['', Validators.required],
  });

  ngOnInit(): void {
    this.itemsApi.list({ page: 1, pageSize: 100 }).subscribe({
      next: (result) => this.items.set(result.items.filter((item) => !item.isRetired)),
      error: (error: unknown) => this.error.set(problemMessage(error)),
    });
    this.membersApi.list({ page: 1, pageSize: 100, status: 'Active' }).subscribe({
      next: (result) => this.members.set(result.items),
      error: (error: unknown) => this.error.set(problemMessage(error)),
    });
  }

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    const body: LoanInput = {
      itemId: Number(value.itemId),
      memberId: Number(value.memberId),
      startDate: value.startDate,
      dueDate: value.dueDate,
    };

    this.saving.set(true);
    this.error.set(null);
    this.loansApi.create(body).subscribe({
      next: () => this.router.navigate(['/loans']),
      error: (error: unknown) => {
        this.error.set(problemMessage(error));
        this.saving.set(false);
      },
    });
  }
}
