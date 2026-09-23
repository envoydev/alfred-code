import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Loan } from '../../core/models';
import { aLoan, provideApiTesting } from '../../testing/fixtures';
import { CheckIn } from './check-in';

const ALREADY_RETURNED = 'This loan has already been returned.';

describe('Hidden.Web03 CheckIn page', () => {
  let httpTesting: HttpTestingController;
  let fixture: ComponentFixture<CheckIn>;
  let element: HTMLElement;

  const ladder = aLoan({
    id: 12,
    itemName: 'Folding ladder',
    memberName: 'Grace Hopper',
    startDate: '2026-09-01',
    dueDate: '2026-09-15',
    status: 'Active',
  });

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const text = (): string => (element.textContent ?? '').replace(/\s+/g, ' ');

  function numberField(): HTMLInputElement {
    const byAria = element.querySelector<HTMLInputElement>('input[aria-label="Loan number"]');
    if (byAria) {
      return byAria;
    }
    const label = Array.from(element.querySelectorAll('label')).find((l) =>
      (l.textContent ?? '').trim().startsWith('Loan number'),
    );
    if (!label) {
      throw new Error("No field labelled 'Loan number'");
    }
    const control =
      (label.htmlFor ? element.querySelector(`[id="${label.htmlFor}"]`) : null) ??
      label.querySelector('input');
    if (!control) {
      throw new Error("The 'Loan number' label names no input");
    }
    return control as HTMLInputElement;
  }

  function buttons(label: string): HTMLButtonElement[] {
    return Array.from(element.querySelectorAll('button')).filter(
      (b) => (b.textContent ?? '').trim() === label,
    );
  }

  function findButton(): HTMLButtonElement {
    const [found] = buttons('Find loan');
    if (!found) {
      throw new Error('No Find loan button');
    }
    return found;
  }

  const checkInButton = (): HTMLButtonElement | undefined => buttons('Check in')[0];

  function texts(selector: string): string[] {
    return Array.from(element.querySelectorAll(selector))
      .map((e) => (e.textContent ?? '').trim())
      .filter((t) => t.length > 0);
  }

  async function type(value: string): Promise<void> {
    const field = numberField();
    field.value = value;
    field.dispatchEvent(new Event('input'));
    field.dispatchEvent(new Event('change'));
    await settle();
  }

  async function find(value: string): Promise<void> {
    await type(value);
    findButton().click();
    await settle();
  }

  async function answerFind(id: number, loan: Loan): Promise<void> {
    httpTesting.expectOne({ method: 'GET', url: `/api/loans/${id}` }).flush(loan);
    await settle();
  }

  async function failFind(id: number, detail: string, status: number): Promise<void> {
    httpTesting
      .expectOne({ method: 'GET', url: `/api/loans/${id}` })
      .flush({ title: 'Error', status, detail }, { status, statusText: 'Error' });
    await settle();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), ...provideApiTesting()] });
    httpTesting = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(CheckIn);
    element = fixture.nativeElement as HTMLElement;
    await settle();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('has the Check in heading and a number field labelled Loan number', () => {
    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Check in');
    expect(numberField().type).toBe('number');
    expect(checkInButton()).toBeUndefined();
  });

  it('enables Find loan only while the field holds a whole number of 1 or more', async () => {
    expect(findButton().disabled).toBe(true);

    await type('0');
    expect(findButton().disabled).toBe(true);

    await type('-3');
    expect(findButton().disabled).toBe(true);

    await type('2.5');
    expect(findButton().disabled).toBe(true);

    await type('12');
    expect(findButton().disabled).toBe(false);

    await type('');
    expect(findButton().disabled).toBe(true);

    await type('1');
    expect(findButton().disabled).toBe(false);
  });

  it('finds a loan by number and shows its item, member, due date and status', async () => {
    await find('12');
    await answerFind(12, ladder);

    expect(text()).toContain('Folding ladder');
    expect(text()).toContain('Grace Hopper');
    expect(text()).toContain('2026-09-15');
    expect(text()).toContain('Active');
    expect(checkInButton()).toBeDefined();
    expect(text()).not.toContain(ALREADY_RETURNED);
  });

  it('checks an Active loan in, disabling the button while the request runs, then confirms', async () => {
    await find('12');
    await answerFind(12, ladder);

    expect(checkInButton()?.disabled).toBe(false);
    checkInButton()?.click();
    await settle();
    expect(checkInButton()?.disabled).toBe(true);

    httpTesting
      .expectOne({ method: 'POST', url: '/api/loans/12/return' })
      .flush({ ...ladder, status: 'Returned', returnedAt: '2026-09-14T10:00:00Z' });
    await settle();

    expect(checkInButton()).toBeUndefined();
    expect(text()).toContain('Returned');
    expect(text()).toContain('Folding ladder');
    expect(texts('[role="status"]')).toEqual(['Loan 12 checked in.']);
    expect(text()).not.toContain(ALREADY_RETURNED);
  });

  it('offers Check in for an Overdue loan', async () => {
    await find('13');
    await answerFind(13, aLoan({ id: 13, itemName: 'Pressure washer', status: 'Overdue' }));

    expect(text()).toContain('Overdue');
    expect(checkInButton()).toBeDefined();
  });

  it('says a Returned loan has already been returned and offers no button', async () => {
    await find('14');
    await answerFind(14, aLoan({ id: 14, status: 'Returned', returnedAt: '2026-09-10T12:00:00Z' }));

    expect(text()).toContain(ALREADY_RETURNED);
    expect(checkInButton()).toBeUndefined();
    expect(texts('[role="status"]')).toEqual([]);
  });

  it('shows an unknown loan number, a lost race and an unreachable server in the alert', async () => {
    await find('99');
    await failFind(99, 'Loan 99 was not found.', 404);
    expect(texts('[role="alert"]')).toEqual(['Loan 99 was not found.']);

    await find('12');
    await answerFind(12, ladder);
    checkInButton()?.click();
    await settle();
    httpTesting
      .expectOne({ method: 'POST', url: '/api/loans/12/return' })
      .flush(
        { title: 'Conflict', status: 409, detail: 'Loan 12 was checked in by someone else.' },
        { status: 409, statusText: 'Conflict' },
      );
    await settle();
    expect(texts('[role="alert"]')).toEqual(['Loan 12 was checked in by someone else.']);
    expect(texts('[role="status"]')).toEqual([]);

    await find('15');
    httpTesting
      .expectOne({ method: 'GET', url: '/api/loans/15' })
      .error(new ProgressEvent('error'));
    await settle();
    expect(texts('[role="alert"]')).toEqual(['The server could not be reached.']);
  });

  it('clears the previous loan, confirmation and error on each new Find loan', async () => {
    await find('12');
    await answerFind(12, ladder);
    checkInButton()?.click();
    await settle();
    httpTesting
      .expectOne({ method: 'POST', url: '/api/loans/12/return' })
      .flush({ ...ladder, status: 'Returned' });
    await settle();
    expect(texts('[role="status"]')).toEqual(['Loan 12 checked in.']);

    await find('13');
    expect(text()).not.toContain('Folding ladder');
    expect(texts('[role="status"]')).toEqual([]);
    await answerFind(13, aLoan({ id: 13, itemName: 'Pressure washer', status: 'Active' }));
    expect(text()).toContain('Pressure washer');
    expect(texts('[role="status"]')).toEqual([]);

    await find('99');
    expect(text()).not.toContain('Pressure washer');
    await failFind(99, 'Loan 99 was not found.', 404);
    expect(text()).not.toContain('Pressure washer');
    expect(texts('[role="alert"]')).toEqual(['Loan 99 was not found.']);

    await find('12');
    expect(texts('[role="alert"]')).toEqual([]);
    await answerFind(12, ladder);
    expect(texts('[role="alert"]')).toEqual([]);
    expect(text()).toContain('Folding ladder');
  });
});
