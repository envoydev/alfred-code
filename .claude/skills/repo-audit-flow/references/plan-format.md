# The audit plan format

The planner writes `plan.md` in this shape; the editor applies it top to bottom. The plan is complete when a reader
who has never seen the audit could apply it with a text editor and nothing else.

## Layout

````markdown
# Audit plan - <kind> - <date>

Baseline: <git revision the targets were read at> - <date and time>

## Summary

| Item | Baseline | Edits | Expected |
|---|---|---|---|
| <item> | <grade> | E1, E2 | <grade> |

## Edits

### E1 - <path from the repo root>

- Item: <the skill, agent, rule or file this belongs to>
- Finding: <the id of the baseline finding it answers>
- Why: <one line>
- Kind: replace | insert-after | delete | new-file | move-file | delete-file
- Guard: <the rule or behaviour that must still be there after the edit, or 'none'>

Old:

```text
<the exact text now in the file, long enough to appear only once>
```

New:

```text
<the exact text that replaces it>
```

## Open questions

- Q1 - <the decision that is the user's>: <option A, the recommended one> / <option B> - <what each changes in this plan>

## Not planned

- <finding id> - <why it is left: a guard forbids it, it is the user's call, it belongs to another audit>

## Effects

- <what loads, attaches or costs differently once the edits land, and which repos take the change at the next sync>

## Depends on

- <what the checks need to run, and each fact the plan assumes without having verified it, with how to verify it>

## Checks

- <each command the editor runs after the last edit, with the output that means it passed>
````

## Rules for the sections around the edits

- `Baseline` is `git rev-parse --short HEAD` when the targets were read, with `dirty` added when one had uncommitted
  changes. The flow compares the targets against it before the grade and before the edit.
- `Effects` is what a session notices: a rule or skill that now loads or attaches where it did not, the always-on
  size before and after, a trigger that moved. `None beyond the edited files` is a valid answer when it is true.
- `Depends on` names what must hold for the plan to apply: a sibling checkout or a tool version a check needs, a
  claim about outside documentation that was not read. An assumption nobody can verify is an open question instead.
- A check's expected output names only what the edits change - never a count of unrelated lines, which is stale
  before the editor runs.

## Rules for every edit

- `Old` is copied from the file, never retyped, and appears exactly once in it. Where the text repeats, take more
  lines until it does not.
- `insert-after` gives `Old` as the anchor that stays and `New` as what follows it. `delete` gives `Old` only.
  `new-file` gives `New` only, as the whole file. `move-file` and `delete-file` give the paths and no text.
- Edits to one file are listed in the order they appear in it and never overlap. An edit that depends on another
  says so on a `Needs:` line.
- Nothing is left to the editor's judgment: no 'similar changes elsewhere', no 'as appropriate', no text described
  where it could be written.
- An outer fence is one backtick longer than any fence inside the text it holds.
