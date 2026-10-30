---
paths: ["**/*.component.scss", "**/*.component.css", "**/src/styles.scss", "**/src/styles.css", "**/src/global.scss", "**/src/theme/**/*.scss", "**/src/app/**/*.scss", "**/src/app/**/*.css", "**/src/lib/**/*.scss", "**/src/lib/**/*.css"]
---

Editing stylesheets in an Angular / Ionic workspace - load `angular-styling`: the FIRST action after this rule attaches is that Skill call, before the NEXT edit lands (a path-scoped rule attaches ON the touch, so it can never precede its own trigger) - skip the load when it is already in context (some seats preload it);
conventions are the source of truth, not recall. Name the skill you loaded, or say it was already
in context - the receipt is what makes the load happen. A compaction ends the already-in-context skip - a loaded skill outlives one only within a shared budget. Governs `.scss`/`.css` component-scoped styling,
Material or not. Skip one-line tweaks.
