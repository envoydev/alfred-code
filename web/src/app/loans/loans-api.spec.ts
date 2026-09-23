import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { aLoan, paged, provideApiTesting } from '../testing/fixtures';
import { LoansApi } from './loans-api';

describe('LoansApi', () => {
  let api: LoansApi;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideApiTesting() });
    api = TestBed.inject(LoansApi);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('lists loans for one member and status', () => {
    api.list({ page: 1, pageSize: 50, memberId: 3, status: 'Overdue' }).subscribe();

    const req = httpTesting.expectOne((r) => r.url === '/api/loans');
    expect(req.request.params.get('memberId')).toBe('3');
    expect(req.request.params.get('status')).toBe('Overdue');
    expect(req.request.params.get('pageSize')).toBe('50');
    expect(req.request.headers.get('X-Demo-User')).toBe('desk');
    req.flush(paged([aLoan()]));
  });

  it('creates a loan and returns one by id', () => {
    const body = { itemId: 2, memberId: 3, startDate: '2026-09-01', dueDate: '2026-09-10' };
    api.create(body).subscribe();
    api.returnLoan(9).subscribe();

    const create = httpTesting.expectOne({ method: 'POST', url: '/api/loans' });
    expect(create.request.body).toEqual(body);
    create.flush(aLoan(), { status: 201, statusText: 'Created' });
    const ret = httpTesting.expectOne({ method: 'POST', url: '/api/loans/9/return' });
    ret.flush(aLoan({ id: 9, status: 'Returned', returnedAt: '2026-09-05T10:00:00Z' }));
  });
});
