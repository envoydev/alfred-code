import { HttpRequest } from '@angular/common/http';
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { aMember, paged, provideApiTesting } from '../testing/fixtures';
import { membersRoutes } from './members.routes';

/** Matches GET /api/members for this page and status (no status = All). */
function listRequest(page: number, status?: string) {
  return (r: HttpRequest<unknown>): boolean => {
    const url = new URL(r.urlWithParams, 'http://localhost');
    const expected: Record<string, string> = { page: String(page), pageSize: '10' };
    if (status) {
      expected['status'] = status;
    }
    const actual = Object.fromEntries(url.searchParams.entries());
    return (
      r.method === 'GET' &&
      url.pathname === '/api/members' &&
      JSON.stringify(Object.entries(actual).sort()) ===
        JSON.stringify(Object.entries(expected).sort())
    );
  };
}

describe('Hidden.Web02 member list and member page share one store', () => {
  let httpTesting: HttpTestingController;
  let harness: RouterTestingHarness;

  const page = (): HTMLElement => harness.routeNativeElement as HTMLElement;
  const text = (): string => (page().textContent ?? '').replace(/\s+/g, ' ');

  async function settle(): Promise<void> {
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  function byText<T extends HTMLElement>(selector: string, label: string): T {
    const found = Array.from(page().querySelectorAll<T>(selector)).find(
      (e) => (e.textContent ?? '').trim() === label,
    );
    if (!found) {
      throw new Error(`No ${selector} reading '${label}'`);
    }
    return found;
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

  it('comes back from a member to the page and status the list was left on', async () => {
    await harness.navigateByUrl('/members');
    await settle();
    httpTesting.expectOne(listRequest(1)).flush(paged([aMember()], 25));
    await settle();

    const select = page().querySelector('select') as HTMLSelectElement;
    select.value = 'Suspended';
    select.dispatchEvent(new Event('change'));
    await settle();
    httpTesting
      .expectOne(listRequest(1, 'Suspended'))
      .flush(paged([aMember({ id: 4, status: 'Suspended' })], 25));
    await settle();

    byText<HTMLButtonElement>('button', 'Next').click();
    await settle();
    const grace = aMember({ id: 7, name: 'Grace Hopper', status: 'Suspended' });
    httpTesting.expectOne(listRequest(2, 'Suspended')).flush(paged([grace], 25));
    await settle();
    expect(text()).toContain('Page 2 of 3');

    byText<HTMLAnchorElement>('a', 'Grace Hopper').click();
    await settle();
    httpTesting.expectOne({ method: 'GET', url: '/api/members/7' }).flush(grace);
    for (const req of httpTesting.match(
      (r) => new URL(r.urlWithParams, 'http://localhost').pathname === '/api/loans',
    )) {
      req.flush(paged([]));
    }
    await settle();
    expect(page().querySelector('h1')?.textContent?.trim()).toBe('Grace Hopper');

    byText<HTMLAnchorElement>('a', '← Members').click();
    await settle();
    httpTesting
      .expectOne(listRequest(2, 'Suspended'))
      .flush(paged([grace, aMember({ id: 8, status: 'Suspended' })], 25));
    await settle();

    expect((page().querySelector('select') as HTMLSelectElement).value).toBe('Suspended');
    expect(text()).toContain('Page 2 of 3');
    expect(page().querySelectorAll('tbody tr')).toHaveLength(2);
  });
});
