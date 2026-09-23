import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { anItem, paged, provideApiTesting } from '../../testing/fixtures';
import { ItemList } from './item-list';

describe('ItemList', () => {
  it('lists items and retires one, then reloads the page', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), ...provideApiTesting()] });
    const httpTesting = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ItemList);
    fixture.detectChanges();

    const items = [anItem({ id: 5 }), anItem({ id: 6, name: 'Ladder', isRetired: true })];
    httpTesting.expectOne('/api/items?page=1&pageSize=10').flush(paged(items));
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    const buttons = element.querySelectorAll<HTMLButtonElement>('tbody button');
    expect(element.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(buttons[1].disabled).toBe(true);

    buttons[0].click();
    httpTesting
      .expectOne({ method: 'DELETE', url: '/api/items/5' })
      .flush(null, { status: 204, statusText: 'No Content' });
    httpTesting.expectOne('/api/items?page=1&pageSize=10').flush(paged(items));
    httpTesting.verify();
  });
});
