import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';

import { ReportRow, ReportService } from './report.service';

@Component({
  selector: 'app-report-table',
  imports: [CurrencyPipe],
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
      <button type="button" name="previous" [disabled]="page() === 1" (click)="go(page() - 1)">Previous</button>
      <button type="button" name="next" [disabled]="rows().length < 25" (click)="go(page() + 1)">Next</button>
    </p>
    <button type="button" name="exportCsv" (click)="exportCsv()">Export CSV</button>
    @if (csv()) {
      <textarea class="csv" readonly [value]="csv()"></textarea>
    }
  `,
})
export class ReportTableComponent implements OnInit {
  private readonly reports = inject(ReportService);

  protected readonly rows = signal<ReportRow[]>([]);
  protected readonly page = signal(1);
  protected readonly csv = signal('');

  ngOnInit(): void {
    this.go(1);
  }

  protected go(page: number): void {
    this.reports.page(page).subscribe((rows) => {
      this.rows.set(rows);
      this.page.set(page);
    });
  }

  protected exportCsv(): void {
    this.csv.set(this.reports.toCsv(this.rows()));
  }
}
