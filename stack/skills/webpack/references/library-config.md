# The shared library-config factory

Loaded from the `webpack` skill when writing or restructuring configs. The factory beats raw webpack-merge because it encapsulates computed logic (externals from package.json, per-package paths) merge cannot express; merge stays the right tool for shallow dev/prod overlays inside one package - the factory can accept overrides and merge them internally.

## The factory (base package, consumed by every library)

```js
// packages/build-config/webpack.base.js
const path = require('node:path');
const { defineConfig } = require('webpack'); // 5.108+: identity fn, gives types in plain JS
const ForkTsCheckerPlugin = require('fork-ts-checker-webpack-plugin');

module.exports.createLibraryConfig = ({ packageDir, pkg }) => {
  const externals = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ].map((name) => new RegExp(`^${name}(/.*)?$`)); // the package AND its subpaths ('react/jsx-runtime')

  return defineConfig({
    mode: 'production',
    target: ['web', 'es2022'],
    entry: path.resolve(packageDir, 'src/index.ts'),
    experiments: { outputModule: true },
    output: {
      path: path.resolve(packageDir, 'dist/esm'),
      filename: 'index.js',
      library: { type: 'module' },
      clean: true,
    },
    externalsType: 'module', // 'commonjs' for a CJS build
    externals,
    devtool: 'source-map',
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'],
      extensionAlias: { '.js': ['.ts', '.tsx', '.js'], '.mjs': ['.mts', '.mjs'], '.cjs': ['.cts', '.cjs'] },
    },
    module: {
      rules: [
        { test: /\.[cm]?[jt]sx?$/, exclude: /node_modules/, loader: 'swc-loader',
          options: { jsc: { parser: { syntax: 'typescript', tsx: true }, target: 'es2022' }, module: { type: 'es6' } } },
        { test: /\.m?js$/, resolve: { fullySpecified: false } },
      ],
    },
    optimization: { usedExports: true, sideEffects: true, concatenateModules: true },
    cache: {
      type: 'filesystem',
      cacheDirectory: path.resolve(packageDir, 'node_modules/.cache/webpack'),
      buildDependencies: { config: [__filename] },
    },
    plugins: [new ForkTsCheckerPlugin({ async: false })],
  });
};
```

```js
// packages/some-lib/webpack.config.js
const { createLibraryConfig } = require('@myscope/build-config/webpack.base');
module.exports = createLibraryConfig({ packageDir: __dirname, pkg: require('./package.json') });
```

Config typing options: `defineConfig` (plain-JS autocomplete, runtime no-op - it validates nothing); JSDoc `@type {import('webpack').Configuration}` on older webpack; or `webpack.config.ts` - first-class since webpack-cli 7 via Node type-stripping, no ts-node. Environment handling: the `(env, argv) => defineConfig({...})` function form with `--env`; anything env-driven that changes output must fold into `cache.version` or the cache serves stale output.

## Output format decision

| `output.library.type` | State | Use |
|---|---|---|
| `'module'` (+ `experiments.outputModule`) | experimental - test the published tarball | the primary ESM build |
| `'commonjs2'` | rock solid | the fallback, and the CJS side of a dual build |
| `'modern-module'` | experimental | tree-shakeable ESM variant |
| `'umd'` | legacy | only for `<script>`/AMD consumers; no consumer tree-shaking |

Dual builds run as a multi-compiler array (two factory calls with a format override; no cache sharing between them). Whether to dual-publish at all, the exports-map conditions ordering, and the dual-package hazard belong to the npm packaging and publishing skill where the install has one - webpack only produces the files.

## Declarations

1. `tsc --emitDeclarationOnly --declaration --outDir dist/types` parallel to the bundle - the baseline, authoritative, plays with project references.
2. fork-ts-checker's `write-dts` mode when ts-loader runs `transpileOnly`.
3. Single-file `.d.ts` bundling (api-extractor, rollup-plugin-dts) as an orthogonal post-step.

## Version floor notes (verified mid-2026; re-check at adoption)

webpack 5.108.x / webpack-cli 7 / webpack-dev-middleware 8 (both Node >= 20.9); `tsconfig-paths-webpack-plugin` is obsolete (5.105+ resolves tsconfig `paths` natively); `experiments.topLevelAwait` stable since 5.83 and `experiments.layers` since 5.102 - drop those flags; webpack-cli 7 removed the programmatic API and renamed `--node-env` to `--config-node-env`.
