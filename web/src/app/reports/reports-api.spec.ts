import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { OverdueLoan } from '../core/models';
import { provideApiTesting } from '../testing/fixtures';
import { ReportsApi } from './reports-api';

describe('ReportsApi', () => {
  it('fetches the overdue report', () => {
    TestBed.configureTestingModule({ providers: provideApiTesting() });
    const api = TestBed.inject(ReportsApi);
    const httpTesting = TestBed.inject(HttpTestingController);
    const rows: OverdueLoan[] = [
      { loanId: 4, itemName: 'Ladder', memberName: 'Ada', dueDate: '2026-09-01', daysOverdue: 3 },
    ];
    let received: OverdueLoan[] = [];

    api.overdue().subscribe((r) => (received = r));
    const req = httpTesting.expectOne('/api/reports/overdue');
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.get('X-Demo-Role')).toBe('staff');
    req.flush(rows);

    expect(received).toEqual(rows);
    httpTesting.verify();
  });
});
