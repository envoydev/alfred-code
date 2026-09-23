import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Session } from '../../core/session';
import { aLoan, paged, provideApiTesting } from '../../testing/fixtures';
import { LoanList } from './loan-list';

describe('Hidden.Web03 LoanList Check in link', () => {
  let fixture: ComponentFixture<LoanList>;
  let session: Session;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function link(label: string): HTMLAnchorElement | undefined {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('a')).find(
      (a) => (a.textContent ?? '').trim() === label,
    );
  }

  async function open(): Promise<void> {
    fixture = TestBed.createComponent(LoanList);
    await settle();
    const httpTesting = TestBed.inject(HttpTestingController);
    for (const req of httpTesting.match((r) => r.url.startsWith('/api/loans'))) {
      req.flush(paged([aLoan()]));
    }
    await settle();
  }

  async function switchRole(role: 'member' | 'staff' | 'admin'): Promise<void> {
    session.role.set(role);
    await settle();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), ...provideApiTesting()] });
    session = TestBed.inject(Session);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('shows a Check in link to /loans/check-in beside New loan for staff and admin', async () => {
    session.role.set('staff');
    await open();

    expect(link('New loan')).toBeDefined();
    expect(link('Check in')?.getAttribute('href')).toBe('/loans/check-in');

    await switchRole('admin');
    expect(link('Check in')?.getAttribute('href')).toBe('/loans/check-in');
  });

  it('hides the link for members and follows role switches without a reload', async () => {
    session.role.set('member');
    await open();
    expect(link('New loan')).toBeDefined();
    expect(link('Check in')).toBeUndefined();

    await switchRole('staff');
    expect(link('Check in')?.getAttribute('href')).toBe('/loans/check-in');

    await switchRole('member');
    expect(link('Check in')).toBeUndefined();

    await switchRole('admin');
    expect(link('Check in')).toBeDefined();
  });
});
