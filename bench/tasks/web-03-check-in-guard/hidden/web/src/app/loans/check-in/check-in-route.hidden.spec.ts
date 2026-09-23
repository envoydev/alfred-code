import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { routes } from '../../app.routes';
import { Session } from '../../core/session';
import { paged, provideApiTesting } from '../../testing/fixtures';
import { CheckIn } from './check-in';

describe('Hidden.Web03 /loans/check-in route', () => {
  let harness: RouterTestingHarness;
  let router: Router;
  let session: Session;

  const page = (): HTMLElement => harness.routeNativeElement as HTMLElement;
  const heading = (): string | undefined => page().querySelector('h1')?.textContent?.trim();

  async function settle(): Promise<void> {
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
    for (const req of TestBed.inject(HttpTestingController).match((r) =>
      r.url.startsWith('/api/loans'),
    )) {
      req.flush(paged([]));
    }
    harness.detectChanges();
    await harness.fixture.whenStable();
  }

  async function go(url: string): Promise<void> {
    await harness.navigateByUrl(url);
    await settle();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes, withComponentInputBinding()), ...provideApiTesting()],
    });
    router = TestBed.inject(Router);
    session = TestBed.inject(Session);
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('opens the Check in page for staff, with its tab title and heading', async () => {
    session.role.set('staff');
    await go('/loans/check-in');

    expect(router.url).toBe('/loans/check-in');
    expect(harness.routeDebugElement?.componentInstance).toBeInstanceOf(CheckIn);
    expect(heading()).toBe('Check in');
    expect(TestBed.inject(Title).getTitle()).toBe('Check in');
  });

  it('opens the Check in page for admin', async () => {
    session.role.set('admin');
    await go('/loans/check-in');

    expect(router.url).toBe('/loans/check-in');
    expect(heading()).toBe('Check in');
  });

  it('sends a member to /loans instead', async () => {
    session.role.set('member');
    await go('/loans/check-in');

    expect(router.url).toBe('/loans');
    expect(harness.routeDebugElement?.componentInstance).not.toBeInstanceOf(CheckIn);
    expect(heading()).toBe('Loans');
  });

  it('reads the role picked at the moment of each navigation', async () => {
    session.role.set('member');
    await go('/loans/check-in');
    expect(router.url).toBe('/loans');

    session.role.set('staff');
    await go('/loans/check-in');
    expect(router.url).toBe('/loans/check-in');

    session.role.set('member');
    await go('/loans');
    await go('/loans/check-in');
    expect(router.url).toBe('/loans');
  });

  it('follows the Check in link on the loans page', async () => {
    session.role.set('admin');
    await go('/loans');

    const link = Array.from(page().querySelectorAll('a')).find(
      (a) => (a.textContent ?? '').trim() === 'Check in',
    );
    expect(link).toBeDefined();
    link?.click();
    await settle();

    expect(router.url).toBe('/loans/check-in');
    expect(heading()).toBe('Check in');
  });
});
