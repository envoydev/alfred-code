import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_URL, queryParams } from '../core/api';
import { Loan, Member, MemberInput, MemberStatus, Paged } from '../core/models';

export interface MemberQuery {
  page: number;
  pageSize: number;
  status?: MemberStatus | '';
}

@Injectable({ providedIn: 'root' })
export class MembersApi {
  private readonly http = inject(HttpClient);
  private readonly url = `${API_URL}/members`;

  list(query: MemberQuery): Observable<Paged<Member>> {
    return this.http.get<Paged<Member>>(this.url, { params: queryParams({ ...query }) });
  }

  get(id: number): Observable<Member> {
    return this.http.get<Member>(`${this.url}/${id}`);
  }

  create(member: MemberInput): Observable<Member> {
    return this.http.post<Member>(this.url, member);
  }

  update(id: number, member: MemberInput): Observable<Member> {
    return this.http.put<Member>(`${this.url}/${id}`, member);
  }

  suspend(id: number): Observable<Member> {
    return this.http.post<Member>(`${this.url}/${id}/suspend`, null);
  }

  loans(id: number): Observable<Loan[]> {
    return this.http.get<Loan[]>(`${this.url}/${id}/loans`);
  }
}
