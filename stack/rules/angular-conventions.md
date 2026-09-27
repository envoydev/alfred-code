---
paths: ["**/angular.json", "**/*.component.ts", "**/*.component.html", "**/*.service.ts", "**/*.directive.ts", "**/*.pipe.ts", "**/*.guard.ts", "**/*.resolver.ts", "**/*.module.ts", "**/*.routes.ts", "**/src/app/**/*.ts", "**/src/app/**/*.html", "**/src/lib/**/*.ts", "**/src/lib/**/*.html"]
---

Editing Angular / Ionic framework code - load `angular-conventions` (on top of the `typescript`
baseline): the FIRST action after this rule attaches is that Skill call, before the NEXT edit lands (a
path-scoped rule attaches ON the touch, so it can never precede its own trigger) - even when the touch
is incidental to the session's main thread (measured: with this rule and the TypeScript one both
attached, neither skill was loaded across 12 edits). Skip the load when it is already in context
(some seats preload it); conventions are the source of truth, not recall. Say which layers you
loaded, or that they were already in context - the receipt is what makes the load happen.

Covers components, services, directives, pipes, guards, resolvers, modules, routes, and templates -
an Ionic/Capacitor app shares the same conventions (a bespoke layout outside `src/app` / `src/lib`:
load the skill yourself). Skip one-line tweaks.

In an Ionic/Capacitor workspace (`ionic.config.json` / `capacitor.config.*` present) the
Ionic/Capacitor conventions skill - the one covering Ionic Angular UI, the Capacitor lifecycle and
plugins - loads in the SAME first action, not as an optional companion: it overrides where Ionic
diverges (shell change detection, zoneless, forms, transitions, refresh-on-entry); measured: one
session edited IonIcon components with `angular-conventions` loaded and the Ionic skill never loaded,
leaving the Ionic trap list unaudited. None installed in an Ionic workspace: the mobile stack is
missing from this install - say so in the close.

<!-- Maintainer note: the src/app / src/lib directory globs exist to catch the v20 suffix-less file names the type-suffix globs miss. -->
