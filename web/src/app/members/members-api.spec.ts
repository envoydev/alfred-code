import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { aLoan, aMember, paged, provideApiTesting } from '../testing/fixtures';
import { MembersApi } from './members-api';

describe('MembersApi', () => {
  let api: MembersApi;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideApiTesting() });
    api = TestBed.inject(MembersApi);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('lists members with paging and status, carrying the session headers', () => {
    let total = 0;
    api
      .list({ page: 2, pageSize: 20, status: 'Suspended' })
      .subscribe((r) => (total = r.totalCount));

    const req = httpTesting.expectOne((r) => r.url === '/api/members');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('20');
    expect(req.request.params.get('status')).toBe('Suspended');
    expect(req.request.headers.get('X-Demo-User')).toBe('desk');
    expect(req.request.headers.get('X-Demo-Role')).toBe('staff');
    req.flush(paged([aMember()], 21));

    expect(total).toBe(21);
  });

  it('leaves out an empty status filter', () => {
    api.list({ page: 1, pageSize: 10, status: '' }).subscribe();

    const req = httpTesting.expectOne((r) => r.url === '/api/members');
    expect(req.request.params.has('status')).toBe(false);
    expect(req.request.urlWithParams).toBe('/api/members?page=1&pageSize=10');
    req.flush(paged([]));
  });

  it('creates, updates, suspends and reads loans on the member routes', () => {
    api.create({ name: 'Ada', email: 'ada@example.com' }).subscribe();
    api.update(7, { name: 'Ada L', email: 'ada@example.com' }).subscribe();
    api.suspend(7).subscribe();
    api.loans(7).subscribe();

    const create = httpTesting.expectOne({ method: 'POST', url: '/api/members' });
    expect(create.request.body).toEqual({ name: 'Ada', email: 'ada@example.com' });
    const update = httpTesting.expectOne({ method: 'PUT', url: '/api/members/7' });
    expect(update.request.body).toEqual({ name: 'Ada L', email: 'ada@example.com' });
    httpTesting.expectOne({ method: 'POST', url: '/api/members/7/suspend' }).flush(aMember());
    httpTesting.expectOne({ method: 'GET', url: '/api/members/7/loans' }).flush([aLoan()]);
    create.flush(aMember(), { status: 201, statusText: 'Created' });
    update.flush(aMember());
  });
});
