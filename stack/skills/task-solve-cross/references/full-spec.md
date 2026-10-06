# Full spec - the check script's lookup

Read on the single-chat path, when the mode answer builds in this session, before designing. This
skill carries its own copy of the full-spec check (`scripts/spec-check.js`, byte-identical to the
single-chat solve flow's), so the lookup never reads another skill's folder: the project copy first,
else the newest plugin-cache entry that has it. The block prints nothing but the check's lines - one
per item, the path last:

```bash
SPEC=.claude/skills/task-solve-cross/scripts/spec-check.js
[ -f "$SPEC" ] || SPEC=$(for d in "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/alfred-code/*; do
  f="$d/stack/skills/task-solve-cross/scripts/spec-check.js"
  [ -f "$f" ] && [ ! -e "$d/.orphaned_at" ] && printf '%s\t%s\n' "$(basename "$d")" "$f"
done 2>/dev/null | sort -V | tail -1 | cut -f2)
if [ -n "$SPEC" ]; then node "$SPEC" <<'REQUEST'
<the user's request, verbatim>
REQUEST
else echo 'path: gated - spec-check not found'; fi
```

A script neither home has prints `path: gated`: keep every gate.
