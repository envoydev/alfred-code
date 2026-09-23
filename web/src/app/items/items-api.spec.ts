import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { Session } from '../core/session';
import { anItem, paged, provideApiTesting } from '../testing/fixtures';
import { ItemsApi } from './items-api';

describe('ItemsApi', () => {
  let api: ItemsApi;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideApiTesting() });
    api = TestBed.inject(ItemsApi);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('lists items filtered by category and search text', () => {
    api.list({ page: 1, pageSize: 10, category: 'Tools', search: 'drill' }).subscribe();

    const req = httpTesting.expectOne((r) => r.url === '/api/items');
    expect(req.request.params.get('category')).toBe('Tools');
    expect(req.request.params.get('search')).toBe('drill');
    expect(req.request.params.get('page')).toBe('1');
    req.flush(paged([anItem()]));
  });

  it('retires an item with DELETE as the current role', () => {
    TestBed.inject(Session).role.set('admin');
    let completed = false;
    api.retire(4).subscribe({ complete: () => (completed = true) });

    const req = httpTesting.expectOne('/api/items/4');
    expect(req.request.method).toBe('DELETE');
    expect(req.request.headers.get('X-Demo-Role')).toBe('admin');
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(completed).toBe(true);
  });
});
