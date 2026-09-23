import { formatDate } from '@angular/common';
import { HttpRequest } from '@angular/common/http';
import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { aMember, paged, provideApiTesting } from '../../testing/fixtures';
import { MemberList } from './member-list';

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

describe('Hidden.Web02 MemberList', () => {
  let httpTesting: HttpTestingController;
  let fixture: ComponentFixture<MemberList>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function open(): Promise<void> {
    fixture = TestBed.createComponent(MemberList);
    await settle();
  }

  function button(text: 'Previous' | 'Next'): HTMLButtonElement {
    const found = Array.from(element().querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === text,
    );
    if (!found) {
      throw new Error(`No ${text} button`);
    }
    return found;
  }

  function statusSelect(): HTMLSelectElement {
    return element().querySelector('select') as HTMLSelectElement;
  }

  async function chooseStatus(value: string): Promise<void> {
    statusSelect().value = value;
    statusSelect().dispatchEvent(new Event('change'));
    await settle();
  }

  async function click(text: 'Previous' | 'Next'): Promise<void> {
    button(text).click();
    await settle();
  }

  async function respond(page: number, status: string | undefined, total: number): Promise<void> {
    httpTesting
      .expectOne(listRequest(page, status))
      .flush(paged([aMember({ id: page * 100, name: `Member on page ${page}` })], total));
    await settle();
  }

  function pager(): string {
    const text = (element().textContent ?? '').replace(/\s+/g, ' ');
    return text.match(/Page \d+ of \d+/)?.[0] ?? '';
  }

  function tbodyText(): string {
    return (element().querySelector('tbody')?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), ...provideApiTesting()] });
    httpTesting = TestBed.inject(HttpTestingController);
  });

  // Reset even when verify throws, so one failing test cannot fail the tests after it.
  afterEach(() => {
    try {
      httpTesting.verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('first requests page 1 of All and renders one row per member', async () => {
    await open();
    expect(tbodyText()).toContain('Loading...');

    const grace = aMember({
      id: 2,
      name: 'Grace Hopper',
      email: 'grace@example.com',
      status: 'Suspended',
      createdAt: '2026-03-02T12:00:00Z',
    });
    httpTesting.expectOne(listRequest(1)).flush(paged([aMember(), grace], 12));
    await settle();

    const rows = element().querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    const link = rows[1].querySelector('a') as HTMLAnchorElement;
    expect(link.textContent?.trim()).toBe('Grace Hopper');
    expect(link.getAttribute('href')).toBe('/members/2');
    expect(rows[1].textContent).toContain('grace@example.com');
    expect(rows[1].textContent).toContain('Suspended');
    expect(rows[1].textContent).toContain(formatDate(grace.createdAt, 'mediumDate', 'en-US'));
    expect(pager()).toBe('Page 1 of 2');
    expect(tbodyText()).not.toContain('Loading...');
  });

  it('says No members found. when the page is empty', async () => {
    await open();
    httpTesting.expectOne(listRequest(1)).flush(paged([], 0));
    await settle();

    expect(tbodyText()).toBe('No members found.');
    expect(pager()).toBe('Page 1 of 1');
  });

  it('moves one page with Previous and Next, and a status choice reloads from page 1 with that status', async () => {
    await open();
    await respond(1, undefined, 30);
    expect(pager()).toBe('Page 1 of 3');
    expect(button('Previous').disabled).toBe(true);
    expect(button('Next').disabled).toBe(false);

    await click('Next');
    await respond(2, undefined, 30);
    expect(pager()).toBe('Page 2 of 3');
    expect(button('Previous').disabled).toBe(false);

    await chooseStatus('Active');
    await respond(1, 'Active', 25);
    expect(pager()).toBe('Page 1 of 3');
    expect(button('Previous').disabled).toBe(true);

    await click('Next');
    await respond(2, 'Active', 25);
    await click('Next');
    await respond(3, 'Active', 25);
    expect(pager()).toBe('Page 3 of 3');
    expect(button('Next').disabled).toBe(true);
    expect(button('Previous').disabled).toBe(false);

    await click('Previous');
    await respond(2, 'Active', 25);
    expect(pager()).toBe('Page 2 of 3');

    await chooseStatus('');
    await respond(1, undefined, 25);
    expect(pager()).toBe('Page 1 of 3');
  });

  it('shows a failed request in the alert', async () => {
    await open();
    httpTesting.expectOne(listRequest(1)).flush(
      { title: 'Forbidden', status: 403, detail: 'Members are staff only.' },
      {
        status: 403,
        statusText: 'Forbidden',
      },
    );
    await settle();

    expect(element().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'Members are staff only.',
    );
    expect(tbodyText()).toBe('No members found.');
  });

  it('reloads the page and status it was left on when it opens again, and the dropdown shows that status', async () => {
    await open();
    await respond(1, undefined, 30);
    await chooseStatus('Suspended');
    await respond(1, 'Suspended', 30);
    await click('Next');
    await respond(2, 'Suspended', 30);
    fixture.destroy();

    await open();
    await respond(2, 'Suspended', 30);

    expect(statusSelect().value).toBe('Suspended');
    expect(pager()).toBe('Page 2 of 3');
    expect(button('Previous').disabled).toBe(false);
  });
});
