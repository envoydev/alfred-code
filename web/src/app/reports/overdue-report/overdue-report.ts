import { Component, OnInit, inject, signal } from '@angular/core';

import { OverdueLoan } from '../../core/models';
import { problemMessage } from '../../core/problem';
import { ReportsApi } from '../reports-api';

@Component({
  selector: 'app-overdue-report',
  templateUrl: './overdue-report.html',
})
export class OverdueReport implements OnInit {
  private readonly api = inject(ReportsApi);

  protected readonly rows = signal<OverdueLoan[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.api.overdue().subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(problemMessage(error));
        this.loading.set(false);
      },
    });
  }
}
