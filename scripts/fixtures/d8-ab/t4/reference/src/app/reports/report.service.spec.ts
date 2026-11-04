import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { REPORT_PAGE_SIZE, ReportRow, ReportService } from './report.service';

describe('ReportService', () => {
  let service: ReportService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(ReportService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('asks for one page of orders and keeps only the report columns', () => {
    let rows: ReportRow[] = [];
    service.page(2).subscribe((r) => (rows = r));

    const req = http.expectOne((r) => r.url === '/api/orders');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe(String(REPORT_PAGE_SIZE));
    req.flush([{ id: 26, customer: 'Ada Lovelace', status: 'Pending', total: 120, placedAt: '2026-10-01T09:00:00Z' }]);
    expect(rows).toEqual([{ id: 26, customer: 'Ada Lovelace', status: 'Pending', total: 120 }]);
  });
});
