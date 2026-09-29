# Performance budgets

The release gates `SKILL.md` points here for. They hold for the web/PWA target - a Capacitor binary loads its bundle from disk and has no SEO, so in an Ionic app apply them only to the web build.

- Hold the initial bundle under 500 KB gzipped; lazy-load whatever would push past it.
- Encode the ceiling as `budgets` in `angular.json` so a regression fails the build rather than slipping through review.
- Clear Lighthouse 90+ on Performance, Accessibility, Best Practices, and SEO before any production release.
