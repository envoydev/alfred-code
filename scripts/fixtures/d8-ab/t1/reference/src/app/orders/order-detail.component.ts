import { CurrencyPipe, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, numberAttribute, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { switchMap, tap } from 'rxjs';

import { OrderService } from './order.service';

@Component({
  selector: 'app-order-detail',
  imports: [CurrencyPipe, DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (order(); as order) {
      <h2>Order #{{ order.id }}</h2>
      <dl>
        <dt>Customer</dt>
        <dd class="customer">{{ order.customer }}</dd>
        <dt>Status</dt>
        <dd class="status">{{ order.status }}</dd>
        <dt>Placed</dt>
        <dd class="placed">{{ order.placedAt | date: 'mediumDate' }}</dd>
        <dt>Total</dt>
        <dd class="total">{{ (discountedTotal() ?? order.total) | currency: 'USD' }}</dd>
      </dl>
      <form (submit)="$event.preventDefault(); apply(code.value)">
        <label>
          Discount code
          <input #code name="discountCode" autocomplete="off" />
        </label>
        <button name="applyDiscount" type="submit" [disabled]="applying()">Apply</button>
      </form>
      @if (discountError(); as message) {
        <p class="discount-error" role="alert">{{ message }}</p>
      }
    } @else {
      <p class="loading">Loading order...</p>
    }
    <a routerLink="/orders">Back to orders</a>
  `,
})
export class OrderDetailComponent {
  private readonly orders = inject(OrderService);
  private readonly destroyRef = inject(DestroyRef);

  /** Bound from the `:id` route parameter. */
  readonly id = input.required({ transform: numberAttribute });

  protected readonly order = toSignal(
    toObservable(this.id).pipe(
      tap(() => this.discountedTotal.set(null)),
      switchMap((id) => this.orders.get(id)),
    ),
  );

  protected readonly discountedTotal = signal<number | null>(null);
  protected readonly discountError = signal<string | null>(null);
  protected readonly applying = signal(false);

  protected apply(code: string): void {
    const trimmed = code.trim();
    if (!trimmed) {
      this.discountError.set('Enter a discount code.');
      return;
    }
    this.applying.set(true);
    this.discountError.set(null);
    this.orders
      .applyDiscount(this.id(), trimmed)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.discountedTotal.set(result.total);
          this.applying.set(false);
        },
        error: (err: unknown) => {
          this.applying.set(false);
          this.discountError.set(
            err instanceof HttpErrorResponse && err.status === 422
              ? 'That discount code cannot be used on this order.'
              : 'The discount could not be applied. Try again.',
          );
        },
      });
  }
}
