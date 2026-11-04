import { HttpRequest, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { OrderListComponent } from './order-list.component';

// Acceptance for the request: 'a select named statusFilter above the list (All, Pending, Shipped, Delivered) filters
// the orders shown, and the choice survives a page reload'. It reads only the page and the HTTP traffic.
const ORDERS = [
  { id: 1, customer: 'Ada Lovelace', status: 'Pending', total: 120, placedAt: '2026-10-01T09:00:00Z' },
  { id: 2, customer: 'Alan Turing', status: 'Shipped', total: 75.5, placedAt: '2026-10-02T10:30:00Z' },
  { id: 3, customer: 'Barbara Liskov', status: 'Delivered', total: 42, placedAt: '2026-10-02T15:45:00Z' },
  { id: 5, customer: 'Edsger Dijkstra', status: 'Shipped', total: 18.99, placedAt: '2026-10-03T11:00:00Z' },
];
const SHIPPED = ['Alan Turing', 'Edsger Dijkstra'];
const OTHERS = ['Ada Lovelace', 'Barbara Liskov'];

// Answers every pending order-list request; a request that filters on the server gets the filtered list.
function answer(http: HttpTestingController): void {
  for (const req of http.match((r: HttpRequest<unknown>) => r.method === 'GET' && r.url === '/api/orders')) {
    const status = req.request.params.get('status');
    req.flush(status && status !== 'All' ? ORDERS.filter((o) => o.status === status) : ORDERS);
  }
}

async function settle(fixture: ComponentFixture<unknown>, http: HttpTestingController): Promise<void> {
  for (let i = 0; i < 4; i++) {
    answer(http);
    await fixture.whenStable();
  }
}

// A fresh page: a new injector over the same browser storage.
function openPage(): { fixture: ComponentFixture<OrderListComponent>; http: HttpTestingController } {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [OrderListComponent],
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
  });
  return { fixture: TestBed.createComponent(OrderListComponent), http: TestBed.inject(HttpTestingController) };
}

function statusSelect(fixture: ComponentFixture<unknown>): HTMLSelectElement {
  const select = (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>('select[name=statusFilter]');
  expect(select).not.toBeNull();
  return select as HTMLSelectElement;
}

function choose(select: HTMLSelectElement, label: string): void {
  select.selectedIndex = Array.from(select.options).findIndex((o) => o.textContent?.trim() === label);
  select.dispatchEvent(new Event('input'));
  select.dispatchEvent(new Event('change'));
}

function shown(fixture: ComponentFixture<unknown>): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

describe('order list status filter (acceptance)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('offers All, Pending, Shipped and Delivered and shows only the shipped orders for Shipped', async () => {
    const { fixture, http } = openPage();
    await settle(fixture, http);
    const select = statusSelect(fixture);
    expect(Array.from(select.options).map((o) => o.textContent?.trim())).toEqual(['All', 'Pending', 'Shipped', 'Delivered']);
    for (const name of [...SHIPPED, ...OTHERS]) expect(shown(fixture)).toContain(name);

    choose(select, 'Shipped');
    await settle(fixture, http);

    for (const name of SHIPPED) expect(shown(fixture)).toContain(name);
    for (const name of OTHERS) expect(shown(fixture)).not.toContain(name);
  });

  it('keeps the chosen status across a page reload', async () => {
    const first = openPage();
    await settle(first.fixture, first.http);
    choose(statusSelect(first.fixture), 'Shipped');
    await settle(first.fixture, first.http);
    first.fixture.destroy();

    const again = openPage();
    await settle(again.fixture, again.http);
    const select = statusSelect(again.fixture);
    expect(select.options[select.selectedIndex]?.textContent?.trim()).toBe('Shipped');
    for (const name of SHIPPED) expect(shown(again.fixture)).toContain(name);
    for (const name of OTHERS) expect(shown(again.fixture)).not.toContain(name);
  });
});
