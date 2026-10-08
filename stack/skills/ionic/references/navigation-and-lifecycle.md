# Ionic navigation and page lifecycle

The Ionic page-lifecycle hooks and the router-vs-NavController choice, for Angular 17+ standalone apps. Platform detection, deep-link routing, Capacitor listener lifecycle, and the NgZone boundary live in the parent `ionic` skill - this file is the in-app navigation layer only.

## Contents

- **The four page hooks** - `ionViewWillEnter` / `ionViewDidEnter` / `ionViewWillLeave` / `ionViewDidLeave` against the Angular init hooks, and why the DOM page cache splits them
- **Which hook owns which work** - the per-concern table (refresh-on-entry, heavy work, subscriptions, teardown)
- **NavController vs the Angular Router** - which one owns a navigation and how to force a stack direction
- **Tabs** - one shell route, a child route per tab

## The four page hooks

`<ion-router-outlet>` caches a page in the DOM after you navigate away so the back transition can animate the real element. That cache is why the Angular init hooks and the Ionic view hooks fire on different schedules - the Angular ones track component lifetime, the Ionic ones track visibility.

| Hook | Fires when |
|---|---|
| `ionViewWillEnter` | page is about to animate in - before the transition |
| `ionViewDidEnter` | page has finished animating in - after the transition |
| `ionViewWillLeave` | page is about to animate out |
| `ionViewDidLeave` | page has finished animating out |

These fire only on the component mapped directly to a route, never on its child components. Implement the optional interfaces from `@ionic/angular` for type-checking:

```typescript
import { Component, OnInit, OnDestroy } from '@angular/core';
import { ViewWillEnter, ViewDidEnter, ViewWillLeave } from '@ionic/angular';
import { IonHeader, IonToolbar, IonTitle, IonContent } from '@ionic/angular/standalone';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [IonHeader, IonToolbar, IonTitle, IonContent],
  templateUrl: './dashboard.page.html',
})
export class DashboardPage implements OnInit, OnDestroy, ViewWillEnter, ViewDidEnter {
  ngOnInit() { /* first-visit-only setup */ }
  ionViewWillEnter() { this.refresh(); }       // every visit, before the animation
  ionViewDidEnter() { this.startHeavyWork(); }  // every visit, after the animation
  ngOnDestroy() { /* runs only when the page is popped */ }
}
```

## Which hook owns which work

The trap: a cached page is re-shown without re-running `ngOnInit`, so per-visit logic placed there silently runs once and never again. Route the work by cadence:

| Work | Hook |
|---|---|
| one-time construction (build a form, wire a store) | `ngOnInit` |
| data that must be fresh on every entry (a tab re-show, a back navigation) | `ionViewWillEnter` |
| heavy work that would jank the transition (a chart, a large list) | `ionViewDidEnter` |
| pause a per-visit subscription or save a draft | `ionViewWillLeave` |
| final teardown (only fires on stack pop) | `ngOnDestroy` |

Pair a per-visit subscription with a leave/destroy split so it stops when the page is hidden but re-arms on return:

```typescript
readonly data = signal<FeedData | undefined>(undefined);
private leave$ = new Subject<void>();

ionViewWillEnter() {
  this.feed$.pipe(takeUntil(this.leave$)).subscribe((d) => this.data.set(d));
}
ionViewWillLeave() { this.leave$.next(); }  // unsubscribe on hide; re-subscribes next enter
```

## NavController vs the Angular Router

`NavController` is not the imperative `IonNav` push/pop stack - it is a thin wrapper over the Angular Router that carries an animation direction, so using it does not break the parent skill's 'pick the router and stay with it' rule. What it buys you over a bare `Router.navigateByUrl` is the native slide direction.

- Plain route change, no directional intent -> the Angular `Router`, or a template `routerLink`.
- A native-feeling stacked flow (list -> detail -> edit) where forward slides in from the right and back slides in from the left -> `NavController`, which sets the direction the router animation then uses.

```typescript
private nav = inject(NavController);

open(id: number) { this.nav.navigateForward(`/items/${id}`); } // push, forward slide
back() { this.nav.back(); }                                     // pop, back slide
home() { this.nav.navigateRoot('/home'); }                      // reset stack, no animation
```

Declaratively, set the direction on the link with `routerDirection` (`"forward"` | `"back"` | `"root"`):

```html
<ion-item routerLink="/items/42" routerDirection="forward" detail>
  <ion-label>Item 42</ion-label>
</ion-item>
```

Reserve `NavController.setDirection(...)` for the rare case where you must stamp the direction of the next router navigation from somewhere other than the navigating call itself.

## Tabs - one shell route, a child route per tab

Tabs are non-linear routing: each tab keeps its own navigation stack, so the back button pops within the active tab, not global history. Model it as a shell page with child routes; `<ion-tabs>` provides the nested outlet.

```typescript
// app.routes.ts
export const routes: Routes = [
  {
    path: 'tabs',
    loadComponent: () => import('./tabs/tabs.page').then(m => m.TabsPage),
    children: [
      { path: 'home', loadComponent: () => import('./home/home.page').then(m => m.HomePage) },
      { path: 'settings', loadComponent: () => import('./settings/settings.page').then(m => m.SettingsPage) },
      { path: '', redirectTo: 'home', pathMatch: 'full' },
    ],
  },
  { path: '', redirectTo: 'tabs/home', pathMatch: 'full' },
];
```

The shell template is `<ion-tabs>` wrapping the tab bar; each button's `tab` must equal the child route `path`:

```html
<ion-tabs>
  <ion-tab-bar slot="bottom">
    <ion-tab-button tab="home"><ion-icon name="home-outline" /><ion-label>Home</ion-label></ion-tab-button>
    <ion-tab-button tab="settings"><ion-icon name="settings-outline" /><ion-label>Settings</ion-label></ion-tab-button>
  </ion-tab-bar>
</ion-tabs>
```

Import `IonTabs`, `IonTabBar`, `IonTabButton`, `IonIcon`, `IonLabel` from `@ionic/angular/standalone` in the shell component. Two rules that keep the stacks independent: never navigate between tabs programmatically - the tab bar is the only switch - and to reach a view from more than one tab, present it as a modal rather than routing into another tab's stack.
