---
name: alfred-capture-project-capabilities
description: "Use when asked to capture the project capabilities or run book - how to build, start and log in to the app. Manual, /-only. Not for the tools inventory."
disable-model-invocation: true
---

# Project Capabilities - the run book an agent reads before it runs the app

A change is proven twice: by its tests, and by running the app and exercising what changed. The second
half fails on facts no code states - the command that starts the app, the URL it answers on, the test
account, the service that must be up first, the flow that proves the change. This capture records them
once, so every seat that builds, starts, logs into or hand-checks the app reads them instead of
guessing. Two artifacts come out:

1. `<docs-path>/project-capabilities/PROJECT-CAPABILITIES.md` - the run book, a docs domain with its own
   `watch.json`. `references/doc-shape.md` is its shape and write protocol.
2. `.claude/rules/baseline-project-run-book.md` - the generated pathless pointer rule, from
   `references/run-book-rule.template.md`.

The repo answers first; the user fills only what the repo cannot show. There is no judgment to spend
beyond that, so the skill carries no model pin: the session's own model runs it.

## When to use

- The deliberate run-book capture: how to build, start, reach and log in to the app, the flows and edge cases a manual check exercises, the debug entry points - so an agent can run the app and hand-verify a change. Re-run to refresh.
- It reads the repo first, asks only for the gaps, and writes `project-capabilities/PROJECT-CAPABILITIES.md` under the docs root plus the generated pointer rule `baseline-project-run-book.md`; a credential is recorded by where it lives, never by value.
- Not the installed-tools inventory (the agent-capabilities capture), the architecture map or the code style.

## Credentials - the hard rule

Never ask for a credential's VALUE, and the doc never holds one - not in an ask, not in the doc, not in
the report. The doc records the login steps and WHERE it lives - an environment variable, a key in a gitignored local file, a vault item - and the user puts the value there by hand. A value the user pastes anyway is never written anywhere: redact it as `<redacted>`, record only where it should live, and follow the security baseline's credential rule (the rotation ask). A seat that needs the value to log in checks the file for presence (the secret guard's `--presence`) and goes through that guard's one ask before it types it.

## Execution modes

- **FIRST capture** (no doc, or no `Captured:` stamp) - the whole run below, no write gate: there is
  nothing to replace.
- **UPDATE** (doc and stamp exist) - put the write gate first, then the whole run: DISCOVER again, and
  ASK only the questions whose section still says `unknown` or cites a file that changed since the
  stamp (`git diff --name-only <stamp-sha>..HEAD`). An answer the user gave before stands unless the
  repo now contradicts it or the user changes it.

  ```ask
  The run book exists (captured <branch>@<sha>, <date>). Refresh it: the repo is re-read and only the open gaps and what moved are asked.
  - 'Refresh the run book (Recommended)' - every earlier answer the repo does not contradict is kept
  - 'Stop here - report the drift only' - nothing is written
  ```

  No answer, no write - never fall through to the rewrite.

## The run

### 1. DISCOVER - the repo answers first

Read, never guess. Every read is bounded - a `grep -n` to the lines, then a ranged read - and every fact
keeps the file it came from: that list becomes the sections' `covers:` lines and the `watch.json`.

1. **Build, test, run.** The first-look scan prints them from the manifests. Resolve it from the stack's
   plugin cache, NEWEST version first, and run it with no `--out` - it prints and writes nothing:

   ```bash
   SCAN=$(for d in "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/alfred-code/*; do
     f="$d/scripts/scan-evidence.js"
     [ -f "$f" ] && [ ! -e "$d/.orphaned_at" ] && printf '%s\t%s\n' "$(basename "$d")" "$f"
   done 2>/dev/null | sort -V | tail -1 | cut -f2)
   echo "scan: ${SCAN:-absent}"
   [ -n "$SCAN" ] && node "$SCAN" --orientation --root .
   ```

   `scan: absent` or `no manifest recognized`: read `package.json` scripts, `*.sln` / `*.csproj` and the
   `Makefile` targets by hand instead.
2. **Start and reach.** `**/Properties/launchSettings.json` (profile names, `applicationUrl`, and the
   NAMES of its environment variables), compose files (services, published ports), a `Procfile`,
   `.vscode/launch.json` configuration names.
3. **Before you run.** An `.env.example` / `.env.sample` / `.env.template` - key NAMES only
   (`cut -d= -f1`), never a real `.env`; the services the app depends on; the migration or seed command
   the scripts name.
4. **The prose.** `README.md`, `CLAUDE.md` and `.claude/CLAUDE.md` headings about setup, running, login,
   debugging and testing (`grep -niE '^#+ .*(setup|install|run|start|login|sign in|debug|test)'`), then a
   ranged read of each hit section.
5. **Flows.** End-to-end spec titles (Playwright or Cypress `describe` / `test` names) - a flow a test
   already drives is a flow a manual check exercises.

### 2. ASK - only the gaps, in ONE AskUserQuestion

One question per gap below, all in the same AskUserQuestion call (at most four). A question whose whole
answer DISCOVER settled is not asked - its facts go straight into the doc. Each question states what the
repo showed ('nothing' when it showed nothing), and the fuller answer arrives as typed text via Other:

```ask
How is the app started and reached for a manual check? The repo shows: <start commands, URLs, launch profiles - or nothing>. Type a correction or the missing part via Other.
- 'As the repo shows (Recommended)' - the Start and Reach lines are written from <files>, each cited
- 'Unknown for now' - the missing part says unknown; the next capture asks again
```

```ask
How does an agent log in? The repo shows: <a login route, an auth config - or no login>. Never type a password here - via Other, type the login steps, the account's role and WHERE its credentials already live (an env var, a file and key, a vault item).
- 'A test account - create the credentials template for me to fill (Recommended)' - an empty `credentials.local.env`, gitignored; the doc points at it
- 'No login - the app is open' - the section says so
- 'Unknown for now' - the section says unknown; the next capture asks again
```

```ask
Which flows prove a change works, and which edge cases break? The repo shows: <e2e spec titles, README usage sections - or nothing>. Type flows (steps, then the expected result) and edge cases via Other.
- 'The flows the repo names (Recommended)' - each spec or README flow becomes a numbered flow, cited
- 'Unknown for now' - both sections say unknown; the next capture asks again
```

```ask
What must be up or known before a run, and where does debugging start? The repo shows: <services, env var names, seed commands, launch configs - or nothing>. Type anything a first run trips on via Other (a VPN, a busy port, a feature flag, where the logs go).
- 'As the repo shows (Recommended)' - both sections are written from <files>, each cited
- 'Unknown for now' - the missing parts say unknown; the next capture asks again
```

### 3. WRITE - the run book, to references/doc-shape.md

Read `references/doc-shape.md` now: the skeleton, the `covers:` and `watch.json` rules, the credentials
template and how a refresh lands on a branch. Write under `<docs-path>/project-capabilities/` only; the
doc opens with the `Captured: <branch>@<short-sha>, <date>` stamp (`+dirty` on an uncommitted tree).
Every repo fact cites its file; every gap nobody filled says `unknown` and names this capture.

When the login answer asked for the template, write it and prove it is ignored before anything else
reads the folder: `git check-ignore -q <docs-path>/project-capabilities/credentials.local.env` exits 0.
Any other exit is a file git would commit - delete the file you just wrote, report it, and point the doc
at an environment variable instead. Outside git there is nothing to commit it to; say so.

Then two checks, both before the report:

```bash
grep -nE '(PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|password|passwd)[A-Za-z0-9_]*[:=][[:space:]]*[^[:space:]<]' "<docs-path>/project-capabilities/PROJECT-CAPABILITIES.md" "<docs-path>/project-capabilities/credentials.local.env" | sed -E 's/((PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|password|passwd)[A-Za-z0-9_]*)[:=].*/\1/'
node .claude/hooks/docs.js lint
```

Name the template only when this run just wrote it - one the user already filled holds the values by design and is never read. The grep prints nothing - a hit (file, line and key, the `sed` cuts the value off the screen; an env line, a YAML `KEY: value` copied from a compose file and a lower-case `password:` key all count, a `<placeholder>` does not) is a value in the doc or the template: replace it with where it lives,
and treat it as a pasted value (above). A `PROBLEM` line from the lint is fixed before the report.

### 4. RULE - write .claude/rules/baseline-project-run-book.md

Generated from `references/run-book-rule.template.md` with `__DOC_PATH__` replaced by the LITERAL docs root (`baseline-docs-root.md` names it; a rule is static text and cannot resolve the setting at load). A REPLACE, never a delete: READ the existing rule first, then Write the fresh one over it. Verify: `grep -c __DOC_PATH__` prints 0 and `wc -c` stays at or under 300 - the rule loads in every session and every subagent. It stays out of the installer's fetch manifest, so an update never overwrites it.

### 5. REPORT

A literal line template, one line per field (a table where a field lists several items):

```text
Doc:          <created | refreshed> - <docs-path>/project-capabilities/PROJECT-CAPABILITIES.md, sections <touched>
From repo:    <the files DISCOVER read the facts from>
Asked:        <each question asked with the answer's label, or `none - the repo settled every gap`>
Unknown:      <the sections or lines still unknown, or `none`>
Credentials:  <where each account's credentials live, by name only | template at <path>, ignored: yes | no login>
Value check:  <no hit | <n> hit(s) replaced with where the value lives>
Rule:         <created | regenerated> - .claude/rules/baseline-project-run-book.md, <n> bytes
```

No re-paste of the doc - point to the file.

## Don't game it

Record how the app actually runs, not how it should: every command and port traces to a file DISCOVER
read or to the user's own answer, and a gap stays `unknown` rather than filled with a plausible default.
A credential appears only as the place it lives.
