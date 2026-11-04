import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Order } from './order.model';
import { OrderListComponent } from './order-list.component';

const ORDERS: Order[] = [
  { id: 1, customer: 'Ada Lovelace', status: 'Pending', total: 120, placedAt: '2026-10-01T09:00:00Z' },
  { id: 2, customer: 'Alan Turing', status: 'Shipped', total: 75.5, placedAt: '2026-10-02T10:30:00Z' },
];

describe('OrderListComponent', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [OrderListComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('renders one row per order with its status and total', async () => {
    const fixture = TestBed.createComponent(OrderListComponent);
    http.expectOne('/api/orders').flush(ORDERS);
    await fixture.whenStable();

    const rows: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('.order-row'));
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('.customer')?.textContent).toContain('Ada Lovelace');
    expect(rows[1].querySelector('.status')?.textContent).toContain('Shipped');
    expect(rows[0].querySelector('.total')?.textContent).toContain('$120.00');
  });

  it('links each row to its order page', async () => {
    const fixture = TestBed.createComponent(OrderListComponent);
    http.expectOne('/api/orders').flush(ORDERS);
    await fixture.whenStable();

    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('.order-row a');
    expect(link.getAttribute('href')).toBe('/orders/1');
  });

  it('says so when there are no orders', async () => {
    const fixture = TestBed.createComponent(OrderListComponent);
    http.expectOne('/api/orders').flush([]);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.empty')?.textContent).toContain('No orders.');
  });
});
