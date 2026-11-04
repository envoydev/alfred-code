import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header>
      <h1>Orders</h1>
      <nav><a routerLink="/orders">All orders</a></nav>
    </header>
    <main>
      <router-outlet />
    </main>
  `,
})
export class App {}
