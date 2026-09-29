#!/bin/bash
# The workspace: two Angular components whose templates force the date pipe to UTC.
set -e
mkdir -p src/app/orders src/app/invoices
cat > src/app/orders/orders.component.ts <<'TS'
import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [DatePipe],
  template: `<p>Placed {{ placedAt | date: 'short' : 'UTC' }}</p>`,
})
export class OrdersComponent {
  placedAt = new Date();
}
TS
cat > src/app/invoices/invoices.component.ts <<'TS'
import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';

@Component({
  selector: 'app-invoices',
  standalone: true,
  imports: [DatePipe],
  template: `<p>Issued {{ issuedAt | date: 'mediumDate' : 'UTC' }}</p>`,
})
export class InvoicesComponent {
  issuedAt = new Date();
}
TS
printf '{ "name": "demo", "dependencies": { "@angular/core": "^20.0.0", "@angular/common": "^20.0.0" } }\n' > package.json
