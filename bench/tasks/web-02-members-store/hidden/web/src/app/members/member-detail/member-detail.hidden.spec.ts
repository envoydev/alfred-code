import { formatDate } from '@angular/common';
import { HttpRequest } from '@angular/common/http';
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { Member } from '../../core/models';
import { aLoan, aMember, paged, provideApiTesting } from '../../testing/fixtures';
import { membersRoutes } from '../members.routes';

describe('Hidden.Web02 MemberDetail', () => {
  let httpTesting: HttpTestingController;
  let harness: RouterTestingHarness;

  const grace = aMember({
    id: 7,
    name: 'Grace Hopper',
    email: 'grace@example.com',
    status: 'Active',
    createdAt: '2026-03-02T12:00:00Z',
  });

  const page = (): HTMLElement => harness.routeNativeElement as HTMLElement;
  const text = (): string => (page().textContent ?? '').replace(/\s+/g, ' ');

  async function settle(): Promise<void> {
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  async function go(url: string): Promise<void> {
    await harness.navigateByUrl(url);
    await settle();
  }

  const isLoansRequest = (r: HttpRequest<unknown>): boolean =>
    new URL(r.urlWithParams, 'http://localhost').pathname === '/api/loans';

  async function flushLoans(): Promise<void> {
    for (const req of httpTesting.match(isLoansRequest)) {
      req.flush(paged([]));
    }
    await settle();
  }

  async function flushMember(member: Member): Promise<void> {
    httpTesting.expectOne({ method: 'GET', url: `/api/members/${member.id}` }).flush(member);
    await settle();
  }

  function suspendButton(): HTMLButtonElement | undefined {
    return Array.from(page().querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === 'Suspend',
    );
  }

  function alerts(): string[] {
    return Array.from(page().querySelectorAll('[role="alert"]')).map((a) =>
      (a.textContent ?? '').trim(),
    );
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'members', children: membersRoutes }], withComponentInputBinding()),
        ...provideApiTesting(),
      ],
    });
    httpTesting = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
  });

  // Reset even when verify throws, so one failing test cannot fail the tests after it.
  afterEach(() => {
    try {
      httpTesting.verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('requests the member and shows Loading... until it arrives, then its details and its loans', async () => {
    await go('/members/7');
    const loans = httpTesting.expectOne(isLoansRequest);
    const params = new URL(loans.request.urlWithParams, 'http://localhost').searchParams;
    expect(params.get('memberId')).toBe('7');
    expect(params.get('pageSize')).toBe('50');
    loans.flush(paged([aLoan({ id: 41, itemName: 'Folding ladder', memberId: 7 })]));
    await settle();

    expect(text()).toContain('Loading...');
    expect(page().querySelector('h1')).toBeNull();

    await flushMember(grace);

    expect(page().querySelector('h1')?.textContent?.trim()).toBe('Grace Hopper');
    expect(text()).toContain('grace@example.com');
    expect(text()).toContain('Active');
    expect(text()).toContain(formatDate(grace.createdAt, 'mediumDate', 'en-US'));
    expect(text()).not.toContain('Loading...');
    expect(text()).toContain('Folding ladder');
  });

  it('never shows the member viewed before while the next one loads', async () => {
    await go('/members/3');
    await flushLoans();
    await flushMember(aMember({ id: 3, name: 'Ada Lovelace', email: 'ada@example.com' }));
    expect(page().querySelector('h1')?.textContent?.trim()).toBe('Ada Lovelace');

    await go('/members');
    httpTesting
      .expectOne((r) => new URL(r.urlWithParams, 'http://localhost').pathname === '/api/members')
      .flush(paged([aMember({ id: 3, name: 'Ada Lovelace' }), grace]));
    await settle();

    await go('/members/7');
    await flushLoans();
    expect(text()).toContain('Loading...');
    expect(text()).not.toContain('Ada Lovelace');
    expect(text()).not.toContain('ada@example.com');

    await flushMember(grace);
    expect(page().querySelector('h1')?.textContent?.trim()).toBe('Grace Hopper');
  });

  it('offers Suspend for an Active member, disables it while the request runs, and shows Suspended after', async () => {
    await go('/members/7');
    await flushLoans();
    await flushMember(grace);

    const button = suspendButton();
    expect(button).toBeDefined();
    expect(button?.disabled).toBe(false);
    button?.click();
    await settle();
    expect(suspendButton()?.disabled).toBe(true);

    httpTesting
      .expectOne({ method: 'POST', url: '/api/members/7/suspend' })
      .flush({ ...grace, status: 'Suspended' });
    await settle();

    expect(suspendButton()).toBeUndefined();
    expect(text()).toContain('Suspended');
  });

  it('does not offer Suspend for a Suspended member', async () => {
    await go('/members/8');
    await flushLoans();
    await flushMember(aMember({ id: 8, name: 'Mary Somerville', status: 'Suspended' }));

    expect(page().querySelector('h1')?.textContent?.trim()).toBe('Mary Somerville');
    expect(text()).toContain('Suspended');
    expect(suspendButton()).toBeUndefined();
  });

  it('shows a failed suspend in the alert and offers Suspend again', async () => {
    await go('/members/7');
    await flushLoans();
    await flushMember(grace);

    suspendButton()?.click();
    await settle();
    httpTesting.expectOne({ method: 'POST', url: '/api/members/7/suspend' }).flush(
      { title: 'Conflict', status: 409, detail: 'Grace Hopper has loans out.' },
      {
        status: 409,
        statusText: 'Conflict',
      },
    );
    await settle();

    expect(alerts()).toContain('Grace Hopper has loans out.');
    expect(suspendButton()?.disabled).toBe(false);
    expect(page().querySelector('h1')?.textContent?.trim()).toBe('Grace Hopper');
  });

  it('shows a failed member request in the alert', async () => {
    await go('/members/9');
    await flushLoans();
    httpTesting.expectOne({ method: 'GET', url: '/api/members/9' }).flush(
      { title: 'Not Found', status: 404, detail: 'Member 9 was not found.' },
      {
        status: 404,
        statusText: 'Not Found',
      },
    );
    await settle();

    expect(alerts()).toContain('Member 9 was not found.');
  });
});
