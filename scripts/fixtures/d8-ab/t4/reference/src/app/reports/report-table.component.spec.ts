import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { REPORT_PAGE_SIZE } from './report.service';
import { ReportTableComponent } from './report-table.component';

const PAGE = [
  { id: 1, customer: 'Ada Lovelace', status: 'Pending', total: 120 },
  { id: 2, customer: 'Hopper, Grace', status: 'Shipped', total: 75.5 },
];
const FULL = Array.from({ length: REPORT_PAGE_SIZE }, (_, i) => ({ id: i + 1, customer: `Customer ${i + 1}`, status: 'Pending', total: 10 }));

describe('ReportTableComponent', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ReportTableComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('shows the first page of the report', async () => {
    const fixture = TestBed.createComponent(ReportTableComponent);
    await fixture.whenStable();
    http.expectOne((r) => r.url === '/api/orders' && r.params.get('page') === '1').flush(PAGE);
    await fixture.whenStable();

    const rows: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('.report-row'));
    expect(rows.length).toBe(2);
    expect(rows[1].textContent).toContain('Hopper, Grace');
    expect(rows[0].textContent).toContain('$120.00');
  });

  it('has no next page when the page is not full', async () => {
    const fixture = TestBed.createComponent(ReportTableComponent);
    await fixture.whenStable();
    http.expectOne((r) => r.url === '/api/orders').flush(PAGE);
    await fixture.whenStable();

    expect((fixture.nativeElement.querySelector('button[name=next]') as HTMLButtonElement).disabled).toBe(true);
    expect((fixture.nativeElement.querySelector('button[name=previous]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('loads the next page from a full one', async () => {
    const fixture = TestBed.createComponent(ReportTableComponent);
    await fixture.whenStable();
    http.expectOne((r) => r.url === '/api/orders').flush(FULL);
    await fixture.whenStable();

    (fixture.nativeElement.querySelector('button[name=next]') as HTMLButtonElement).click();
    await fixture.whenStable();
    http.expectOne((r) => r.url === '/api/orders' && r.params.get('page') === '2').flush(PAGE);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelectorAll('.report-row').length).toBe(2);
    expect(fixture.nativeElement.querySelector('.pager')?.textContent).toContain('Page 2');
  });

  it('exports the shown rows as CSV', async () => {
    const fixture = TestBed.createComponent(ReportTableComponent);
    await fixture.whenStable();
    http.expectOne((r) => r.url === '/api/orders').flush(PAGE);
    await fixture.whenStable();

    (fixture.nativeElement.querySelector('button[name=exportCsv]') as HTMLButtonElement).click();
    await fixture.whenStable();

    const csv = (fixture.nativeElement.querySelector('textarea.csv') as HTMLTextAreaElement).value;
    expect(csv).toContain('id,customer,status,total');
    expect(csv).toContain('2,"Hopper, Grace",Shipped,75.50');
  });
});
