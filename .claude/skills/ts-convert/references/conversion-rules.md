# TypeScript conversion - how one file is converted

Read by the converter before its batch, and by the planner where it classes a construct. Contents: a converted
file - imports and exports - the CommonJS constructs - types - tests - a `check` file - what a conversion never
does. Each rule that rests on a runtime or compiler fact names its row in `currency.md`.

## A converted file

- The same file under a new name: renamed with `git mv`, so its history is kept. `.ts` in a package whose `type`
  is `module`, `.mts` in any other (row 'module system by extension'). A `.jsx` file becomes `.tsx` only where the
  package's own build or host reads TSX - Node does not run `.tsx` - and is an open question anywhere else.
- An ES module: `import` and `export`, no `require`, no `module.exports`, and no `'use strict'` line, which an ES
  module does not need. A shebang line stays the first line.
- Erasable syntax only (row 'erasable syntax'): no `enum`, no `namespace` that holds code, no parameter property,
  no `import x = require()`, no `<T>value` assertion. A closed set is a frozen object or a union of literals.
- It does what the JavaScript did: the same exports under the same names, the same order of side effects at the
  top level, the same messages, exit codes and files written.

## Imports and exports

- A relative specifier names the file as it is on disk once this batch is done, with its extension
  (row 'import extensions'): `./x.ts` or `./x.mts` for a converted file, `./x.js` for one that stays. A folder
  import is written out to its file (`./x/index.js`). In a package whose `tsconfig` resolves as `bundler` and whose map says
  an import names its file with no extension, the `structure_map` wins.
- A built-in or a package specifier is kept as written.
- Every importer of a converted file is edited in the same batch to its new name - TypeScript and JavaScript
  importers alike, tests included. The batch's section of `convert.md` lists them with their lines.
- A type is imported with `import type`, or with the `type` keyword on the name (row 'type-only imports').
- A CommonJS file that stays is imported by its default, which is its `module.exports` whatever its shape, and
  destructured: `import lib from './lib.js'; const { parse } = lib;`.
- A converted file a CommonJS file requires holds no top-level `await` (row 'require of an ES module').

## The CommonJS constructs

| Construct | ES module form | The check that the behaviour held |
|---|---|---|
| `const x = require('<built-in or package>')` | `import x from '<same specifier>'`, or the named imports the code uses | the typecheck |
| `const { a } = require('./y')`, `y` converted in this or an earlier batch | `import { a } from './y.mts'` (or `.ts`) | the typecheck and `y`'s tests |
| `require('./y')`, `y` staying CommonJS | the default import and a destructure, as above | the typecheck and the batch's tests |
| `module.exports = { a, b }` and `exports.a = ...` | named exports: `export function a`, `export const b` | each caller's test; a CommonJS caller's `const { a } = require('./x.mts')` reads the same names |
| `module.exports = <one value>` | `export default <value>`; each CommonJS caller's `require('./x.js')` becomes `require('./x.mts').default`, each ES caller imports the default | the caller's test reads the export's shape |
| `__dirname`, `__filename` | `import.meta.dirname`, `import.meta.filename` (row 'import.meta.dirname') | the file's own test |
| `require.main === module` | where the row 'import.meta.main' allows it for this package, `import.meta.main`; anywhere else `process.argv[1] !== undefined && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === import.meta.filename`, with both from `node:fs` - `existsSync` first, since `realpathSync` throws where the process's own entry was named without its extension and this module is only imported | the entry's own test. An entry with no test is converted all the same and reported as 'entry not covered' |
| `require('./data.json')` at the top level | `import data from './data.json' with { type: 'json' }` (row 'JSON import') | the typecheck and the file's test |
| `require('./data.json')` inside a function | a read at that point: `JSON.parse(readFileSync(new URL('./data.json', import.meta.url), 'utf8'))` | the file's test |
| a `require` inside a function or a branch | `await import()` where the function is already async, or every caller can wait - the plan says which; otherwise the file is reason (c) | the batch's tests |
| `require(path.join(__dirname, ...))`, or any `require(` whose argument is not a string literal | a constant path: a static `import` of the file it resolves to, with that file's name after this batch; a computed one: `createRequire(import.meta.url)` from `node:module`, its path built with `import.meta.dirname` in place of `__dirname`. A target the conversion renames is a line of the batch's 'References to update' | the typecheck and the file's test |
| `require.resolve('<specifier>')` | `createRequire(import.meta.url).resolve('<specifier>')`, with `createRequire` from `node:module` | the file's test |
| a test that replaces an export of a module (`lib.read = stub`) | an ES module's exports cannot be replaced. Where only the subject's test changes, the subject takes the dependency as an argument with the real one as its default; otherwise the subject is reason (c), with a `solve-task` hand-off | the test, passing with the dependency passed in |
| `require.cache`, `require.extensions`, `module` used as a value (`module.id`, `module.paths`), an export added or changed after load | none that keeps the behaviour: reason (c) | - |

The plan lists, per file, which of these it holds and at which lines. A construct the table does not name stops
the batch: report it, do not invent a form.

## Types

- Annotate what the compiler cannot infer: the parameters and the return type of every exported function, an
  empty array or object that is filled later, a value read from outside.
- A value whose shape is not known is `unknown`, narrowed before use. Never `any`, never a non-null assertion,
  never `@ts-ignore`. A `@ts-expect-error` carries its reason on the same line and is listed in the report.
- A JSDoc type that the annotation now states is removed from the comment; the sentence that says what the
  function is for stays. Comments are otherwise left as they are.
- No strictness key is removed or loosened in a `tsconfig`, and no error is silenced by excluding a file.

## Tests

- A file's tests convert with it, in the same batch, by the same rules.
- The test runner's own imports and the shape of the tests do not change: no test is deleted, skipped, merged or
  weakened, and the count of tests run is the same before and after.
- A test that reads another file as data reads it under its new name where that file was converted.

## A `check` file

- `// @ts-check` goes on the first line, after a shebang where there is one, and before `'use strict'`.
- Types are JSDoc: `@param`, `@returns`, `@type`, `@typedef`. No code changes, apart from a narrowing check the
  types need that cannot alter what the code does for any input it already accepted.
- A `check` file for reason (a) or (b) keeps every relative `require` and `import` on a path ending in `.js`,
  `.cjs`, `.mjs` or `.json`, and every path it builds - a segment list, a command string - off `.ts`, `.mts` and
  `.cts`.
- An error JSDoc cannot remove without changing the code gets `// @ts-expect-error - <the reason, and the change
  that would remove it>` on the line above, and is listed in the report as a finding for the audit.

## What a conversion never does

- Change behaviour: no reordering, no renamed export, no added validation, no fix. A defect met on the way is
  written in the report under 'Findings for the audit'.
- Run `node --check` on a converted file (row '--check'), import a file to see whether it loads, or run an entry.
- Touch a `leave` file, a file outside the batch's list, `engines`, or a strictness key.
- Convert a file to `.cts`.
