# Full spec - the check script's lookup

Read first, on every size, to run the full-spec check - its `size floor:` line is the lowest size the
`Size:` line may state, and on `standard` its `spec:` and `path:` lines decide the merged path. The lookup reads this skill's own
copy of the script (`scripts/spec-check.js`): the project copy first, else the newest plugin-cache
entry that has it. The block prints nothing but the check's lines - one per item, the path last:

```bash
SPEC=.claude/skills/task-solve/scripts/spec-check.js
[ -f "$SPEC" ] || SPEC=$(for d in "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/alfred-code/*; do
  f="$d/stack/skills/task-solve/scripts/spec-check.js"
  [ -f "$f" ] && [ ! -e "$d/.orphaned_at" ] && printf '%s\t%s\n' "$(basename "$d")" "$f"
done 2>/dev/null | sort -V | tail -1 | cut -f2)
if [ -n "$SPEC" ]; then node "$SPEC" <<'REQUEST'
<the user's request, verbatim>
REQUEST
else echo 'path: gated - spec-check not found'; fi
```

A script neither home has prints `path: gated`: keep every gate.

## The size re-check - before a trivial or small close

Before a trivial or small run's close stop, run the same script from the project root as
`node "$SPEC" --touched <trivial|small>` - the lookup block above with its heredoc call swapped for that
line. It prints ONE `size check:` line: the files the run touched (the tracked diff plus new files, minus
the stack's data root, `.claude/` and what was untracked when the change began) against the row's cap, and the
close's `Progress:` line quotes it. On `raise to standard` the size rises where the run stands - write
the plan file with the work done as ticked tasks, then take standard's step-4 stop (the reviewer ask),
step 5 and step 6; the small row's close is gone.

## The merged path

On `path: merged`, steps 1 and 2 are ONE step: the design and the plan audit both in this session
(neither twin asks its mode), no stop between them. A gap the audit finds that the spec settles is
fixed in the plan in the same step and named in the ask; a gap only the user can settle stamps the
gaps and takes step 2's stop. The approval ask that ends the step is `SKILL.md`'s.
