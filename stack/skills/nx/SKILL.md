---
name: nx
description: Use when working in an Nx monorepo - an `nx.json` / `project.json` workspace, or `nx` commands - for the token-efficient way to navigate the project graph and scope work. Orient through the CLI's derived graph (`nx show projects`, `nx graph`, `nx show project`) rather than reading config, scope every build/test/lint to `nx affected` instead of the whole tree, scaffold with `nx generate`, and enforce module boundaries with tags. Nx answers project-graph and affected questions, serena answers symbol-level ones, and a framework's own conventions skill answers its code style - this is the workspace layer above them. Not for a monorepo without Nx (pnpm or npm workspaces, Turborepo).
---

# Nx Monorepo

Nx is the project-graph and task layer over an Angular (or mixed) monorepo. Use it the token-cheap
way: orient through the CLI's derived graph, and scope every task to the projects a change actually
touches - never dump the whole workspace or run every target.

## Navigate the project graph, do not read it
- Map the workspace through the CLI, not by opening config files: `nx show projects` lists every
  project; `nx show project <name> --json` gives one project's targets, tags, and dependencies;
  `nx graph` (interactive) or `nx graph --file=graph.json` is the dependency graph. Read these
  instead of opening a pile of `project.json` / `nx.json` files to reconstruct the structure by hand.
- Do not hand the whole graph dump into context to answer a narrow question - query the one project
  (`nx show project <name>`) or the affected set (below). The full graph is large; pull only the slice
  the task needs.
- What the cheap call buys, so you can decide before paying for it - `nx show project my-app --json`
  returns the resolved configuration under `project.data` plus a `sourceMap` saying which file or
  plugin contributed each key:

  ```json
  { "project": { "name": "my-app", "type": "app", "data": {
      "root": "apps/my-app", "sourceRoot": "apps/my-app/src", "projectType": "application",
      "tags": [], "metadata": { "technologies": ["react"] },
      "targets": { "build": { "executor": "nx:run-commands", "cache": true,
                              "dependsOn": ["^build"], "outputs": ["{projectRoot}/dist"] } } } },
    "sourceMap": { "targets.build": ["apps/my-app/vite.config.ts", "@nx/vite/plugin"] } }
  ```

  The `sourceMap` is the answer to 'where does this target come from' - read it instead of grepping
  for a config file that may not exist, because an inferred target has no `project.json` entry.

## Scope every gate with `nx affected`
- Run build, test, and lint over the affected set, not the whole tree: `nx affected -t build`,
  `nx affected -t test`, `nx affected -t lint`, against a base with `--base=main`. This is the biggest
  token and wall-clock win in a large monorepo - a change to one library tests only that library and
  its dependents, not every project.
- Verification and CI gate on `nx affected`, not `nx run-many` over everything. `nx affected --graph`
  shows exactly what a change touches before you run it.

## Serena vs Nx - route each question to the cheaper tool
Nx and serena do not overlap; they answer different questions at different altitudes. Route correctly
or you pay for the wrong tool:
- **Nx = project graph and task scoping** (macro): which projects exist, how they depend on each
  other, what is affected, what targets a project has. Use `nx show projects` / `nx graph` /
  `nx affected` - and only these - for those.
- **serena = code symbols** (micro): where a symbol is defined, who calls it, its type. Use
  `find_symbol` / `find_referencing_symbols`, which resolve across projects because Nx's `tsconfig`
  path mappings let the language server follow `@org/lib` imports.
- Never reach for the graph to find a caller (that is serena), and never grep code to compute the
  affected set (that is Nx). Nx knows implicit dependencies and the task pipeline no language server
  sees; serena knows symbol callers Nx has no concept of.

## Scaffold and enforce boundaries
- Generate with `nx generate` (`nx g @nx/angular:library`, `@nx/angular:component`, `@nx/js:lib`)
  rather than hand-authoring boilerplate - the generator wires `project.json`, the path mapping, and
  tags correctly and is far cheaper than emitting the files by hand.
- Enforce module boundaries with tags: set `tags` on each project and turn on the
  `@nx/enforce-module-boundaries` ESLint rule so a forbidden cross-project import fails lint - the
  boundary is a build-failing rule, not a convention.

## The CLI is the lever; the Nx MCP is optional
- Prefer teaching the CLI (this skill) over the Nx MCP server - `nx show` / `nx affected` output is
  leaner than large JSON payloads over MCP. If you do run the MCP, keep it in minimal mode
  (`--minimal` is the default and hides the workspace-analysis tools on purpose - do that analysis
  with the CLI above rather than passing `--no-minimal` to expose them) and prune tools with
  `--tools` globs so its schemas do not bloat every request; reserve it for Nx Cloud connectivity
  and running processes, not workspace analysis.
- `npx nx configure-ai-agents` lays down the agent config once - guideline files (`CLAUDE.md` / `AGENTS.md`), Nx's own agent skills and the Nx MCP entry - so keep the MCP minimal afterward.

## Keep the output quiet
- Nx output is context you pay for: run tasks with `--output-style=static` so the captured log is
  compact rather than a stream of live spinners, and window a failing task's log to the first real
  error, not the whole run. Reach for `--skip-nx-cache` only when a genuinely cold run is needed.
