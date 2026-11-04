import { Injectable, signal } from '@angular/core';

import { ORDER_STATUSES, StatusFilter } from './order.model';

const STORAGE_KEY = 'orders.statusFilter';

function isStatusFilter(value: string | null): value is StatusFilter {
  return value === 'All' || (ORDER_STATUSES as readonly string[]).includes(value ?? '');
}

/** The order list's status filter, kept in local storage so it survives a reload. */
@Injectable({ providedIn: 'root' })
export class OrderStatusFilter {
  private readonly current = signal<StatusFilter>(this.read());

  readonly value = this.current.asReadonly();

  set(value: StatusFilter): void {
    this.current.set(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Storage can be full or blocked; the filter still applies for this page.
    }
  }

  private read(): StatusFilter {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return isStatusFilter(stored) ? stored : 'All';
    } catch {
      return 'All';
    }
  }
}
