import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Order } from './order.model';
import { OrderDetailComponent } from './order-detail.component';

const ORDER: Order = { id: 7, customer: 'Grace Hopper', status: 'Pending', total: 100, placedAt: '2026-10-05T12:00:00Z' };

describe('OrderDetailComponent', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [OrderDetailComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads the order its id names and shows its total', async () => {
    const fixture = TestBed.createComponent(OrderDetailComponent);
    fixture.componentRef.setInput('id', '7');
    await fixture.whenStable();
    http.expectOne('/api/orders/7').flush(ORDER);
    await fixture.whenStable();

    const page: HTMLElement = fixture.nativeElement;
    expect(page.querySelector('h2')?.textContent).toContain('Order #7');
    expect(page.querySelector('.customer')?.textContent).toContain('Grace Hopper');
    expect(page.querySelector('.total')?.textContent).toContain('$100.00');
  });

  it('shows a loading line until the order arrives', async () => {
    const fixture = TestBed.createComponent(OrderDetailComponent);
    fixture.componentRef.setInput('id', '7');
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.loading')?.textContent).toContain('Loading order');
    http.expectOne('/api/orders/7').flush(ORDER);
  });
});
