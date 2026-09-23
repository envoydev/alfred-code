import { HttpTestingController } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { aLoan, aMember, anItem, paged, provideApiTesting } from '../../testing/fixtures';
import { LoanForm } from './loan-form';

@Component({ template: '' })
class LoansPageStub {}

const BEFORE_START = 'The due date cannot be before the start date.';
const TOO_LONG = 'A loan can last at most 28 days.';
const DUE_REQUIRED = 'Due date is required.';

// Every date pair below stays inside June/July, so no pair crosses a daylight-saving change.
describe('Hidden.Web01 LoanForm date rules', () => {
  let httpTesting: HttpTestingController;
  let fixture: ComponentFixture<LoanForm>;
  let element: HTMLElement;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function label(text: string): HTMLLabelElement {
    const found = Array.from(element.querySelectorAll('label')).find((l) =>
      (l.textContent ?? '').trim().startsWith(text),
    );
    if (!found) {
      throw new Error(`No field labelled '${text}'`);
    }
    return found;
  }

  function control<T extends HTMLElement>(text: string): T {
    const found = label(text).querySelector('input, select');
    if (!found) {
      throw new Error(`No control in the '${text}' field`);
    }
    return found as T;
  }

  function errorsUnder(text: string): string[] {
    return Array.from(label(text).querySelectorAll('.field-error')).map((e) =>
      (e.textContent ?? '').trim(),
    );
  }

  async function typeDate(text: 'Start date' | 'Due date', value: string): Promise<void> {
    const input = control<HTMLInputElement>(text);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  }

  async function touch(text: string): Promise<void> {
    control(text).dispatchEvent(new Event('blur'));
    await settle();
  }

  async function chooseFirst(text: 'Item' | 'Member'): Promise<void> {
    const select = control<HTMLSelectElement>(text);
    select.selectedIndex = 1;
    select.dispatchEvent(new Event('change'));
    await settle();
  }

  function createButton(): HTMLButtonElement {
    const found = Array.from(element.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === 'Create loan',
    );
    if (!found) {
      throw new Error('No Create loan button');
    }
    return found;
  }

  async function submitForm(): Promise<void> {
    element.querySelector('form')?.dispatchEvent(new Event('submit'));
    await settle();
  }

  async function fillAll(start: string, due: string): Promise<void> {
    await chooseFirst('Item');
    await chooseFirst('Member');
    await typeDate('Start date', start);
    await typeDate('Due date', due);
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'loans', component: LoansPageStub }]),
        ...provideApiTesting(),
      ],
    });
    httpTesting = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(LoanForm);
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    httpTesting.expectOne((r) => r.url === '/api/items').flush(paged([anItem({ id: 2 })]));
    httpTesting.expectOne((r) => r.url === '/api/members').flush(paged([aMember({ id: 3 })]));
    await settle();
  });

  // Reset even when verify throws, so one failing test cannot fail the tests after it.
  afterEach(() => {
    try {
      httpTesting.verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('shows the before-start message under Due date as soon as both dates break the rule, untouched and unsubmitted', async () => {
    await typeDate('Start date', '2026-06-10');
    await typeDate('Due date', '2026-06-09');

    expect(errorsUnder('Due date')).toEqual([BEFORE_START]);
    expect(errorsUnder('Start date')).toEqual([]);

    await typeDate('Due date', '2026-06-10');
    expect(errorsUnder('Due date')).toEqual([]);
  });

  it('allows a loan of at most 28 days and shows the length message past that', async () => {
    await typeDate('Start date', '2026-06-01');
    await typeDate('Due date', '2026-06-29');
    expect(errorsUnder('Due date')).toEqual([]);

    await typeDate('Due date', '2026-06-30');
    expect(errorsUnder('Due date')).toEqual([TOO_LONG]);

    await typeDate('Start date', '2026-06-20');
    await typeDate('Due date', '2026-07-18');
    expect(errorsUnder('Due date')).toEqual([]);

    await typeDate('Due date', '2026-07-19');
    expect(errorsUnder('Due date')).toEqual([TOO_LONG]);

    await typeDate('Due date', '2026-07-01');
    expect(errorsUnder('Due date')).toEqual([]);
  });

  it('rechecks the rules when only the start date changes', async () => {
    await typeDate('Start date', '2026-06-10');
    await typeDate('Due date', '2026-06-12');
    expect(errorsUnder('Due date')).toEqual([]);

    await typeDate('Start date', '2026-06-15');
    expect(errorsUnder('Due date')).toEqual([BEFORE_START]);

    await typeDate('Start date', '2026-05-10');
    expect(errorsUnder('Due date')).toEqual([TOO_LONG]);

    await typeDate('Start date', '2026-06-01');
    expect(errorsUnder('Due date')).toEqual([]);
  });

  it('shows no date-rule message while either date is empty', async () => {
    await typeDate('Start date', '');
    await typeDate('Due date', '2026-06-09');
    expect(errorsUnder('Due date')).toEqual([]);

    await typeDate('Start date', '2026-06-10');
    expect(errorsUnder('Due date')).toEqual([BEFORE_START]);

    await typeDate('Due date', '');
    expect(errorsUnder('Due date')).toEqual([]);
  });

  it('shows at most one message under Due date: required when empty and touched, else the rule message', async () => {
    await typeDate('Start date', '2026-06-10');
    await typeDate('Due date', '2026-06-01');
    await touch('Due date');
    expect(errorsUnder('Due date')).toEqual([BEFORE_START]);

    await typeDate('Due date', '');
    expect(errorsUnder('Due date')).toEqual([DUE_REQUIRED]);

    await typeDate('Due date', '2026-07-20');
    expect(errorsUnder('Due date')).toEqual([TOO_LONG]);
  });

  it('keeps the other required messages working', async () => {
    await touch('Item');
    await touch('Member');
    await typeDate('Start date', '');
    await touch('Start date');

    expect(errorsUnder('Item')).toEqual(['Choose an item.']);
    expect(errorsUnder('Member')).toEqual(['Choose a member.']);
    expect(errorsUnder('Start date')).toEqual(['Start date is required.']);
    expect(errorsUnder('Due date')).toEqual([]);
  });

  it('disables Create loan until all four fields are filled and the dates pass both rules', async () => {
    expect(createButton().disabled).toBe(true);

    await typeDate('Start date', '2026-06-01');
    await typeDate('Due date', '2026-06-15');
    expect(createButton().disabled).toBe(true);

    await chooseFirst('Item');
    expect(createButton().disabled).toBe(true);

    await chooseFirst('Member');
    expect(createButton().disabled).toBe(false);

    await typeDate('Due date', '2026-05-31');
    expect(createButton().disabled).toBe(true);

    await typeDate('Due date', '2026-06-30');
    expect(createButton().disabled).toBe(true);

    await typeDate('Due date', '2026-06-29');
    expect(createButton().disabled).toBe(false);

    await typeDate('Start date', '');
    expect(createButton().disabled).toBe(true);

    await typeDate('Start date', '2026-06-01');
    expect(createButton().disabled).toBe(false);

    await typeDate('Due date', '');
    expect(createButton().disabled).toBe(true);
  });

  it('makes the form invalid and sends nothing when submitted with a broken date rule', async () => {
    await fillAll('2026-06-10', '2026-06-09');
    expect(fixture.componentInstance.form.invalid).toBe(true);
    await submitForm();
    httpTesting.expectNone({ method: 'POST', url: '/api/loans' });

    await typeDate('Due date', '2026-07-09');
    expect(fixture.componentInstance.form.invalid).toBe(true);
    await submitForm();
    httpTesting.expectNone({ method: 'POST', url: '/api/loans' });

    await typeDate('Due date', '2026-07-08');
    expect(fixture.componentInstance.form.valid).toBe(true);
  });

  it('sends a valid loan as entered, even with a start date in the past, then goes back to the loans list', async () => {
    await fillAll('2025-06-01', '2025-06-29');
    expect(errorsUnder('Due date')).toEqual([]);
    expect(createButton().disabled).toBe(false);

    createButton().click();
    await settle();
    const req = httpTesting.expectOne({ method: 'POST', url: '/api/loans' });
    expect(req.request.body).toEqual({
      itemId: 2,
      memberId: 3,
      startDate: '2025-06-01',
      dueDate: '2025-06-29',
    });
    expect(createButton().disabled).toBe(true);

    req.flush(aLoan({ id: 50 }), { status: 201, statusText: 'Created' });
    await settle();
    expect(TestBed.inject(Router).url).toBe('/loans');
  });

  it('enables Create loan again when a save fails', async () => {
    await fillAll('2026-06-01', '2026-06-08');
    createButton().click();
    await settle();
    expect(createButton().disabled).toBe(true);

    httpTesting
      .expectOne({ method: 'POST', url: '/api/loans' })
      .flush(
        { title: 'Conflict', status: 409, detail: 'The item is already on loan.' },
        { status: 409, statusText: 'Conflict' },
      );
    await settle();

    expect(element.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'The item is already on loan.',
    );
    expect(createButton().disabled).toBe(false);
  });
});
