# Publishing - the `scope:` line and when the gate does not apply

Read when a publish's commit set touches more than one project, or the publish gate seems not to apply.
The plain push is SKILL.md's four steps alone.

## What the `scope:` line names

Name the whole workspace run (`nx affected`, a full suite) or every project the diff touches, never just
the one that was convenient to test - a narrow run passes both gates and leaves CI to find the rest. A
single-project or docs-only push, or a probe that genuinely ran nothing (`NOT RUN - <reason>`), needs no
`scope:` line. The guard asks for it only when the commit set spans more than one manifest-owning
directory, so an ordinary repo never sees the ask.

## When the gate does not apply

`guard-ungated-commit` enforces the publish half too. A push that publishes nothing - a dry run, or a branch
already level with its upstream - is never gated, and a repo whose remote is already gated by branch
protection or a required review turns the half off for good with `guard-ungated-commit:push` in `ALFRED_CODE_HOOKS_OFF` in the
settings.json env block.
