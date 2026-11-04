import { HttpRequest, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { routes } from '../app.routes';

// Acceptance for the request: on the order detail page, a code typed into discountCode and applied with
// applyDiscount is sent to POST /api/orders/{id}/discount as { code }; the page shows the returned total like $90.00,
// and an error line with class discount-error on a 422. It reads only the page and the HTTP traffic.
const ORDER = { id: 7, customer: 'Grace Hopper', status: 'Pending', total: 100, placedAt: '2026-10-05T12:00:00Z' };

describe('order discount code (acceptance)', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
      for (const req of http.match((r: HttpRequest<unknown>) => r.method === 'GET' && r.url === '/api/orders/7')) req.flush(ORDER);
      await harness.fixture.whenStable();
    }
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  async function apply(code: string): Promise<void> {
    const input = page().querySelector<HTMLInputElement>('input[name=discountCode]');
    const button = page().querySelector<HTMLButtonElement>('button[name=applyDiscount]');
    expect(input).not.toBeNull();
    expect(button).not.toBeNull();
    (input as HTMLInputElement).value = code;
    (input as HTMLInputElement).dispatchEvent(new Event('input'));
    (button as HTMLButtonElement).click();
    await harness.fixture.whenStable();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter(routes, withComponentInputBinding())],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/orders/7');
    await settle();
  });

  it('sends the code and shows the discounted total the server returns', async () => {
    expect(page().textContent).toContain('$100.00');

    await apply('SAVE10');
    const req = http.expectOne((r) => r.method === 'POST' && r.url === '/api/orders/7/discount');
    expect(req.request.body).toEqual({ code: 'SAVE10' });
    req.flush({ total: 90 });
    await settle();

    expect(page().textContent).toContain('$90.00');
    expect(page().querySelector('.discount-error')).toBeNull();
  });

  it('shows an error line when the server answers 422', async () => {
    await apply('NOPE');
    const req = http.expectOne((r) => r.method === 'POST' && r.url === '/api/orders/7/discount');
    expect(req.request.body).toEqual({ code: 'NOPE' });
    req.flush({ message: 'Unknown discount code' }, { status: 422, statusText: 'Unprocessable Entity' });
    await settle();

    expect(page().querySelector('.discount-error')).not.toBeNull();
    expect(page().textContent).not.toContain('$90.00');
  });
});
