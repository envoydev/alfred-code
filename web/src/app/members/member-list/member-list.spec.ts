import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { aMember, paged, provideApiTesting } from '../../testing/fixtures';
import { MemberList } from './member-list';

describe('MemberList', () => {
  it('renders one row per member and reloads when the status filter changes', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), ...provideApiTesting()] });
    const httpTesting = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(MemberList);
    fixture.detectChanges();

    httpTesting
      .expectOne('/api/members?page=1&pageSize=10')
      .flush(paged([aMember(), aMember({ id: 2, name: 'Grace Hopper', status: 'Suspended' })], 12));
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    const rows = element.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[1].textContent).toContain('Grace Hopper');
    expect(rows[1].textContent).toContain('Suspended');
    expect(element.querySelector('.pager span')?.textContent).toContain('Page 1 of 2');

    const select = element.querySelector('select') as HTMLSelectElement;
    select.value = 'Active';
    select.dispatchEvent(new Event('change'));
    httpTesting.expectOne('/api/members?page=1&pageSize=10&status=Active').flush(paged([]));
    httpTesting.verify();
  });
});
