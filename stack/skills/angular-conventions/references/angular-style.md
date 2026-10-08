# Angular style: file naming, enforceable config, and modern-vs-legacy examples

The concrete, enforceable slice of the Angular conventions: the v20+ file-naming rules, the angular-eslint + Prettier flat config that enforces them, and modern-vs-legacy examples. The broad conventions - signals, control flow, DI, state tiers, SSR, forms, a11y, testing - live in `SKILL.md`; the per-version stable/experimental deltas live in `references/v19.md`-`v22.md`. This document is the enforcement layer. A project's own config (its `eslint.config.js`, `angular.json`, `.prettierrc`, `.editorconfig`) and its `<docs-path>/code-style/CODE-STYLE.md` are HIGHER priority - where a project diverges, follow the project.

## Contents

- File and folder naming (v20+ style guide - the house convention)
- Enforceable config (angular-eslint flat config + typescript-eslint + Prettier)
- Modern vs legacy examples

## File and folder naming (v20+ style guide - the house convention)

The house follows the v20 official style guide: **drop the `.component`/`.service`/`.directive`/`.pipe` type suffixes.** A `UserProfile` component lives in `user-profile.ts` (class `UserProfile`), with `user-profile.html` and `user-profile.css` sharing the base name. From Angular v20 the CLI generates no suffix for components, directives, services, and pipes by default.

- Pipes, guards, resolvers, interceptors, and modules keep a role word on the class name, but the file uses a hyphen, not a dot: `auth-guard.ts` (not `auth.guard.ts`), class `AuthGuard`.
- Separate words in filenames with hyphens; match the filename to the primary TypeScript identifier inside it.
- Avoid generic names like `helpers.ts`, `utils.ts`, `common.ts`.
- Unit tests live beside the code under test, named `*.spec.ts`.
- Services favor role-based names: `user-api.ts`, `auth-store.ts`, `products-data.ts`.

Version note: v19 and earlier used the classic suffix convention (`user-profile.component.ts`, class `UserProfileComponent`); a workspace still on v19 keeps it. For an existing project, `ng update` preserves suffix generation by updating `angular.json`, so migrating is opt-in, not forced - let it be organic and keep it consistent per feature rather than mass-renaming.

Project structure (all versions): all UI under `src/`, bootstrap in `src/main.ts`; organize by feature area, not by file type (no top-level `components/`/`services/` folders); group a component's files in one directory, one concept per file. A common scalable layout is `src/app/core/` (app-wide non-business), `src/app/features/` (business features), `src/app/shared/` (dumb reusable components, pipes, utils).

## Enforceable config (angular-eslint flat config + typescript-eslint + Prettier)

Use the ESLint flat config (`eslint.config.js`, ESLint v9+). Combine @eslint/js, typescript-eslint, angular-eslint, and eslint-config-prettier. Enforce the selector prefixes and the useful Angular rules:

```js
// eslint.config.js
// @ts-check
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');
const eslintConfigPrettier = require('eslint-config-prettier');

module.exports = tseslint.config(
  { ignores: ['.angular/**', 'coverage/**', 'dist/**'] },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...tseslint.configs.stylistic,
      ...angular.configs.tsRecommended,
      eslintConfigPrettier,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
      '@angular-eslint/prefer-on-push-component-change-detection': 'warn',
      '@angular-eslint/prefer-output-readonly': 'warn',
      '@angular-eslint/no-empty-lifecycle-method': 'warn',
    },
  },
  {
    files: ['**/*.html'],
    extends: [
      ...angular.configs.templateRecommended,
      ...angular.configs.templateAccessibility,
    ],
    rules: {},
  },
);
```

- Run `ng lint` and `prettier --check` in CI to block non-conforming PRs. A typical `.prettierrc`: `singleQuote: true`, `printWidth` to team taste.
- eslint-config-prettier must come last so it disables ESLint formatting rules that conflict with Prettier. Prettier owns formatting; ESLint owns correctness and Angular-specific rules.

## Modern vs legacy examples

Modern (v19+ - signal APIs, `inject()`, OnPush, native control flow, no type suffix):
```ts
@Component({
  selector: 'app-user-profile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p>{{ fullName() }}</p>`,
})
export class UserProfile {
  private readonly users = inject(UserApi);
  readonly userId = input.required<string>();
  protected readonly fullName = computed(() => this.users.name(this.userId()));
}
```

Legacy (pre-v17 patterns to avoid in new code - decorator inputs, `*ngIf`, mutable field, type suffix):
```ts
@Component({
  selector: 'app-user-profile',
  template: `<p *ngIf="fullName">{{ fullName }}</p>`,
})
export class UserProfileComponent implements OnInit {
  @Input() userId!: string;
  fullName = '';
  constructor(private users: UserService) {}
  ngOnInit() { this.fullName = this.users.name(this.userId); }
}
```

The modern form: signal input (`input.required`), `inject()` for DI, `protected readonly` for a template-only member, a `computed()` instead of a lifecycle-populated field, OnPush change detection, and the drop-suffix class name (`UserProfile`, not `UserProfileComponent`).
