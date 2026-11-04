import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ReportRow, ReportService } from './report.service';

describe('ReportService', () => {
  let service: ReportService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(ReportService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('asks for one page of 25 orders', () => {
    let rows: ReportRow[] = [];
    service.page(2).subscribe((r) => (rows = r));

    const req = http.expectOne((r) => r.url === '/api/orders');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('25');
    req.flush([{ id: 26, customer: 'Ada Lovelace', status: 'Pending', total: 120 }]);
    expect(rows.length).toBe(1);
  });

  it('writes a header line and one line per row', () => {
    const csv = service.toCsv([{ id: 1, customer: 'Ada Lovelace', status: 'Pending', total: 120 }]);
    expect(csv).toBe('id,customer,status,total\n1,Ada Lovelace,Pending,120.00\n');
  });

  it('quotes a field holding a comma or a quote', () => {
    const csv = service.toCsv([
      { id: 2, customer: 'Hopper, Grace', status: 'Shipped', total: 9.5 },
      { id: 3, customer: 'The "Admiral"', status: 'Delivered', total: 10 },
    ]);
    expect(csv.split('\n')[1]).toBe('2,"Hopper, Grace",Shipped,9.50');
    expect(csv.split('\n')[2]).toBe('3,"The ""Admiral""",Delivered,10.00');
  });
});
