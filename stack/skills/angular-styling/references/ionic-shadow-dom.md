# Ionic surfaces are real shadow DOM

`ion-*` components are web components with genuine shadow DOM, not Angular's emulated encapsulation, so on them the ways out of `SKILL.md`'s ::ng-deep section invert:

- Way out #2 - a global rule targeting a class inside the component - **silently does nothing**: real shadow DOM blocks inbound global styles, and nothing errors. Style an Ionic component only through what it publishes: its CSS custom properties (per-component ones like `--background`, and the `--ion-*` theme variables) and its `::part()` selectors - both cross the shadow boundary by design. Which parts and variables a component exposes is its Ionic docs page; fetch it live rather than guessing.
- Keep the app's own token system for your own components, but know that `ion-*` components read only Ionic's variables - route theme values into `--ion-*` tokens or they never reach the UI kit. Dark mode on Ionic surfaces is the Ionic dark palette and its ion-palette-dark class strategy, owned by the skill covering the Ionic/Capacitor layer - not a hand-rolled `[data-theme]` re-bind, and with no such skill installed use the Ionic palette class rather than inventing a parallel theme.
