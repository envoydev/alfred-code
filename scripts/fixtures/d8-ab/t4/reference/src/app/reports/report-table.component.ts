import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';

import { toCsv } from './report-csv';
import { REPORT_PAGE_SIZE, ReportRow, ReportService } from './report.service';

@Component({
  selector: 'app-report-table',
  imports: [CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2>Sales report</h2>
    <table class="report">
      <thead>
        <tr><th>Order</th><th>Customer</th><th>Status</th><th>Total</th></tr>
      </thead>
      <tbody>
        @for (row of rows(); track row.id) {
          <tr class="report-row">
            <td>#{{ row.id }}</td>
            <td>{{ row.customer }}</td>
            <td>{{ row.status }}</td>
            <td>{{ row.total | currency: 'USD' }}</td>
          </tr>
        }
      </tbody>
    </table>
    <p class="pager">
      Page {{ page() }}
      <button type="button" name="previous" [disabled]="page() === 1" (click)="page.set(page() - 1)">Previous</button>
      <button type="button" name="next" [disabled]="!hasNext()" (click)="page.set(page() + 1)">Next</button>
    </p>
    <button type="button" name="exportCsv" (click)="csv.set(toCsv(rows()))">Export CSV</button>
    @if (csv()) {
      <textarea class="csv" readonly [value]="csv()"></textarea>
    }
  `,
})
export class ReportTableComponent {
  private readonly reports = inject(ReportService);

  protected readonly page = signal(1);
  protected readonly rows = toSignal(toObservable(this.page).pipe(switchMap((page) => this.reports.page(page))), {
    initialValue: [] as ReportRow[],
  });
  protected readonly hasNext = computed(() => this.rows().length === REPORT_PAGE_SIZE);
  protected readonly csv = signal('');
  protected readonly toCsv = toCsv;
}
