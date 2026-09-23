import { Routes } from '@angular/router';

export const membersRoutes: Routes = [
  {
    path: '',
    title: 'Members',
    loadComponent: () => import('./member-list/member-list').then((m) => m.MemberList),
  },
  {
    path: 'new',
    title: 'New member',
    loadComponent: () => import('./member-form/member-form').then((m) => m.MemberForm),
  },
  {
    path: ':id',
    title: 'Member',
    loadComponent: () => import('./member-detail/member-detail').then((m) => m.MemberDetail),
  },
  {
    path: ':id/edit',
    title: 'Edit member',
    loadComponent: () => import('./member-form/member-form').then((m) => m.MemberForm),
  },
];
