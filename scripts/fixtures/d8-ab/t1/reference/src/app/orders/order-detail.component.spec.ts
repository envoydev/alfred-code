import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
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

  async function loaded(): Promise<ComponentFixture<OrderDetailComponent>> {
    const fixture = TestBed.createComponent(OrderDetailComponent);
    fixture.componentRef.setInput('id', '7');
    await fixture.whenStable();
    http.expectOne('/api/orders/7').flush(ORDER);
    await fixture.whenStable();
    return fixture;
  }

  async function apply(fixture: ComponentFixture<OrderDetailComponent>, code: string): Promise<void> {
    const page: HTMLElement = fixture.nativeElement;
    const input = page.querySelector('input[name=discountCode]') as HTMLInputElement;
    input.value = code;
    (page.querySelector('button[name=applyDiscount]') as HTMLButtonElement).click();
    await fixture.whenStable();
  }

  it('loads the order its id names and shows its total', async () => {
    const fixture = await loaded();
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

  it('posts a trimmed discount code and shows the total the server returns', async () => {
    const fixture = await loaded();
    await apply(fixture, '  SAVE10 ');

    const req = http.expectOne('/api/orders/7/discount');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ code: 'SAVE10' });
    req.flush({ total: 90 });
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.total')?.textContent).toContain('$90.00');
    expect(fixture.nativeElement.querySelector('.discount-error')).toBeNull();
  });

  it('shows the error line on a 422 and keeps the original total', async () => {
    const fixture = await loaded();
    await apply(fixture, 'NOPE');

    http.expectOne('/api/orders/7/discount').flush({ message: 'Unknown code' }, { status: 422, statusText: 'Unprocessable Entity' });
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.discount-error')?.textContent).toContain('cannot be used');
    expect(fixture.nativeElement.querySelector('.total')?.textContent).toContain('$100.00');
  });

  it('says what went wrong on any other failure', async () => {
    const fixture = await loaded();
    await apply(fixture, 'SAVE10');

    http.expectOne('/api/orders/7/discount').flush(null, { status: 503, statusText: 'Service Unavailable' });
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.discount-error')?.textContent).toContain('could not be applied');
  });

  it('asks for a code instead of sending an empty one', async () => {
    const fixture = await loaded();
    await apply(fixture, '   ');

    http.expectNone('/api/orders/7/discount');
    expect(fixture.nativeElement.querySelector('.discount-error')?.textContent).toContain('Enter a discount code');
  });
});
