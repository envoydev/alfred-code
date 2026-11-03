---
paths: ["**/angular.json", "**/*.component.ts", "**/*.component.html", "**/*.spec.ts", "**/*.component.scss", "**/*.component.css", "**/src/styles.scss", "**/src/styles.css", "**/src/global.scss", "**/src/theme/**/*.scss", "**/src/app/**/*.ts", "**/src/app/**/*.html", "**/src/app/**/*.scss", "**/src/app/**/*.css", "**/src/lib/**/*.ts", "**/src/lib/**/*.html", "**/src/lib/**/*.scss", "**/src/lib/**/*.css"]
---

<!-- The styling globs are load-bearing, not over-breadth: a Sass compile error IS an ng build
     failure, and styles.scss / theme files are build inputs. Fires on green edits by design -
     build state has no glob; this soft router replaced the retired hard gate. The resolver ask,
     the contract stop, the status-less return and the seat boundary live in habits-root-cause's
     broken-build section, loaded on every red build (audit 2026-10-30 RU-08); the seat names stay
     here because the graph's rule -> seat edge is what installs them. -->

A broken Angular build or red spec suite (Ionic/Capacitor included - ionic build wraps ng build) is routed by the `habits-root-cause` skill's broken-build section, loaded first: here the build goes to `ng-build-error-resolver` and, once it is green, the specs to `angular-test-resolver` - dispatch each exactly as the roster spells it.
