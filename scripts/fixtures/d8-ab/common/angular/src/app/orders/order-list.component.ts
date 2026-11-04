import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { Order } from './order.model';
import { OrderService } from './order.service';

@Component({
  selector: 'app-order-list',
  imports: [CurrencyPipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2>Orders</h2>
    <ul class="orders">
      @for (order of orders(); track order.id) {
        <li class="order-row">
          <a [routerLink]="['/orders', order.id]">#{{ order.id }}</a>
          <span class="customer">{{ order.customer }}</span>
          <span class="status">{{ order.status }}</span>
          <span class="total">{{ order.total | currency: 'USD' }}</span>
        </li>
      } @empty {
        <li class="empty">No orders.</li>
      }
    </ul>
  `,
})
export class OrderListComponent {
  protected readonly orders = toSignal(inject(OrderService).list(), { initialValue: [] as Order[] });
}
