import { Injectable, signal } from '@angular/core';

export type Role = 'member' | 'staff' | 'admin';

export const ROLES: readonly Role[] = ['member', 'staff', 'admin'];

/** Who the desk is acting as. Sent with every API request by the demo headers interceptor. */
@Injectable({ providedIn: 'root' })
export class Session {
  readonly user = signal('desk');
  readonly role = signal<Role>('staff');
}
