import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  template: `
    <h1>Page not found</h1>
    <p class="muted">There is nothing at this address.</p>
    <a routerLink="/loans">Back to loans</a>
  `,
})
export class NotFound {}
