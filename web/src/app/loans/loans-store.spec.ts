import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { aLoan, paged, provideApiTesting } from '../testing/fixtures';
import { LoansStore } from './loans-store';

describe('LoansStore', () => {
  let store: LoansStore;
  let httpTesting: HttpTestingController;

  const loans = [
    aLoan({ id: 1, status: 'Active' }),
    aLoan({ id: 2, status: 'Overdue' }),
    aLoan({ id: 3, status: 'Overdue' }),
    aLoan({ id: 4, status: 'Returned', returnedAt: '2026-09-10T12:00:00Z' }),
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideApiTesting() });
    store = TestBed.inject(LoansStore);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  function loadPage(): void {
    store.load({ page: 1, pageSize: 10 });
    httpTesting.expectOne((r) => r.url === '/api/loans').flush(paged(loans, 24));
  }

  it('loads a page and tracks the loading flag and filter', () => {
    store.load({ page: 2, pageSize: 10, status: 'Overdue' });

    expect(store.loading()).toBe(true);
    expect(store.filter()).toEqual({ page: 2, pageSize: 10, status: 'Overdue' });
    httpTesting.expectOne((r) => r.url === '/api/loans').flush(paged(loans, 24));

    expect(store.loading()).toBe(false);
    expect(store.loans().map((l) => l.id)).toEqual([1, 2, 3, 4]);
    expect(store.totalCount()).toBe(24);
    expect(store.pageCount()).toBe(3);
  });

  it('counts loans by status', () => {
    loadPage();

    expect(store.activeCount()).toBe(1);
    expect(store.overdueCount()).toBe(2);
    expect(store.returnedCount()).toBe(1);
    expect(store.openCount()).toBe(3);
  });

  it('replaces a returned loan and updates the counts', () => {
    loadPage();

    store.returnLoan(2);
    httpTesting
      .expectOne({ method: 'POST', url: '/api/loans/2/return' })
      .flush(aLoan({ id: 2, status: 'Returned', returnedAt: '2026-09-20T08:00:00Z' }));

    expect(store.loans().find((l) => l.id === 2)?.status).toBe('Returned');
    expect(store.overdueCount()).toBe(1);
    expect(store.returnedCount()).toBe(2);
  });

  it('adds a created loan to the top of the list', () => {
    loadPage();
    const body = { itemId: 5, memberId: 1, startDate: '2026-09-20', dueDate: '2026-09-27' };

    store.create(body).subscribe();
    httpTesting
      .expectOne({ method: 'POST', url: '/api/loans' })
      .flush(aLoan({ id: 99, itemId: 5 }), { status: 201, statusText: 'Created' });

    expect(store.loans()[0].id).toBe(99);
    expect(store.totalCount()).toBe(25);
    expect(store.activeCount()).toBe(2);
  });

  it('keeps the loans and shows the problem detail when a request fails', () => {
    loadPage();

    store.returnLoan(4);
    httpTesting
      .expectOne('/api/loans/4/return')
      .flush(
        { title: 'Conflict', status: 409, detail: 'This loan has already been returned.' },
        { status: 409, statusText: 'Conflict' },
      );
    expect(store.error()).toBe('This loan has already been returned.');
    expect(store.loans()).toHaveLength(4);

    store.load();
    expect(store.error()).toBeNull();
    httpTesting
      .expectOne((r) => r.url === '/api/loans')
      .flush(null, { status: 500, statusText: 'Server Error' });
    expect(store.loading()).toBe(false);
    expect(store.error()).toBe('Something went wrong. Please try again.');
  });
});
