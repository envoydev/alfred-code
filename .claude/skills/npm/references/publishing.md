# npm publishing - package shape, module format, releases

Loaded from the `npm` skill when authoring or releasing a library.

## The exports map - single source of truth

`exports` takes precedence over `main` and encapsulates the package: only listed paths are importable. Two load-bearing ordering rules (resolver stops at first match): **`types` first in every conditional block** - if `import`/`require`/`default` precede it, TypeScript never reaches the declaration file - and **`default` last**. Keep a top-level `types` for old tooling and the registry TS badge; export `./package.json` so tooling can read it; `sideEffects: false` when true, for tree-shaking; `module` is bundler legacy, redundant with exports.

ESM-only (the 2026 default for new packages):

```json
{
  "type": "module",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./package.json": "./package.json"
  }
}
```

Dual CJS/ESM (only when old-LTS consumers force it; separate `.d.mts`/`.d.cts` since TS 5.0):

```json
{
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.mts", "default": "./dist/index.mjs" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    },
    "./package.json": "./package.json"
  }
}
```

## ESM-only vs dual - the decision

Node 22+ can `require()` ESM synchronously, so CJS consumers use ESM-only packages without a separate build - ESM-only is the default. Dual-publish only to support Node 18/20 consumers or a genuinely mixed ecosystem; it buys the dual-package hazard and doubled build complexity. Build with tsup, unbuild, or pkgroll. **Validate the published shape in CI with `publint` and `@arethetypeswrong/cli`** - npm only checks that exports paths exist, not that they resolve correctly per consumer.

## Versioning and release automation

- **changesets** - the monorepo recommendation: contributors add a markdown changeset per PR (affected packages + bump type), a bot PR aggregates and publishes. Human-authored changelogs, versioning decoupled from commit style.
- **semantic-release** - fully automated off Conventional Commits; best for single packages with disciplined commit hygiene; changelogs read like commit dumps; monorepo support is unofficial plugins.
- release-please / release-it sit between. Whichever wins: publish from CI, never laptops.

## Publish safety

- `npm publish --dry-run` / `npm pack --dry-run` before every ship - inspect the exact tarball.
- Build steps go in `prepare`/`prepack` (they run on `npm pack` too, so the inspected tarball matches the published one); `prepublishOnly` is for publish-only final checks like tests - it does NOT run on pack.
- `--access public` for scoped public packages (via `publishConfig`); OIDC/`--provenance` per `references/supply-chain.md`; consider `--ignore-scripts` on publish; adopt staged publishing for the human 2FA gate.

## Deprecating beats unpublishing

Unpublish is tightly restricted: within 72h only if nothing depends on it; after 72h only with no dependents, <300 downloads/week, single maintainer. A `name@version` is burned forever once used; unpublishing all versions blocks the name for 24h. The working tool is `npm deprecate <pkg>@<range> "message"` - installs keep working, the warning shows at install time and on npmjs.com; un-deprecate with an empty message.
