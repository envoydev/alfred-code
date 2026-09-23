import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Observable } from 'rxjs';

import { Member } from '../../core/models';
import { problemMessage } from '../../core/problem';
import { MembersApi } from '../members-api';

@Component({
  selector: 'app-member-form',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './member-form.html',
})
export class MemberForm implements OnInit {
  private readonly api = inject(MembersApi);
  private readonly router = inject(Router);

  /** Bound from the `:id` route parameter; absent when creating a member. */
  readonly id = input<string>();

  protected readonly isEdit = computed(() => this.id() !== undefined);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  readonly form = inject(NonNullableFormBuilder).group({
    name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
  });

  ngOnInit(): void {
    const id = this.id();
    if (id !== undefined) {
      this.api.get(Number(id)).subscribe({
        next: (member) => this.form.setValue({ name: member.name, email: member.email }),
        error: (error: unknown) => this.error.set(problemMessage(error)),
      });
    }
  }

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const id = this.id();
    const body = this.form.getRawValue();
    const request: Observable<Member> =
      id === undefined ? this.api.create(body) : this.api.update(Number(id), body);

    this.saving.set(true);
    this.error.set(null);
    request.subscribe({
      next: (member) => this.router.navigate(['/members', member.id]),
      error: (error: unknown) => {
        this.error.set(problemMessage(error));
        this.saving.set(false);
      },
    });
  }
}
