import { Routes } from '@angular/router';

export const itemsRoutes: Routes = [
  {
    path: '',
    title: 'Items',
    loadComponent: () => import('./item-list/item-list').then((m) => m.ItemList),
  },
  {
    path: 'new',
    title: 'New item',
    loadComponent: () => import('./item-form/item-form').then((m) => m.ItemForm),
  },
  {
    path: ':id/edit',
    title: 'Edit item',
    loadComponent: () => import('./item-form/item-form').then((m) => m.ItemForm),
  },
];
