import { Routes } from '@angular/router';

import { OrderDetailComponent } from './orders/order-detail.component';
import { OrderListComponent } from './orders/order-list.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'orders' },
  { path: 'orders', component: OrderListComponent, title: 'Orders' },
  { path: 'orders/:id', component: OrderDetailComponent, title: 'Order' },
];
