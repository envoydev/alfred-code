import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Observable } from 'rxjs';

import { Item, ItemCondition } from '../../core/models';
import { problemMessage } from '../../core/problem';
import { ItemsApi } from '../items-api';

@Component({
  selector: 'app-item-form',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './item-form.html',
})
export class ItemForm implements OnInit {
  private readonly api = inject(ItemsApi);
  private readonly router = inject(Router);

  /** Bound from the `:id` route parameter; absent when creating an item. */
  readonly id = input<string>();

  protected readonly conditions: ItemCondition[] = ['Good', 'Worn', 'Damaged'];
  protected readonly isEdit = computed(() => this.id() !== undefined);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  readonly form = inject(NonNullableFormBuilder).group({
    name: ['', Validators.required],
    category: ['', Validators.required],
    sku: ['', Validators.required],
    totalStock: [1, [Validators.required, Validators.min(0)]],
    condition: ['Good' as ItemCondition, Validators.required],
  });

  ngOnInit(): void {
    const id = this.id();
    if (id !== undefined) {
      this.api.get(Number(id)).subscribe({
        next: ({ name, category, sku, totalStock, condition }) =>
          this.form.setValue({ name, category, sku, totalStock, condition }),
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
    const request: Observable<Item> =
      id === undefined ? this.api.create(body) : this.api.update(Number(id), body);

    this.saving.set(true);
    this.error.set(null);
    request.subscribe({
      next: () => this.router.navigate(['/items']),
      error: (error: unknown) => {
        this.error.set(problemMessage(error));
        this.saving.set(false);
      },
    });
  }
}
