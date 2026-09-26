# Toolkits, UI frameworks under CSP, testing, CI

Loaded from the `browser-extension` skill when scaffolding, choosing tooling, or wiring tests and publishing.

## Toolkits - honest state (mid-2026)

| Tool | State | Pick it when |
|---|---|---|
| **WXT** (default) | Vite-based framework: file-based entrypoints, generated manifest, cross-browser builds (Chrome/Firefox/Safari/Edge, MV2+MV3), best HMR. Pre-1.0 but actively maintained and production-used | almost always - the only actively-maintained cross-browser-first option |
| CRXJS | a Vite *plugin*, minimal abstraction; nearly archived in 2025, revived - current releases with Vite 8 + MAIN-world HMR support | full Vite-config control, Chromium-only scope, no cross-browser need |
| Plasmo | stalled: CLI and sub-packages ~a year without releases, still self-described alpha, Parcel-based with dependency-vuln reports | never for new projects |
| raw Vite/esbuild | hand-rolled manifest, HMR, per-browser builds | very simple extensions or unusual constraints |

Scaffold: `npx wxt@latest init` with TypeScript. Types: `@types/chrome` or `chrome-types` (generated from Chromium source, more current) + the polyfill's or WXT's bundled types. Typed messaging helpers: `@webext-core/messaging` or WXT's own.

## UI frameworks vs the CSP eval wall

Extension pages run under a CSP that forbids `unsafe-eval` - anything compiling templates at runtime breaks:

- **Vue**: runtime-only build + precompiled SFCs (vue-loader). The full build's template compiler uses `new Function` - banned, and dead weight anyway.
- **Angular**: AOT only, never JIT. Works, but heavy for a popup - prefer Svelte/Solid/Preact for lightweight surfaces.
- **Svelte**: AOT by design, generally safe - verify the bundler/babel chain emits no `Function` constructors (known intermittent issue).
- **React**: fine (JSX precompiles); watch bundle size.
- Vue devtools and some HMR paths use eval and error under the CSP - dev-only noise, not a production problem.

## Testing

- **Unit**: Vitest (or Jest) with a mocked chrome API - `@webext-core/fake-browser`, jest-chrome, or sinon-chrome. The real lever is architectural: business logic in plain TS modules that never import `chrome.*` directly.
- **E2E**: Playwright, Chromium only, MV3 only, persistent context only:

  ```ts
  const context = await chromium.launchPersistentContext('', {
    args: [`--disable-extensions-except=${distDir}`, `--load-extension=${distDir}`],
  });
  ```

  Build to a stable dist folder first and pass an ABSOLUTE path; resolve the extension ID dynamically from the service-worker URL, never hardcode it; run headed or use the `chromium` channel for headless.

## CI publishing

Build → test → publish on semver tags. Let the toolkit drive the stores: `wxt submit init` captures the store credentials once (`.env.submit` locally, the same variables as CI secrets) and `wxt submit` pushes the Chrome, Firefox (with the sources zip) and Edge zips in one step. Chrome Web Store auth is a service account on the v2 API - the OAuth client-id/secret/refresh-token flow (v1, what the older community upload actions use) is retired from Oct 2026, so fetch the current auth setup via the documentation server rather than copying an old recipe; AMO via `web-ext sign` or the AMO API when not on `wxt submit`. Gotcha: a release created by `GITHUB_TOKEN` does not trigger downstream workflows - keep publishing in the same workflow as the release step.
