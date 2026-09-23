import { Routes } from '@angular/router';

export const loansRoutes: Routes = [
  {
    path: '',
    title: 'Loans',
    loadComponent: () => import('./loan-list/loan-list').then((m) => m.LoanList),
  },
  {
    path: 'new',
    title: 'New loan',
    loadComponent: () => import('./loan-form/loan-form').then((m) => m.LoanForm),
  },
];
