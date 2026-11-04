import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { ORDER_STATUSES, Order, StatusFilter } from './order.model';
import { OrderService } from './order.service';
import { OrderStatusFilter } from './order-status-filter';

@Component({
  selector: 'app-order-list',
  imports: [CurrencyPipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2>Orders</h2>
    <label>
      Status
      <select name="statusFilter" [value]="filter.value()" (change)="choose($event)">
        @for (option of options; track option) {
          <option [value]="option" [selected]="option === filter.value()">{{ option }}</option>
        }
      </select>
    </label>
    <ul class="orders">
      @for (order of shown(); track order.id) {
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
  protected readonly filter = inject(OrderStatusFilter);
  protected readonly options: readonly StatusFilter[] = ['All', ...ORDER_STATUSES];

  private readonly orders = toSignal(inject(OrderService).list(), { initialValue: [] as Order[] });

  protected readonly shown = computed(() => {
    const status = this.filter.value();
    return status === 'All' ? this.orders() : this.orders().filter((o) => o.status === status);
  });

  protected choose(event: Event): void {
    this.filter.set((event.target as HTMLSelectElement).value as StatusFilter);
  }
}
