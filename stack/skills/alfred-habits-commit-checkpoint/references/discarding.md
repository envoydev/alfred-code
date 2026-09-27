# Discarding uncommitted work

Read only after the catastrophic-rm guard blocked a discard and the user answered its ask.

## Discarding uncommitted work

The same receipt shape. `git checkout --` / `restore` / `reset --hard` / `clean -f` over a DIRTY
path is blocked, and the denial's three-option ask (keep, recommended / discard / narrow to one
file) is the user's to answer - never yours. Only after they answer 'Discard it', never
pre-emptively, write `<docs-path>/flow/DISCARD-ALLOW` - one path per line spelled exactly as the
blocked command spells them, or a single `*` for everything; this session's own, under 8h - and
then retry the SAME command.
