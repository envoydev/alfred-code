---
name: webpack
description: "Use when working on a webpack config, a library bundle, a slow or stale-cache build, or a tree-shaking or 'fully specified' failure. Not for Vite or Rollup."
---

# Webpack 5 - library builds that stay fast and correct

Webpack earns its keep where its loader/plugin ecosystem, Module Federation, or an existing monorepo standard demands it - for a pure library with no such constraint, a Rollup-class tool gives cleaner ESM+types output; say so rather than defaulting here. Once webpack is the tool, these are the rules. Whenever any `experiments.*` flag is on, tilde-pin the webpack minor you verified at use (`webpack@~5.<minor>`, tilde not caret - experimental flags carry relaxed semver), fetching the current minor through the documentation server or `npm view webpack version` rather than recall; 5.108 is only the floor for `defineConfig`. Pair it with webpack-cli 7 (Node >= 20.9, native TS configs, `--config-node-env`).

## When to use

Use when working on a webpack config, bundling a library, or debugging a tree-shaking, ESM-output or 'failed to resolve as fully specified' failure - also loader/plugin choices and slow webpack builds.

Webpack 5 build engineering with a library-in-monorepo focus (TS + JS): the transpile/type-check split, externals computed from package.json, the tree-shaking preconditions, ESM library output, the resolution traps, filesystem-cache pitfalls, the shared config-factory pattern, and how a library build is verified.

Not for Vite/Rollup projects, Angular CLI builds (the Angular framework-conventions skill), or package publishing mechanics (the npm packaging skill).

## The three correctness rules

- **Transpilation and type-checking are separate concerns.** The loader transpiles fast and single-file (swc-loader recommended - one rule covering `/\.[cm]?[jt]sx?$/` handles TS and JS uniformly); type safety comes from `fork-ts-checker-webpack-plugin` (async in dev, blocking in CI) and declarations from `tsc --emitDeclarationOnly` - webpack never emits `.d.ts`. Single-file transpilers make `isolatedModules` (or `verbatimModuleSyntax`, which implies it) mandatory.
- **A library never bundles its dependencies.** Externalize everything in `dependencies` + `peerDependencies`, computed from package.json (name + subpath regexes), never hand-listed. The failure mode is not bloat, it's breakage: a bundled React means two React copies in the consumer - `Invalid hook call`, broken context singletons. Node libraries also externalize built-ins (the `node` target does it automatically).
- **Tree shaking is a chain of preconditions - any broken link kills it silently**: production mode; ESM preserved end-to-end (Babel `modules: false`, tsconfig `module: esnext`/`preserve` - a transpiler emitting CommonJS is the classic silent killer); accurate `sideEffects` in package.json (list the CSS/polyfill/register files - `sideEffects` prunes whole subtrees and outworks statement-level `usedExports`); a barrel without `sideEffects: false` forces consumers to pull the whole surface. `stats.optimizationBailout` tells you *why* a module survived.

## The resolution traps (mixed TS/JS + ESM)

- `resolve.extensionAlias: { '.js': ['.ts', '.tsx', '.js'], ... }` - so NodeNext-style `import './foo.js'` resolves to `foo.ts` source.
- Strict-ESM files (`.mjs`, or `.js` under `"type": "module"`) demand fully-specified imports; extensionless ESM inside node_modules throws `failed to resolve ... fully specified`. Fix with a rule-scoped `{ test: /\.m?js$/, resolve: { fullySpecified: false } }` - it must sit under `module.rules[].resolve`, NOT top-level `resolve` (the wrong placement is why 'it does not work' reports exist).
- Keep `resolve.extensions` short and most-common-first; in a workspace monorepo prefer package-manager symlinks over `resolve.alias`-to-source, and leave `resolve.symlinks: true`.

## Output for libraries

- **ESM output is the primary target.** Default to `output.library.type: 'modern-module'` (webpack 5.93.0+, no `output.library.name`) for a library a bundler consumes - the output stays analysable, so the consumer's tree shaking still drops the exports it never imports; plain `'module'` only for a consumer that loads the file directly (browser `<script type=module>`, Node). Both need `output.module: true`. Before webpack 5.111 that also takes `experiments.outputModule: true` - an experiment, so the tilde pin above applies; from 5.111 the experiment is removed and `output.module` works alone. ESM externals and splitChunks still carry sharp edges, so the output is proven against real consumers (below) before it is trusted.
- **Fall back to `commonjs2`** (boring, solid) when consumers break on either module type - a working CJS publish beats an ESM one nobody can import.
- **A second CJS build** goes in a multi-compiler array only when a real CJS consumer exists - the exports-map shape and the dual-vs-ESM-only decision belong to the npm packaging and publishing skill, where the install has one.
- **Ship real source maps**: `devtool: 'source-map'`, or `hidden-source-map` where they exist only for error reporting.
- **Keep Terser for a published library** (best bytes); switch to `swcMinify` only when minification dominates CI time.

### Verify the library build

Webpack exiting 0 says nothing about what the consumer gets. In order, each step quoting its own output:

1. `npm pack` and list the tarball (`tar -tf`) - the built files and the `.d.ts` are in, sources and configs are out.
2. Install that tarball into a throwaway ESM consumer (`"type": "module"`) and import the package entry: it resolves and runs.
3. Install it into a real bundler consumer too (Vite or webpack) and build: the build is green and an unused export is ABSENT from the consumer bundle - where it survives, `stats.optimizationBailout` names why.
4. `tsc --noEmit` in that consumer against the published types - a `.d.ts` that only compiles inside the source tree is a broken publish.

## Structure and speed

One shared, typed config-factory package (`defineConfig` - a typing identity function, zero runtime behavior) that every package consumes - read `references/library-config.md` for the full factory example and the transpiler tradeoffs before writing that package. Instrument before optimizing - `--profile --json` into Statoscope or bundle-analyzer, a size budget failing CI; `references/caching-and-speed.md` carries the profiling toolbox and the cache-invalidation pitfalls (the `buildDependencies: { config: [__filename] }` rule, monorepo `managedPaths` exclusion for workspace packages, env vars folded into `cache.version`) - read it when a build is slow or a cache is serving stale output.
