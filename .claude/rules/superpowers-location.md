# Superpowers files live under docs

- Everything the superpowers skills write - specs, plans and the subagent-driven-development workspace (ledger, task briefs, reports) - goes under `docs/superpowers/` (`docs/superpowers/specs/`, `docs/superpowers/plans/`, `docs/superpowers/sdd/`), never a `.superpowers/` folder at the repo root.
- The folder is git-ignored and machine-local; nothing in it is committed or shipped.
- When a skill or an agent brief names a default path outside `docs/superpowers/`, use the `docs/superpowers/` equivalent instead.
