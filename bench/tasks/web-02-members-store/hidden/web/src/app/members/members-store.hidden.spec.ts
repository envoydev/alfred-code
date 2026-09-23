import { HttpRequest } from '@angular/common/http';
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { aMember, paged, provideApiTesting } from '../testing/fixtures';
import { MembersStore } from './members-store';

/** Matches GET /api/members carrying exactly these query parameters. */
function listRequest(expected: Record<string, string>) {
  return (r: HttpRequest<unknown>): boolean => {
    const url = new URL(r.urlWithParams, 'http://localhost');
    const actual = Object.fromEntries(url.searchParams.entries());
    return (
      r.method === 'GET' &&
      url.pathname === '/api/members' &&
      JSON.stringify(Object.entries(actual).sort()) ===
        JSON.stringify(Object.entries(expected).sort())
    );
  };
}

const serverError = { status: 500, statusText: 'Server Error' };

describe('Hidden.Web02 MembersStore', () => {
  let store: MembersStore;
  let httpTesting: HttpTestingController;
  // The prompt names loadMember(id) and suspend(id) without a parameter type; ids are numbers here.
  let actions: { loadMember(id: number): unknown; suspend(id: number): unknown };

  const ada = aMember({ id: 1, name: 'Ada Lovelace' });
  const grace = aMember({ id: 2, name: 'Grace Hopper', email: 'grace@example.com' });

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideApiTesting() });
    store = TestBed.inject(MembersStore);
    httpTesting = TestBed.inject(HttpTestingController);
    actions = store as unknown as typeof actions;
  });

  // Reset even when verify throws, so one failing test cannot fail the tests after it.
  afterEach(() => {
    try {
      httpTesting.verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  function loadFirstPage(): void {
    store.load({ page: 1, pageSize: 10 });
    httpTesting
      .expectOne(listRequest({ page: '1', pageSize: '10' }))
      .flush(paged([ada, grace], 12));
  }

  function viewMember(id: number): void {
    actions.loadMember(id);
    httpTesting
      .expectOne({ method: 'GET', url: `/api/members/${id}` })
      .flush(id === 2 ? grace : aMember({ id }));
  }

  it('is provided in root and starts with the default filter and nothing loaded', () => {
    expect(store.filter()).toEqual({ page: 1, pageSize: 10 });
    expect(store.pageCount()).toBe(1);
    expect(store.loading()).toBe(false);
    expect(store.member()).toBeNull();
    expect(store.suspending()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('exposes only read-only signals', () => {
    const signals: unknown[] = [
      store.members,
      store.totalCount,
      store.filter,
      store.pageCount,
      store.loading,
      store.member,
      store.suspending,
      store.error,
    ];
    for (const s of signals) {
      expect(typeof s).toBe('function');
      expect('set' in (s as object)).toBe(false);
      expect('update' in (s as object)).toBe(false);
    }
  });

  it('replaces the filter, fetches that page and tracks the loading flag', () => {
    store.load({ page: 2, pageSize: 10, status: 'Suspended' });

    expect(store.filter()).toEqual({ page: 2, pageSize: 10, status: 'Suspended' });
    expect(store.loading()).toBe(true);
    httpTesting
      .expectOne(listRequest({ page: '2', pageSize: '10', status: 'Suspended' }))
      .flush(paged([ada, grace], 24));

    expect(store.loading()).toBe(false);
    expect(store.members().map((m) => m.id)).toEqual([1, 2]);
    expect(store.totalCount()).toBe(24);
    expect(store.pageCount()).toBe(3);
    expect(store.error()).toBeNull();
  });

  it('keeps the rows until the new page arrives, and reloads the current filter when called with no argument', () => {
    loadFirstPage();

    store.load({ page: 2, pageSize: 10 });
    expect(store.loading()).toBe(true);
    expect(store.members().map((m) => m.id)).toEqual([1, 2]);
    httpTesting
      .expectOne(listRequest({ page: '2', pageSize: '10' }))
      .flush(paged([aMember({ id: 11 }), aMember({ id: 12 })], 12));
    expect(store.members().map((m) => m.id)).toEqual([11, 12]);

    store.load();
    expect(store.filter()).toEqual({ page: 2, pageSize: 10 });
    expect(store.members().map((m) => m.id)).toEqual([11, 12]);
    httpTesting
      .expectOne(listRequest({ page: '2', pageSize: '10' }))
      .flush(paged([aMember({ id: 13 })], 11));
    expect(store.members().map((m) => m.id)).toEqual([13]);
    expect(store.totalCount()).toBe(11);
  });

  it('never reports fewer than one page', () => {
    store.load({ page: 1, pageSize: 10 });
    httpTesting.expectOne(listRequest({ page: '1', pageSize: '10' })).flush(paged([], 0));
    expect(store.pageCount()).toBe(1);

    store.load();
    httpTesting.expectOne(listRequest({ page: '1', pageSize: '10' })).flush(paged([ada], 20));
    expect(store.pageCount()).toBe(2);

    store.load();
    httpTesting.expectOne(listRequest({ page: '1', pageSize: '10' })).flush(paged([ada], 21));
    expect(store.pageCount()).toBe(3);
  });

  it('turns a failed load into the page message and keeps the rows and total, clearing the error on the next request', () => {
    loadFirstPage();

    store.load({ page: 2, pageSize: 10, status: 'Active' });
    httpTesting.expectOne(listRequest({ page: '2', pageSize: '10', status: 'Active' })).flush(
      { title: 'Bad Request', status: 400, detail: 'Page 2 does not exist.' },
      {
        status: 400,
        statusText: 'Bad Request',
      },
    );
    expect(store.error()).toBe('Page 2 does not exist.');
    expect(store.loading()).toBe(false);
    expect(store.members().map((m) => m.id)).toEqual([1, 2]);
    expect(store.totalCount()).toBe(12);

    store.load({ page: 1, pageSize: 10 });
    expect(store.error()).toBeNull();
    httpTesting.expectOne(listRequest({ page: '1', pageSize: '10' })).flush(null, serverError);
    expect(store.error()).toBe('Something went wrong. Please try again.');

    store.load();
    expect(store.error()).toBeNull();
    httpTesting
      .expectOne(listRequest({ page: '1', pageSize: '10' }))
      .error(new ProgressEvent('error'));
    expect(store.error()).toBe('The server could not be reached.');
    expect(store.members().map((m) => m.id)).toEqual([1, 2]);
  });

  it('clears the viewed member, then fetches the requested one', () => {
    viewMember(2);
    expect(store.member()).toEqual(grace);

    actions.loadMember(7);
    expect(store.member()).toBeNull();
    const seven = aMember({ id: 7, name: 'Mary Somerville' });
    httpTesting.expectOne({ method: 'GET', url: '/api/members/7' }).flush(seven);
    expect(store.member()).toEqual(seven);
  });

  it('turns a failed member request into the page message and clears it on the next request', () => {
    actions.loadMember(9);
    httpTesting.expectOne({ method: 'GET', url: '/api/members/9' }).flush(
      { title: 'Not Found', status: 404, detail: 'Member 9 was not found.' },
      {
        status: 404,
        statusText: 'Not Found',
      },
    );
    expect(store.error()).toBe('Member 9 was not found.');
    expect(store.member()).toBeNull();

    actions.loadMember(2);
    expect(store.error()).toBeNull();
    httpTesting.expectOne({ method: 'GET', url: '/api/members/2' }).flush(grace);
    expect(store.member()).toEqual(grace);
  });

  it('suspends the viewed member and its row, flagging suspending only while the request runs', () => {
    loadFirstPage();
    viewMember(2);

    actions.suspend(2);
    expect(store.suspending()).toBe(true);
    const suspended = { ...grace, status: 'Suspended' as const };
    httpTesting.expectOne({ method: 'POST', url: '/api/members/2/suspend' }).flush(suspended);

    expect(store.suspending()).toBe(false);
    expect(store.member()).toEqual(suspended);
    expect(store.members()).toEqual([ada, suspended]);
    expect(store.error()).toBeNull();
  });

  it('leaves the viewed member alone when another member is suspended, and the rows alone when that member is not on the page', () => {
    loadFirstPage();
    viewMember(2);

    actions.suspend(1);
    const adaSuspended = { ...ada, status: 'Suspended' as const };
    httpTesting.expectOne({ method: 'POST', url: '/api/members/1/suspend' }).flush(adaSuspended);
    expect(store.member()).toEqual(grace);
    expect(store.members()).toEqual([adaSuspended, grace]);

    actions.suspend(5);
    httpTesting
      .expectOne({ method: 'POST', url: '/api/members/5/suspend' })
      .flush(aMember({ id: 5, status: 'Suspended' }));
    expect(store.member()).toEqual(grace);
    expect(store.members()).toEqual([adaSuspended, grace]);
    expect(store.suspending()).toBe(false);
  });

  it('keeps the member and rows when a suspend fails, and clears the error on the next request', () => {
    loadFirstPage();
    viewMember(2);

    actions.suspend(2);
    expect(store.suspending()).toBe(true);
    httpTesting.expectOne({ method: 'POST', url: '/api/members/2/suspend' }).flush(
      { title: 'Conflict', status: 409, detail: 'Grace Hopper has loans out.' },
      {
        status: 409,
        statusText: 'Conflict',
      },
    );
    expect(store.suspending()).toBe(false);
    expect(store.error()).toBe('Grace Hopper has loans out.');
    expect(store.member()).toEqual(grace);
    expect(store.members()).toEqual([ada, grace]);

    actions.suspend(2);
    expect(store.error()).toBeNull();
    expect(store.suspending()).toBe(true);
    httpTesting
      .expectOne({ method: 'POST', url: '/api/members/2/suspend' })
      .flush({ ...grace, status: 'Suspended' });
    expect(store.suspending()).toBe(false);
  });
});
