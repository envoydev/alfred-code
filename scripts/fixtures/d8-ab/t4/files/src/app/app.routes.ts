import { Routes } from '@angular/router';

import { OrderDetailComponent } from './orders/order-detail.component';
import { OrderListComponent } from './orders/order-list.component';
import { ReportTableComponent } from './reports/report-table.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'orders' },
  { path: 'orders', component: OrderListComponent, title: 'Orders' },
  { path: 'orders/:id', component: OrderDetailComponent, title: 'Order' },
  { path: 'reports', component: ReportTableComponent, title: 'Sales report' },
];
