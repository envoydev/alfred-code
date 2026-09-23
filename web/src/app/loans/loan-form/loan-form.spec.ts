import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { aLoan, aMember, anItem, paged, provideApiTesting } from '../../testing/fixtures';
import { LoanForm } from './loan-form';

describe('LoanForm', () => {
  let httpTesting: HttpTestingController;

  async function createForm() {
    const fixture = TestBed.createComponent(LoanForm);
    fixture.detectChanges();
    httpTesting.expectOne((r) => r.url === '/api/items').flush(paged([anItem({ id: 2 })]));
    httpTesting.expectOne((r) => r.url === '/api/members').flush(paged([aMember({ id: 3 })]));
    await fixture.whenStable();
    return fixture;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), ...provideApiTesting()] });
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('requires every field', async () => {
    const fixture = await createForm();
    const form = fixture.componentInstance.form;
    form.controls.startDate.setValue('');

    for (const control of Object.values(form.controls)) {
      expect(control.hasError('required')).toBe(true);
    }
    form.setValue({ itemId: 2, memberId: 3, startDate: '2026-09-01', dueDate: '2026-09-08' });
    expect(form.valid).toBe(true);
  });

  it('accepts any pair of dates and sends them as entered', async () => {
    const fixture = await createForm();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const form = fixture.componentInstance.form;

    form.setValue({ itemId: 2, memberId: 3, startDate: '2026-09-20', dueDate: '2026-09-01' });
    expect(form.valid).toBe(true);

    (fixture.nativeElement as HTMLElement)
      .querySelector('form')
      ?.dispatchEvent(new Event('submit'));
    const req = httpTesting.expectOne({ method: 'POST', url: '/api/loans' });
    expect(req.request.body).toEqual({
      itemId: 2,
      memberId: 3,
      startDate: '2026-09-20',
      dueDate: '2026-09-01',
    });
    req.flush(aLoan(), { status: 201, statusText: 'Created' });
    expect(navigate).toHaveBeenCalledWith(['/loans']);
  });
});
