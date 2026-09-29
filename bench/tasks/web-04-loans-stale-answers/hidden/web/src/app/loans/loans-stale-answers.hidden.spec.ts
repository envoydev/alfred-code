import { HttpRequest } from '@angular/common/http';
import { HttpTestingController, TestRequest } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Loan, LoanStatus, Member, Paged } from '../core/models';
import { MemberDetail } from '../members/member-detail/member-detail';
import { aLoan, aMember, provideApiTesting } from '../testing/fixtures';
import { LoanList } from './loan-list/loan-list';

/**
 * Hidden acceptance tests for web-04: the Loans page and a member's page show the answer to the most recent loan
 * list request whatever order the answers arrive in, keep 'Loading...' until that one is done, and never bring a
 * returned loan back as Active from an answer sent before the return. Requests are answered out of order through
 * the testing backend; a request the app dropped (cancelled) is never answered, so any correct design passes.
 */
describe('Hidden.Web04 loan lists under out-of-order answers', () => {
  let httpTesting: HttpTestingController;
  // What the server holds now; every answer not scripted by a test is computed from it.
  let server: Loan[];

  const loan = (id: number, status: LoanStatus, memberId = 1): Loan =>
    aLoan({
      id,
      itemName: `Item ${id}`,
      memberId,
      memberName: `Member ${memberId}`,
      status,
      returnedAt: status === 'Returned' ? '2026-09-20T08:00:00Z' : null,
    });

  const page = (items: Loan[], totalCount = items.length, pageSize = 10): Paged<Loan> => ({
    items,
    page: 1,
    pageSize,
    totalCount,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), ...provideApiTesting()] });
    httpTesting = TestBed.inject(HttpTestingController);
    server = [];
  });

  afterEach(() => {
    try {
      drain();
      httpTesting.verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  function isList(r: HttpRequest<unknown>): boolean {
    return r.method === 'GET' && r.url === '/api/loans';
  }

  function param(r: HttpRequest<unknown>, name: string): string | null {
    return new URL(r.urlWithParams, 'http://localhost').searchParams.get(name);
  }

  /** Every loan list request sent and not answered yet, in the order sent. */
  function pendingLists(): TestRequest[] {
    return httpTesting.match((r) => isList(r));
  }

  function answer(req: TestRequest, body: Paged<Loan> | Loan | Member | null, error = false): void {
    if (req.cancelled) {
      return;
    }
    if (error) {
      req.flush(null, { status: 500, statusText: 'Server Error' });
      return;
    }
    req.flush(body);
  }

  function serverAnswer(r: HttpRequest<unknown>): Paged<Loan> {
    const status = param(r, 'status');
    const memberId = param(r, 'memberId');
    const pageNumber = Number(param(r, 'page') ?? 1);
    const pageSize = Number(param(r, 'pageSize') ?? 10);
    const matching = server.filter(
      (l) => (!status || l.status === status) && (!memberId || l.memberId === Number(memberId)),
    );
    const items = matching.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
    return { items, page: pageNumber, pageSize, totalCount: matching.length };
  }

  /** Answers whatever is still open from the server's current state, until nothing new is sent. */
  function drain(): void {
    for (let round = 0; round < 10; round++) {
      const open = httpTesting.match(() => true);
      if (open.length === 0) {
        return;
      }
      for (const req of open) {
        const r = req.request;
        const member = /^\/api\/members\/(\d+)$/.exec(r.url);
        const returned = /^\/api\/loans\/(\d+)\/return$/.exec(r.url);
        if (isList(r)) {
          answer(req, serverAnswer(r));
        } else if (r.method === 'GET' && member) {
          answer(req, aMember({ id: Number(member[1]) }));
        } else if (r.method === 'POST' && returned) {
          const id = Number(returned[1]);
          server = server.map((l) => (l.id === id ? loan(id, 'Returned', l.memberId) : l));
          answer(req, server.find((l) => l.id === id) ?? null);
        } else {
          throw new Error(`unexpected request ${r.method} ${r.urlWithParams}`);
        }
      }
    }
    throw new Error('the app kept sending requests');
  }

  async function openLoansPage(): Promise<ComponentFixture<LoanList>> {
    const fixture = TestBed.createComponent(LoanList);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  async function openMemberPage(id: number): Promise<ComponentFixture<MemberDetail>> {
    const fixture = TestBed.createComponent(MemberDetail);
    fixture.componentRef.setInput('id', String(id));
    fixture.detectChanges();
    await fixture.whenStable();
    for (const req of httpTesting.match({ method: 'GET', url: `/api/members/${id}` })) {
      answer(req, aMember({ id, name: `Member ${id}` }));
    }
    await fixture.whenStable();
    return fixture;
  }

  async function chooseStatus(fixture: ComponentFixture<LoanList>, status: LoanStatus): Promise<void> {
    const select = el(fixture).querySelector('select[name="status"]') as HTMLSelectElement;
    select.value = status;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function squeeze(text: string | null | undefined): string {
    return (text ?? '').replace(/\s+/g, ' ');
  }

  function el(fixture: ComponentFixture<unknown>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /** The loan in a row, read from its first cell: every loan here is named 'Item <id>'. */
  function idOf(row: Element): number | null {
    const m = /^Item (\d+)$/.exec((row.querySelector('td')?.textContent ?? '').trim());
    return m ? Number(m[1]) : null;
  }

  function shownIds(fixture: ComponentFixture<unknown>): number[] {
    return Array.from(el(fixture).querySelectorAll('tbody tr'))
      .map(idOf)
      .filter((id): id is number => id !== null);
  }

  function emptyRowText(fixture: ComponentFixture<unknown>): string | null {
    const cell = el(fixture).querySelector('tbody td[colspan]');
    return cell ? (cell.textContent ?? '').trim() : null;
  }

  function rowOf(fixture: ComponentFixture<unknown>, id: number): HTMLTableRowElement | undefined {
    return Array.from(el(fixture).querySelectorAll<HTMLTableRowElement>('tbody tr')).find(
      (row) => idOf(row) === id,
    );
  }

  it('shows the answer to the latest status filter even when an earlier answer arrives last', async () => {
    const fixture = await openLoansPage();
    const [first] = pendingLists();
    expect(first.request.urlWithParams).toBe('/api/loans?page=1&pageSize=10');
    answer(first, page([loan(1, 'Active'), loan(2, 'Overdue'), loan(3, 'Returned')]));
    await fixture.whenStable();

    await chooseStatus(fixture, 'Overdue');
    await chooseStatus(fixture, 'Returned');
    const sent = pendingLists();
    const overdue = sent.find((r) => param(r.request, 'status') === 'Overdue');
    const returned = sent.find((r) => param(r.request, 'status') === 'Returned');
    expect(returned?.request.urlWithParams).toBe('/api/loans?page=1&pageSize=10&status=Returned');
    answer(returned as TestRequest, page([loan(30, 'Returned'), loan(31, 'Returned')], 13));
    await fixture.whenStable();
    if (overdue) {
      answer(overdue, page([loan(20, 'Overdue'), loan(21, 'Overdue'), loan(22, 'Overdue')], 25));
    }
    await fixture.whenStable();

    const text = squeeze(el(fixture).textContent);
    expect(shownIds(fixture)).toEqual([30, 31]);
    expect((el(fixture).querySelector('select[name="status"]') as HTMLSelectElement).value).toBe(
      'Returned',
    );
    expect(text).toContain('Page 1 of 2');
    expect(squeeze(el(fixture).querySelector('.summary')?.textContent)).toContain(
      '0 active, 0 overdue, 2 returned',
    );
  });

  it('shows no error for an earlier request that fails after the latest one answered', async () => {
    const fixture = await openLoansPage();
    answer(pendingLists()[0], page([loan(1, 'Active')]));
    await fixture.whenStable();

    await chooseStatus(fixture, 'Overdue');
    await chooseStatus(fixture, 'Returned');
    const sent = pendingLists();
    answer(sent.find((r) => param(r.request, 'status') === 'Returned') as TestRequest, page([loan(30, 'Returned')]));
    await fixture.whenStable();
    const overdue = sent.find((r) => param(r.request, 'status') === 'Overdue');
    if (overdue) {
      answer(overdue, null, true);
    }
    await fixture.whenStable();

    expect(el(fixture).querySelector('[role="alert"]')).toBeNull();
    expect(shownIds(fixture)).toEqual([30]);
  });

  it('still shows the error of the latest request', async () => {
    const fixture = await openLoansPage();
    answer(pendingLists()[0], page([loan(1, 'Active')]));
    await fixture.whenStable();

    await chooseStatus(fixture, 'Overdue');
    answer(pendingLists()[0], null, true);
    await fixture.whenStable();

    expect(el(fixture).querySelector('[role="alert"]')?.textContent).toContain(
      'Something went wrong. Please try again.',
    );
  });

  it('keeps Loading until the latest request has answered', async () => {
    const fixture = await openLoansPage();
    answer(pendingLists()[0], page([]));
    await fixture.whenStable();
    expect(emptyRowText(fixture)).toBe('No loans found.');

    await chooseStatus(fixture, 'Overdue');
    await chooseStatus(fixture, 'Returned');
    const sent = pendingLists();
    const overdue = sent.find((r) => param(r.request, 'status') === 'Overdue');
    const returned = sent.find((r) => param(r.request, 'status') === 'Returned') as TestRequest;
    if (overdue) {
      answer(overdue, page([]));
    }
    await fixture.whenStable();
    expect(emptyRowText(fixture)).toBe('Loading...');

    answer(returned, page([]));
    await fixture.whenStable();
    expect(emptyRowText(fixture)).toBe('No loans found.');
  });

  it('never brings a returned loan back as Active from an answer sent before the return', async () => {
    server = [loan(1, 'Active'), loan(2, 'Active')];
    const fixture = await openLoansPage();
    answer(pendingLists()[0], page([loan(1, 'Active'), loan(2, 'Active')]));
    await fixture.whenStable();

    // A reload is on its way when the return is pressed.
    await chooseStatus(fixture, 'Active');
    const stale = pendingLists();
    (rowOf(fixture, 1)?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    const [returnRequest] = httpTesting.match({ method: 'POST', url: '/api/loans/1/return' });
    server = [loan(1, 'Returned'), loan(2, 'Active')];
    answer(returnRequest, server[0]);
    await fixture.whenStable();
    for (const req of stale) {
      answer(req, page([loan(1, 'Active'), loan(2, 'Active')]));
    }
    await fixture.whenStable();
    drain();
    await fixture.whenStable();

    const row = rowOf(fixture, 1);
    if (row) {
      expect(row.textContent).not.toMatch(/Active|Overdue/);
      expect(row.querySelector('button')).toBeNull();
    }
    expect(emptyRowText(fixture) ?? 'rows').not.toBe('Loading...');
    expect(shownIds(fixture)).toContain(2);
  });

  it("never shows another member's loans on a member's page opened while the Loans page was loading", async () => {
    const loansPage = await openLoansPage();
    const everyone = pendingLists();
    loansPage.destroy();

    const memberPage = await openMemberPage(7);
    const own = pendingLists().filter((r) => param(r.request, 'memberId') === '7');
    expect(own.map((r) => r.request.urlWithParams)).toEqual([
      '/api/loans?page=1&pageSize=50&memberId=7',
    ]);
    answer(own[0], page([loan(71, 'Active', 7), loan(72, 'Returned', 7)], 2, 50));
    await memberPage.whenStable();
    for (const req of everyone) {
      answer(req, page([loan(31, 'Active', 3), loan(51, 'Overdue', 5), loan(71, 'Active', 7)], 3));
    }
    await memberPage.whenStable();

    expect(shownIds(memberPage)).toEqual([71, 72]);
    expect(squeeze(el(memberPage).textContent)).toContain('1 out, 0 overdue, 1 returned');
  });

  it("never shows the previous member's loans after moving to another member's page", async () => {
    const first = await openMemberPage(3);
    const earlier = pendingLists();
    first.destroy();

    const second = await openMemberPage(7);
    const latest = pendingLists().filter((r) => param(r.request, 'memberId') === '7');
    answer(latest[0], page([loan(71, 'Active', 7)], 1, 50));
    await second.whenStable();
    for (const req of earlier) {
      answer(req, null, true);
    }
    await second.whenStable();

    expect(shownIds(second)).toEqual([71]);
    expect(el(second).querySelector('[role="alert"]')).toBeNull();
  });

  it("keeps a member's page loading until that member's loans arrive", async () => {
    const first = await openMemberPage(3);
    const earlier = pendingLists();
    first.destroy();

    const second = await openMemberPage(7);
    for (const req of earlier) {
      answer(req, page([loan(31, 'Active', 3)], 1, 50));
    }
    await second.whenStable();

    expect(shownIds(second)).toEqual([]);
    expect(emptyRowText(second)).toBe('Loading...');
    const latest = pendingLists().filter((r) => param(r.request, 'memberId') === '7');
    answer(latest[0], page([], 0, 50));
    await second.whenStable();
    expect(emptyRowText(second)).toBe('This member has no loans.');
  });
});
