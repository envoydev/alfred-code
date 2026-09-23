import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { RoleSwitcher } from './core/role-switcher/role-switcher';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, RoleSwitcher],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly links = [
    { path: '/loans', label: 'Loans' },
    { path: '/members', label: 'Members' },
    { path: '/items', label: 'Items' },
    { path: '/reports', label: 'Reports' },
  ];
}
