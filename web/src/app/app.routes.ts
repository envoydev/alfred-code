import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'loans' },
  {
    path: 'members',
    loadChildren: () => import('./members/members.routes').then((m) => m.membersRoutes),
  },
  {
    path: 'items',
    loadChildren: () => import('./items/items.routes').then((m) => m.itemsRoutes),
  },
  {
    path: 'loans',
    loadChildren: () => import('./loans/loans.routes').then((m) => m.loansRoutes),
  },
  {
    path: 'reports',
    title: 'Overdue report',
    loadComponent: () =>
      import('./reports/overdue-report/overdue-report').then((m) => m.OverdueReport),
  },
  {
    path: '**',
    title: 'Not found',
    loadComponent: () => import('./core/not-found/not-found').then((m) => m.NotFound),
  },
];
