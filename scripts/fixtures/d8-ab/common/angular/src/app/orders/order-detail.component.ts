import { CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, numberAttribute } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';

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
        <dd class="total">{{ order.total | currency: 'USD' }}</dd>
      </dl>
    } @else {
      <p class="loading">Loading order...</p>
    }
    <a routerLink="/orders">Back to orders</a>
  `,
})
export class OrderDetailComponent {
  private readonly orders = inject(OrderService);

  /** Bound from the `:id` route parameter. */
  readonly id = input.required({ transform: numberAttribute });

  protected readonly order = toSignal(toObservable(this.id).pipe(switchMap((id) => this.orders.get(id))));
}
