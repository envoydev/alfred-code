import { HttpClient } from '@angular/common/http';
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { provideApiTesting } from '../testing/fixtures';
import { Session } from './session';

describe('demoHeadersInterceptor', () => {
  it('sends the current session user and role with every request', () => {
    TestBed.configureTestingModule({ providers: provideApiTesting() });
    const http = TestBed.inject(HttpClient);
    const httpTesting = TestBed.inject(HttpTestingController);
    const session = TestBed.inject(Session);

    http.get('/api/items').subscribe();
    const first = httpTesting.expectOne('/api/items');
    expect(first.request.headers.get('X-Demo-User')).toBe('desk');
    expect(first.request.headers.get('X-Demo-Role')).toBe('staff');
    first.flush([]);

    session.user.set('grace');
    session.role.set('admin');
    http.get('/api/items').subscribe();
    const second = httpTesting.expectOne('/api/items');
    expect(second.request.headers.get('X-Demo-User')).toBe('grace');
    expect(second.request.headers.get('X-Demo-Role')).toBe('admin');
    second.flush([]);

    httpTesting.verify();
  });
});
