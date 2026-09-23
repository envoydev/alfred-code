import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { OverdueLoan } from '../../core/models';
import { provideApiTesting } from '../../testing/fixtures';
import { OverdueReport } from './overdue-report';

const ADA_ROW = {
  loanId: 4,
  item: { id: 2, name: 'Ladder', sku: 'LD-001' },
  member: { id: 7, name: 'Ada Lovelace', email: 'ada@example.com' },
  dueDate: '2026-09-01',
  daysOverdue: 3,
};

const GRACE_ROW = {
  loanId: 9,
  item: { id: 5, name: 'Ladder', sku: 'LD-002' },
  member: { id: 11, name: 'Grace Hopper', email: 'grace@example.com' },
  dueDate: '2026-09-05',
  daysOverdue: 1,
};

function text(node: Element | null | undefined): string {
  return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function render(): {
  element: HTMLElement;
  respond: (body: unknown, init?: { status: number; statusText: string }) => Promise<void>;
  httpTesting: HttpTestingController;
} {
  TestBed.configureTestingModule({ providers: [provideRouter([]), ...provideApiTesting()] });
  const httpTesting = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(OverdueReport);
  fixture.detectChanges();
  const request = httpTesting.expectOne('/api/reports/overdue');
  const element = fixture.nativeElement as HTMLElement;
  return {
    element,
    httpTesting,
    respond: async (body, init) => {
      request.flush(body as object, init);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    },
  };
}

describe('Hidden cross-01 OverdueReport', () => {
  it('shows the item name with its SKU in brackets', async () => {
    const page = render();
    await page.respond([ADA_ROW]);

    const cells = page.element.querySelectorAll('tbody tr')[0].querySelectorAll('td');
    expect(text(cells[0])).toBe('Ladder (LD-001)');
    page.httpTesting.verify();
  });

  it('links the member name to the member page, then the email as a mail link', async () => {
    const page = render();
    await page.respond([ADA_ROW]);

    const memberCell = page.element.querySelectorAll('tbody tr')[0].querySelectorAll('td')[1];
    const links = Array.from(memberCell.querySelectorAll('a'));
    const nameLink = links.find((a) => a.getAttribute('href') === '/members/7');
    const mailLink = links.find((a) => a.getAttribute('href') === 'mailto:ada@example.com');

    expect(nameLink).toBeDefined();
    expect(text(nameLink)).toBe('Ada Lovelace');
    expect(mailLink).toBeDefined();
    expect(text(mailLink)).toBe('ada@example.com');
    expect(links.indexOf(nameLink as HTMLAnchorElement)).toBeLessThan(
      links.indexOf(mailLink as HTMLAnchorElement),
    );
  });

  it('keeps the Due and Days overdue columns and the order the API sends', async () => {
    const page = render();
    await page.respond([ADA_ROW, GRACE_ROW]);

    const rows = Array.from(page.element.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => text(row.querySelectorAll('td')[0]))).toEqual([
      'Ladder (LD-001)',
      'Ladder (LD-002)',
    ]);
    expect(rows.map((row) => text(row.querySelectorAll('td')[2]))).toEqual([
      '2026-09-01',
      '2026-09-05',
    ]);
    expect(rows.map((row) => text(row.querySelectorAll('td')[3]))).toEqual(['3', '1']);
    const graceLinks = Array.from(rows[1].querySelectorAll('td')[1].querySelectorAll('a'));
    expect(graceLinks.map((a) => a.getAttribute('href'))).toEqual(
      expect.arrayContaining(['/members/11', 'mailto:grace@example.com']),
    );
  });

  it('shows Loading... until the report arrives, then Nothing is overdue. when it is empty', async () => {
    const page = render();
    expect(text(page.element.querySelector('tbody'))).toContain('Loading...');

    await page.respond([]);

    expect(text(page.element.querySelector('tbody'))).toContain('Nothing is overdue.');
    expect(text(page.element.querySelector('tbody'))).not.toContain('Loading...');
  });

  it('shows the problem detail when the report fails', async () => {
    const page = render();

    await page.respond(
      { title: 'Server error', status: 500, detail: 'The report could not be built.' },
      { status: 500, statusText: 'Server Error' },
    );

    expect(text(page.element.querySelector('[role="alert"]'))).toBe(
      'The report could not be built.',
    );
  });

  it('types a row as the new shape, without itemName and memberName', () => {
    const row: OverdueLoan = {
      loanId: 4,
      item: { id: 2, name: 'Ladder', sku: 'LD-001' },
      member: { id: 7, name: 'Ada Lovelace', email: 'ada@example.com' },
      dueDate: '2026-09-01',
      daysOverdue: 3,
    };
    expectTypeOf<OverdueLoan>().not.toHaveProperty('itemName');
    expectTypeOf<OverdueLoan>().not.toHaveProperty('memberName');
    expect(row.member.email).toBe('ada@example.com');
  });
});
