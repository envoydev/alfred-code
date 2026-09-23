import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { aLoan, paged, provideApiTesting } from '../../testing/fixtures';
import { LoanList } from './loan-list';

describe('LoanList', () => {
  it('offers Return only on loans that are still out', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), ...provideApiTesting()] });
    const httpTesting = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(LoanList);
    fixture.detectChanges();

    httpTesting
      .expectOne('/api/loans?page=1&pageSize=10')
      .flush(
        paged([
          aLoan({ id: 1, status: 'Active' }),
          aLoan({ id: 2, status: 'Overdue' }),
          aLoan({ id: 3, status: 'Returned', returnedAt: '2026-09-10T12:00:00Z' }),
        ]),
      );
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    const rows = element.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3);
    expect(rows[2].querySelector('button')).toBeNull();
    expect(element.querySelector('.summary')?.textContent).toContain('1 active, 1 overdue');

    rows[1].querySelector('button')?.click();
    httpTesting
      .expectOne({ method: 'POST', url: '/api/loans/2/return' })
      .flush(aLoan({ id: 2, status: 'Returned', returnedAt: '2026-09-20T08:00:00Z' }));
    await fixture.whenStable();

    expect(element.querySelectorAll('tbody button')).toHaveLength(1);
    httpTesting.verify();
  });
});
