import { Component, inject } from '@angular/core';

import { ROLES, Role, Session } from '../session';

@Component({
  selector: 'app-role-switcher',
  templateUrl: './role-switcher.html',
  styleUrl: './role-switcher.css',
})
export class RoleSwitcher {
  protected readonly session = inject(Session);
  protected readonly roles = ROLES;

  protected setRole(event: Event): void {
    this.session.role.set((event.target as HTMLSelectElement).value as Role);
  }

  protected setUser(event: Event): void {
    this.session.user.set((event.target as HTMLInputElement).value.trim());
  }
}
