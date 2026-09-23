import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideApiTesting } from '../../testing/fixtures';
import { MemberForm } from './member-form';

describe('MemberForm', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), ...provideApiTesting()] });
  });

  it('requires a name and a valid email', async () => {
    const fixture = TestBed.createComponent(MemberForm);
    await fixture.whenStable();
    const form = fixture.componentInstance.form;

    expect(form.valid).toBe(false);
    form.setValue({ name: 'Ada Lovelace', email: 'not-an-email' });
    expect(form.controls.email.hasError('email')).toBe(true);
    form.controls.email.setValue('ada@example.com');
    expect(form.valid).toBe(true);
  });

  it('shows the first validation error the server returns', async () => {
    const httpTesting = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(MemberForm);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    fixture.componentInstance.form.setValue({ name: 'Ada', email: 'ada@example.com' });
    element.querySelector('form')?.dispatchEvent(new Event('submit'));
    httpTesting.expectOne({ method: 'POST', url: '/api/members' }).flush(
      {
        title: 'One or more validation errors occurred.',
        status: 400,
        errors: { Email: ['Email is already registered.'] },
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await fixture.whenStable();

    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      'Email is already registered.',
    );
    httpTesting.verify();
  });
});
