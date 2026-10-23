# Project awareness - the run book every session loads before it runs the app

Read at step 2. A change is proven twice: by its tests, and by running the app and exercising what changed. The
second half fails on facts no code states - the command that starts the app, the URL it answers on, the test
account, the service that must be up first, the flow that proves the change. `PROJECT-AWARENESS.md` records them
once, so every session and every seat that builds, starts, logs into or hand-checks the app has them instead of
guessing. The repo answers first; the user fills only what the repo cannot show.

## Contents

- **Credentials - the hard rule** - by where they live, never by value
- **DISCOVER** - the repo answers first, every fact keeps its file
- **The skeleton** - the eight sections in reading order
- **covers and watch.json** - derived from the files DISCOVER read
- **The keys in the sensitive data** - empty keys the user fills
- **WRITE and the three checks** - first capture whole, a refresh by section

## Credentials - the hard rule

Never ask for a credential's VALUE, and the doc never holds one - not in an ask, not in the doc, not in the
report. The doc records the login steps and WHERE it lives - an environment variable, a key in a gitignored local
file (the project's sensitive data, `<data root>/.sensitive-data`, first), a vault item - and the user puts the
value there by hand. A value the user pastes anyway is never written anywhere: redact it as `<redacted>`, record
only where it should live, and follow the security baseline's credential rule (the rotation ask). A seat that needs
the value to log in checks the file for presence (the secret guard's `--presence`) and goes through that guard's
one ask before it types it; a command that needs it runs through the guard's `--with-sensitive`.

## DISCOVER - the repo answers first

Read, never guess. Every read is bounded - a `grep -n` to the lines, then a ranged read - and every fact keeps the
file it came from: that list becomes the sections' `covers:` lines and the `watch.json` entries.

1. **Build, test, run.** The first-look scan prints them from the manifests. Resolve it from the stack's plugin
   cache, NEWEST version first, and run it with no `--out` - it prints and writes nothing:

   ```bash
   SCAN=$(for d in "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/*/*; do   # one glob: zsh aborts the loop when any named glob matches nothing
     PN=${d%/*}; PN=${PN##*/}; [ "$PN" = alfred-code ] || continue
     f="$d/scripts/scan-evidence.js"
     [ -f "$f" ] && [ ! -e "$d/.orphaned_at" ] && printf '%s\t%s\n' "$(basename "$d")" "$f"
   done 2>/dev/null | sort -V | tail -1 | cut -f2)
   echo "scan: ${SCAN:-absent}"
   [ -n "$SCAN" ] && node "$SCAN" --orientation --root .
   ```

   `scan: absent` or `no manifest recognized`: read `package.json` scripts, `*.sln` / `*.csproj` and the
   `Makefile` targets by hand instead.
2. **Start and reach.** `**/Properties/launchSettings.json` (profile names, `applicationUrl`, and the NAMES of its
   environment variables), compose files (services, published ports), a `Procfile`, `.vscode/launch.json`
   configuration names, and the setup, start and run scripts and task-runner files (`setup_*.sh`, `scripts/*.sh`, a
   gulpfile, a `Makefile`) - their usage lines, flags, and what each starts or updates.
3. **Before you run.** An `.env.example` / `.env.sample` / `.env.template` - key NAMES only (`cut -d= -f1`), never
   a real `.env`; the services the app depends on; the migration or seed command the scripts name. More than one
   environment config (`config.*.json`, `appsettings.*.json`, `.env.*`) means a local start can reach any of those
   data stores: the Data target line names the file that picks it and a count-only host check per environment
   (`grep -c '<host>' <file>`, never the value) - what DISCOVER cannot settle joins the fourth question's 'The repo
   shows'. A tracker route the prose or the env example names (a token variable, a CLI) is the Tracker access line;
   none named leaves it to the ask.
4. **The prose.** `README.md`, `AGENTS.md`, `.claude/AGENTS.md`, `CLAUDE.md` and `.claude/CLAUDE.md` headings about
   setup, running, login, debugging and testing
   (`grep -niE '^#+ .*(setup|install|run|start|login|sign in|debug|test)'`), then a ranged read of each hit
   section.
5. **Flows.** End-to-end spec titles (Playwright or Cypress `describe` / `test` names) - a flow a test already
   drives is a flow a manual check exercises.

What DISCOVER settled is written straight into the doc; what it left open is the step-2 ask in SKILL.md.

## The skeleton

Fill every `<...>`; a line the repo and the user left open reads `unknown - re-run /capture-awareness to fill it`.
Each fact the repo gave ends with its source in parentheses. Keep it a quick reference - short lines, commands in
code spans. The doc opens with the `Captured: <branch>@<short-sha>, <date>` stamp (`+dirty` on an uncommitted
tree).

```markdown
Captured: <branch>@<short-sha>, <date>

# Run book - build, start, log in, verify

What an agent needs to run this app and check a change by hand. Commands, ports and names come from the
files each line cites; the rest is the team's answer as of the stamp. A credential is named by where it
lives, never by value. Before a local start, run the Data target check; before a hand-check, hold a flow's
`needs:` against the account and ask once for what is missing, before the first browser call.

## Before you run
<!-- id: before-you-run -->
<!-- covers: <globs of the files these lines came from> -->
- Services: <what must be up first, and the command that brings it up> (<source>)
- Environment: <the variable NAMES the app reads> - values live in <where>
- Data: <the migration or seed command, or 'none needed'> (<source>)
- Data target: <per environment - the file or variable that picks the database a local start reaches, and the count-only check that names it, e.g. `grep -c '<host>' <file>`> (<source>)
- Tools: <the SDK or runtime versions the manifests pin> (<source>)
- Trips a first run: <a VPN, a busy port, a feature flag - or 'nothing known'>
- Tracker access: <the route that reaches this project's issue tracker - a connector, a CLI or a REST call - and the env var NAMES it reads, or 'no tracker'> (<source>)

## Build
<!-- id: build -->
<!-- covers: <globs of the files these lines came from> -->
- `<build command>` - <what it builds> (<source>)
- Tests: `<test command>` (<source>)

## Start
<!-- id: start -->
<!-- covers: <globs of the files these lines came from> -->
- `<start command>` - <what starts, and where it listens> (<source>)
- Ready when: <the log line, health URL or window that says it is up>
- Stop: <how it stops, and what it leaves running>

## Reach and log in
<!-- id: reach-and-log-in -->
- Reach: <the URL and port, the window, or the CLI entry>
- Log in: <numbered steps - the screen, the fields, the role to pick - or 'no login, the app is open'>
- Accounts: <one line per role - its purpose and the user name's home>
- Credentials live in: <env var `<NAME>` | `<data root>/.sensitive-data`, key `<NAME>` | vault item `<name>`> - checked for presence, never printed; a browser login through a browser server started with the sensitive data as its secrets (Playwright MCP's `--secrets <data root>/.sensitive-data`) types the KEY name (`<NAME>`) in `browser_type` / `browser_fill_form`, which the server fills from the store and shows as `<secret>NAME</secret>` - read that marker in the first fill's result before concluding - no marker means the server holds no store, so ask the user to sign in, never retype the key; a key added after the server started needs a reconnect (`/mcp`) first; any other typed value goes through the secret guard's ask

## Flows to verify
<!-- id: flows-to-verify -->
1. <flow name> - <the steps and actions, in order> -> <the result that proves it works> (<source, when a spec drives it>); needs: <the account, record or setting holding the data it reads - or 'any'>

## Edge cases
<!-- id: edge-cases -->
- <the case> - <how to trigger it> -> <the expected behavior>

## Debugging
<!-- id: debugging -->
<!-- covers: <globs of the files these lines came from> -->
- Entry points: <launch profile, attach target, or inspect flag> (<source>)
- Logs: <where they go, and how to raise the level>
- Health: <the endpoint, dashboard or command that shows the app's state>

## Team notes
<!-- id: team-notes -->
- <a fact the user added that no section above holds - a team habit, a known trap, a contact, a manual step> (the team's answer, <date>)
```

Before you run leads because a seat reads it before anything else; the rest follow the order a run takes. Team notes
closes the doc: what the user added past the preset questions, each the user's own words ending `(the team's answer,
<date>)`, or `- none` when nothing was added. It carries no covers line - nothing in the repo backs it - so a refresh
keeps every Team notes line, and only the user's own word changes or drops one.

## covers and watch.json

Only a section built from repo files carries a `covers:` line, and its globs are exactly those files:
`**package.json` for a build read from the manifest, `**launchSettings.json` or `**docker-compose*.yml` for a start
read from the launch config. Reach and log in, Flows to verify and Edge cases come from the user and cover nothing.
The spelling is the engine's: `**` matches any depth, the root included, so `**package.json` covers
`package.json` and `web/package.json` alike.

`<docs-path>/awareness/watch.json` is the domain's one watch file, shared by the three parts: the run book owns its
`watch` entries, one per file family the doc cites, pointing at the sections that family feeds - a change to a
cited file then asks, at the session's close, whether that section still holds. The `notOwned` entry for
`AGENTS-AWARENESS.md` is the script's: keep it in every write (the rule step puts it back if a write dropped it).
No `sourceRoots`: this domain describes how to run the code, not where it lives, so it leaves the first-change gate
to the domains that map the code. For a project whose commands came from `package.json` and whose services came
from a compose file:

```json
{
  "notOwned": ["AGENTS-AWARENESS.md"],
  "watch": [
    { "kind": "build and test commands", "globs": ["**package.json"], "sections": ["PROJECT-AWARENESS#build"] },
    { "kind": "services and start config", "globs": ["**docker-compose*.yml"], "sections": ["PROJECT-AWARENESS#before-you-run", "PROJECT-AWARENESS#start", "PROJECT-AWARENESS#debugging"] }
  ]
}
```

## The keys in the sensitive data

The project's sensitive data, `<data root>/.sensitive-data` (`.alfred` unless `ALFRED_CODE_DATA_PATH` names another
root), exists from the install on - one comment line, no key - so a capture normally finds it present and hands
each key as a `KEY=` line the user adds. Present, it is the user's - never read, rewritten or appended to (the
secret guard refuses each); the session's `Sensitive data:` line lists its keys, and a key the doc needs that it
lacks is a `KEY=` line the report hands the user to add.

The capture writes it only when the login answer asked for the keys and it is absent (an install older than that),
after proving it is ignored: `git check-ignore -q <data root>/.sensitive-data` exits 0 - the root's own `.gitignore`
covers it. Any other exit writes nothing: the doc points at an environment variable and the report names
`/alfred-code:update`, which writes that `.gitignore`. Outside git there is nothing to commit it to; say so. One key
per account the answer named, every value EMPTY; the secret guard holds every value in the file as a credential,
whatever its key:

```dotenv
# The project's sensitive data - fill the values by hand. Never commit this file, never paste a value into chat.
# Agents check it for presence; a command that needs a value runs through --with-sensitive, which masks it in the output.
APP_TEST_USER=
APP_TEST_PASSWORD=
```

The doc's `Credentials live in` line names the file and each key. A `credentials.local.env` an older capture wrote
(the run book's folder before 2026-10-15) is moved into the store by the next install or update, which re-points
this line; a key the store already holds with another value stops that move until the user drops it from one file.

## WRITE and the three checks

- **A first capture** writes `PROJECT-AWARENESS.md` whole (Write), creating `<docs-path>/awareness/` when absent -
  `docs.js set` refuses a file that does not exist yet - and writes the `watch` entries into `watch.json`, keeping
  the `notOwned` entry already there.
- **A refresh** lands each changed section through `node .claude/hooks/docs.js set PROJECT-AWARENESS#<id> <textfile>`:
  the engine writes it in place on mainline, without git or under git versioning, and into this branch's overlay
  otherwise - the capture never decides which. Sections nobody changed are not rewritten. Each section `set` writes
  carries its own `captured:` stamp; where it wrote in place, also edit the top `Captured:` line to this run's.

Every repo fact cites its file; every gap nobody filled says `unknown` and names this capture. Then three checks,
all before the report:

```bash
grep -HnE '(PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|password|passwd)[A-Za-z0-9_]*[:=][[:space:]]*[^[:space:]<]' "<docs-path>/awareness/PROJECT-AWARENESS.md" | sed -E 's/((PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|password|passwd)[A-Za-z0-9_]*)[:=].*/\1/'
node .claude/hooks/docs.js lint awareness
node .claude/hooks/docs.js watch <one file DISCOVER cited>
```

The sensitive data is never in the grep - it holds the values by design. The grep prints nothing - a hit (file,
line and key, the `sed` cuts the value off the screen; an env line, a YAML `KEY: value` copied from a compose file
and a lower-case `password:` key all count, a `<placeholder>` does not) is a value in the doc: replace it with where
it lives, and treat it as a pasted value (above). A `PROBLEM` line from the lint is fixed before the report. The
watch names the sections that file feeds - none named means a `watch.json` glob is wrong, fixed before the report.

Record how the app actually runs, not how it should: every command and port traces to a file DISCOVER read or to
the user's own answer, and a gap stays `unknown` rather than filled with a plausible default.
