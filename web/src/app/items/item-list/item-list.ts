import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { pageCount } from '../../core/api';
import { Item } from '../../core/models';
import { problemMessage } from '../../core/problem';
import { ItemsApi } from '../items-api';

@Component({
  selector: 'app-item-list',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './item-list.html',
})
export class ItemList implements OnInit {
  private readonly api = inject(ItemsApi);

  protected readonly pageSize = 10;
  protected readonly filters = inject(NonNullableFormBuilder).group({
    search: [''],
    category: [''],
  });

  protected readonly page = signal(1);
  protected readonly items = signal<Item[]>([]);
  protected readonly totalCount = signal(0);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly pageCount = computed(() => pageCount(this.totalCount(), this.pageSize));

  ngOnInit(): void {
    this.load();
  }

  protected applyFilters(): void {
    this.page.set(1);
    this.load();
  }

  protected goTo(page: number): void {
    this.page.set(page);
    this.load();
  }

  protected retire(item: Item): void {
    this.error.set(null);
    this.api.retire(item.id).subscribe({
      next: () => this.load(),
      error: (error: unknown) => this.error.set(problemMessage(error)),
    });
  }

  private load(): void {
    const { search, category } = this.filters.getRawValue();
    this.loading.set(true);
    this.error.set(null);
    this.api
      .list({
        page: this.page(),
        pageSize: this.pageSize,
        category: category.trim(),
        search: search.trim(),
      })
      .subscribe({
        next: (result) => {
          this.items.set(result.items);
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
