import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_URL, queryParams } from '../core/api';
import { Item, ItemInput, Paged } from '../core/models';

export interface ItemQuery {
  page: number;
  pageSize: number;
  category?: string;
  search?: string;
}

@Injectable({ providedIn: 'root' })
export class ItemsApi {
  private readonly http = inject(HttpClient);
  private readonly url = `${API_URL}/items`;

  list(query: ItemQuery): Observable<Paged<Item>> {
    return this.http.get<Paged<Item>>(this.url, { params: queryParams({ ...query }) });
  }

  get(id: number): Observable<Item> {
    return this.http.get<Item>(`${this.url}/${id}`);
  }

  create(item: ItemInput): Observable<Item> {
    return this.http.post<Item>(this.url, item);
  }

  update(id: number, item: ItemInput): Observable<Item> {
    return this.http.put<Item>(`${this.url}/${id}`, item);
  }

  /** Retires the item: it stays on record but can no longer be lent. */
  retire(id: number): Observable<void> {
    return this.http.delete<void>(`${this.url}/${id}`);
  }
}
