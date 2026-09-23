import { TestBed } from '@angular/core/testing';

import { Session } from '../session';
import { RoleSwitcher } from './role-switcher';

describe('RoleSwitcher', () => {
  it('shows the session and writes changes back to it', async () => {
    const fixture = TestBed.createComponent(RoleSwitcher);
    const session = TestBed.inject(Session);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const select = element.querySelector('select') as HTMLSelectElement;
    const input = element.querySelector('input') as HTMLInputElement;

    expect(select.value).toBe('staff');
    expect(input.value).toBe('desk');

    select.value = 'member';
    select.dispatchEvent(new Event('change'));
    input.value = ' grace ';
    input.dispatchEvent(new Event('input'));

    expect(session.role()).toBe('member');
    expect(session.user()).toBe('grace');
  });
});
