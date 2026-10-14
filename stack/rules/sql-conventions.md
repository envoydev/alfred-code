---
paths: ["**/*.sql", "**/Migrations/**/*.cs"]
---

Editing hand-written SQL or a schema migration - load `database-conventions`: the FIRST action after
this rule attaches is that Skill call, before the NEXT edit lands (a path-scoped rule attaches ON the
touch, so it can never precede its own trigger) - skip the load when it is already in context (some
seats preload it); conventions are the source of truth, not recall. Name the skill you loaded, or say
it was already in context - the receipt is what makes the load happen.

An EF migration (`Migrations/**/*.cs`) is schema work: the same first action adds the migration-safety
skill (rollback and verify per step) and the database engine's skill (index types, EXPLAIN, locking)
where installed - measured: a raw-SQL migration, an EXPLAIN test and an index decision ran with all
three installed and none loaded. Other ORM / EF query logic in a `.cs` file routes through the C#
baseline and the ORM / data-access skill instead. Skip one-line tweaks.
