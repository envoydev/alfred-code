import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { pageCount } from '../../core/api';
import { Member, MemberStatus } from '../../core/models';
import { problemMessage } from '../../core/problem';
import { MembersApi } from '../members-api';

@Component({
  selector: 'app-member-list',
  imports: [RouterLink, DatePipe],
  templateUrl: './member-list.html',
})
export class MemberList implements OnInit {
  private readonly api = inject(MembersApi);

  protected readonly pageSize = 10;
  protected readonly statuses: MemberStatus[] = ['Active', 'Suspended'];

  protected readonly page = signal(1);
  protected readonly status = signal<MemberStatus | ''>('');
  protected readonly members = signal<Member[]>([]);
  protected readonly totalCount = signal(0);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly pageCount = computed(() => pageCount(this.totalCount(), this.pageSize));

  ngOnInit(): void {
    this.load();
  }

  protected setStatus(event: Event): void {
    this.status.set((event.target as HTMLSelectElement).value as MemberStatus | '');
    this.page.set(1);
    this.load();
  }

  protected goTo(page: number): void {
    this.page.set(page);
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.list({ page: this.page(), pageSize: this.pageSize, status: this.status() }).subscribe({
      next: (result) => {
        this.members.set(result.items);
        this.totalCount.set(result.totalCount);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(problemMessage(error));
        this.loading.set(false);
      },
    });
  }
}
