import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { EnvironmentProviders, Provider } from '@angular/core';

import { demoHeadersInterceptor } from '../core/demo-headers-interceptor';
import { Item, Loan, Member, Paged } from '../core/models';

export function provideApiTesting(): (Provider | EnvironmentProviders)[] {
  return [
    provideHttpClient(withInterceptors([demoHeadersInterceptor])),
    provideHttpClientTesting(),
  ];
}

export function paged<T>(items: T[], totalCount = items.length): Paged<T> {
  return { items, page: 1, pageSize: 10, totalCount };
}

export function aMember(overrides: Partial<Member> = {}): Member {
  return {
    id: 1,
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    status: 'Active',
    createdAt: '2026-01-15T09:30:00Z',
    ...overrides,
  };
}

export function anItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 1,
    name: 'Cordless drill',
    category: 'Tools',
    sku: 'TL-001',
    totalStock: 3,
    available: 2,
    condition: 'Good',
    isRetired: false,
    ...overrides,
  };
}

export function aLoan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: 1,
    itemId: 1,
    itemName: 'Cordless drill',
    memberId: 1,
    memberName: 'Ada Lovelace',
    startDate: '2026-09-01',
    dueDate: '2026-09-15',
    returnedAt: null,
    status: 'Active',
    ...overrides,
  };
}
