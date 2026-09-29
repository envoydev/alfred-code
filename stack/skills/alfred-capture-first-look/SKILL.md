---
name: alfred-capture-first-look
description: "Use when asked for a first look, quick orientation or starting map of a project with no architecture docs. Never over an existing capture."
---

# Project First Look - a provisional orientation from the manifests

One script run, one file. The scan reads the manifests (`*.csproj` and solutions, `package.json` with
`angular.json`, an extension `manifest.json`) and prints the whole `ORIENTATION.md`; this skill resolves
the script, runs it, checks the result and reports. There is no judgment to spend, so the skill carries
no model pin and no model check: the session's own model runs it, and the cheapest one is enough.

The file is provisional by construction. Its heading carries the marker 'provisional - replaced by the
architecture capture', the docs hook pushes it into every session and subagent with a stale warning
beside it, `docs.js status` and `docs.js stale` report it as stale by definition, and the architecture
capture overwrites it.

## When to use

- Writes a provisional ORIENTATION.md - stack, modules, build / test / run commands, entry points - from one deterministic scan of the project's manifests, so a project with no architecture capture yet starts its sessions with a map.
- Never over an existing capture, and not the architecture capture itself, which replaces this file.

## 1. Resolve the scan

The script ships in the stack's plugin cache, where several versions can sit side by side and the
NEWEST is the one this skill came from. From the project root:

```bash
SCAN=$(for d in "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/alfred-code/* "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/claude-stack/*; do   # legacy-name: a 1.x dir until orphaned
  f="$d/scripts/scan-evidence.js"
  [ -f "$f" ] && [ ! -e "$d/.orphaned_at" ] && printf '%s\t%s\n' "$(basename "$d")" "$f"
done 2>/dev/null | sort -V | tail -1 | cut -f2)
echo "scan: ${SCAN:-absent}"
```

Each Bash call is its own shell, so `$SCAN` is gone by the next call: step 2 pastes the path it printed
as `<scan>`. `scan: absent` means no plugin cache holds it (a copy-only install, or a harness without the stack's
plugin cache): say so and stop. Never hand-write the rows - that is the inference this skill exists to
replace.

## 2. Run it into the docs root

`<docs-path>` is this install's docs root (`baseline-docs-root.md` names it):

```bash
node "<scan>" --orientation --root . --out "<docs-path>/architecture/ORIENTATION.md"
```

- Exit 0: it printed `wrote <file> (<N> bytes):` and the document. That output IS the result - do not
  read the file back.
- `is not provisional` or `ARCHITECTURE.md exists`: the architecture capture already ran here. Nothing
  was written; report it and stop - refreshing a real map is the capture's job.
- `no manifest recognized`: nothing this scan reads is here (greenfield, or a stack it does not know).
  Nothing was written; report it.

## 3. Check, then report

Run `node .claude/hooks/docs.js lint` once. A `PROBLEM ORIENTATION.md ...` line (a path the file names
that does not exist) is reported as the scan's miss - never hand-edit the file to fix it; the next scan
or the capture rewrites it whole. Then report in at most five lines: the file and its size, the stack
row, the module count, the rows that came back `none declared`, and that the architecture capture
replaces this file.
