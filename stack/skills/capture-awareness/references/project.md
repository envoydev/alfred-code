# Project awareness - the project info, the run book, the resources and the user's own file

Read when the project part runs. A change is proven twice: by its tests, and by running the app and exercising what
changed. The second half fails on facts no code states - the command that starts the app, the URL it answers on, the
test account, the service that must be up first, the flow that proves the change. The run book records them once, so
every session and every seat that builds, starts, logs into or hand-checks the app has them instead of guessing. Beside
it, the project info says what the project is and where it runs, and the resources doc says where its tracker, wiki,
error monitor and CI live. The repo answers first; the user fills only what the repo cannot show.

## Contents

- **The four docs** - three this part writes, one the user writes
- **The modes** - FIRST, NOTE, CURRENT and UPDATE, per doc
- **The asks** - two calls, never more than four questions in one
- **Credentials - the hard rule** - by where they live, never by value
- **DISCOVER** - the repo answers first, every fact keeps its file
- **The skeleton** - the run book's eight sections in reading order
- **The project info and the resources** - their skeletons
- **The user's own file** - created once, never written again
- **covers and watch.json** - derived from the files DISCOVER read
- **The keys in the sensitive data** - empty keys the user fills
- **WRITE and the three checks** - first capture whole, a refresh by section, then the part's report fields

## The four docs

| File | Holds | Budget |
|---|---|---|
| `<docs-path>/awareness/PROJECT-INFO-AWARENESS.md` | what the project is, who uses it, its stack and modules, where it runs | 2,000 bytes |
| `<docs-path>/awareness/RUN-AND-DEBUG-AWARENESS.md` | the run book - build, start, reach, log in, verify, debug | none |
| `<docs-path>/awareness/RESOURCES-AWARENESS.md` | the tracker, the wiki, the error monitor, the git host and CI - each a name, a URL and what to look up there | 1,500 bytes |
| `<docs-path>/awareness/USER-AWARENESS.md` | the user's own notes | 4,000 bytes, warned, never trimmed |

The budgets are enforced by the script, never by your count: the router's close runs `awareness-state.js --rule`,
which prints one `size: <file> <n> bytes` line per imported doc and `over budget: <file> <n> of <cap> bytes` past a
cap; the close carries those lines on its `Rule:` line.

## The modes

The mode comes from disk, per doc - the run book, the project info and the resources each on its own:

- **FIRST** - the doc does not exist: DISCOVER, the asks below, WRITE.
- **NOTE** - the doc exists and the arguments carry a typed fact (no doc yet: FIRST, the fact answering its
  question). The user's words are the answer, so no gate and no DISCOVER: append it through `docs.js set` to the
  section it belongs to, in whichever doc holds that section (a fact that fits no section lands in Team notes),
  ending `(the team's answer, <date>)`; what it leaves open stays `unknown`. Then the value check and the lint; the
  report reads `Project: appended - <doc>#<section>`.
- **CURRENT** - the doc exists, `node .claude/hooks/docs.js stale` names none of its sections, it holds no
  `unknown - re-run` line, and the arguments carry no `refresh`: one report line, no ask.
- **UPDATE** - otherwise. This gate first, one ask for every doc in UPDATE; on 'Refresh', DISCOVER again and ask only
  the questions whose section still says `unknown` or cites a file that changed since the stamp (`git diff
  --name-only <stamp-sha>..HEAD`). An answer the user gave before stands unless the repo now contradicts it or the
  user changes it.

  ```ask
  The project docs exist (<each doc's Captured: stamp>) and <the stale sections, the open gaps, or 'you asked for a refresh'>. Refresh them: the repo is re-read and only the open gaps and what moved are asked.
  - 'Refresh the project docs (Recommended)' - every earlier answer the repo does not contradict is kept
  - 'Keep them as they are' - nothing is written; the report names what moved
  ```

  No answer, no write - never fall through to the rewrite. When the router's chain ran this part, its answer is this
  gate, and a mode word after the topic (a calling flow) skips it: neither asks it again.

## The asks

The questions, in this order, never more than four in one call:

1. The run book's gap call below, with 'Anything else?' riding it while it holds three questions or fewer.
2. ONE more call, at most three questions, each asked only when DISCOVER left its gap: the project info, the
   resources, and 'Anything else?' when it did not ride call 1. A first capture with nothing settled asks four plus
   three; one with every gap settled asks only 'Anything else?' in call 1.

The gaps DISCOVER left open go in ONE AskUserQuestion call, one question per gap (at most four). A question whose
whole answer DISCOVER settled is not asked - its facts go straight into the doc. Each question states what the repo
showed ('nothing' when it showed nothing), and the fuller answer arrives as typed text via Other:

```ask
How is the app started and reached for a manual check? The repo shows: <start commands, URLs, launch profiles - or nothing>. Type a correction or the missing part via Other.
- 'As the repo shows (Recommended)' - the Start and Reach lines are written from <files>, each cited
- 'Unknown for now' - the missing part says unknown; the next capture asks again
```

```ask
How does an agent log in? The repo shows: <a login route, an auth config - or no login>. Never type a password here - via Other, type the login steps, the account's role and WHERE its credentials already live (an env var, a file and key, a vault item).
- 'A test account - name its keys and I add them to the sensitive data (Recommended)' - the report hands one `KEY=` line per key for `<data root>/.secrets`; the doc points at them
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

Past the preset tabs, one more question lets the user hand the run book anything else it needs. It is asked on a
first capture and on 'Refresh', even when DISCOVER settled every gap; it rides the gap call while it holds three
questions or fewer, else it is the next call:

```ask
Anything else the run book should hold that the questions above did not cover? A team habit, a known trap, a contact, a manual step - type it via Other, or pick below.
- 'Nothing to add (Recommended)' - Team notes keep what they hold; a later note in the arguments adds one
- 'Add my own notes' - I ask for them next, in plain text; each lands in Team notes, dated
- 'I will write it myself' - nothing is written; your own notes go in <docs-path>/awareness/USER-AWARENESS.md, which only you edit
```

The project info and the resources, in call 2:

```ask
What is this project, who uses it, and where does it run? The repo shows: <the README's opening, the manifests' names and stack, the deploy configs, the git remote - or nothing>. Type a correction or the missing part via Other.
- 'As the repo shows (Recommended)' - the project info is written from <files>, each cited
- 'Unknown for now' - the missing sections say unknown; the next capture asks again
```

```ask
Where are this project's tracker, wiki, error monitor and CI? The repo shows: <the git host, the CI config, README links, package.json bugs / repository - or nothing>. Type each missing one via Other as a name and a URL (Jira, Confluence, Sentry, ...) - never a token.
- 'As the repo shows (Recommended)' - the resources doc lists what <files> name, each cited
- 'Unknown for now' - the missing sections say unknown; the next capture asks again
```

Then WRITE and the three checks, below.

## Credentials - the hard rule

Never ask for a credential's VALUE, and the doc never holds one - not in an ask, not in the doc, not in the
report. The doc records the login steps and WHERE it lives - an environment variable, a key in a gitignored local
file (the project's sensitive data, `<data root>/.secrets`, first), a vault item - and the user puts the
value there by hand. A value the user pastes anyway is never written anywhere: redact it as `<redacted>`, record
only where it should live, and follow the security rule's credential line (the rotation ask). A seat that needs
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

6. **The project info and the resources.** The README's opening, the manifests, the deploy and hosting configs, the
   git remote (`git remote -v`), the CI config, README links and `package.json`'s `bugs` / `repository`.

What DISCOVER settled is written straight into the docs; what it left open is an ask above.

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
- Credentials live in: <env var `<NAME>` | `<data root>/.secrets`, key `<NAME>` | vault item `<name>`> - checked for presence, never printed; a browser login through a browser server started with the sensitive data as its secrets (Playwright MCP's `--secrets <data root>/.secrets`) types the KEY name (`<NAME>`) in `browser_type` / `browser_fill_form`, which the server fills from the store and shows as `<secret>NAME</secret>` - read that marker in the first fill's result before concluding - no marker means the server holds no store, so ask the user to sign in, never retype the key; a key added after the server started needs a reconnect (`/mcp`) first; any other typed value goes through the secret guard's ask

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

## The project info and the resources

Each opens with the run book's stamp line and takes its section format - an id and, where files back it, a `covers:`
line under each heading. A section the repo and the user left open reads `unknown - re-run /capture-awareness project
to fill it`. A section with no file behind it (who uses it, a tracker the user named) carries no `covers:` line;
`lint awareness --no-map` notes it, never fails it.

`PROJECT-INFO-AWARENESS.md`:

```markdown
Captured: <branch>@<short-sha>, <date>

# Project info

## What it is
<!-- id: what-it-is -->
<!-- covers: README.md -->
## Who uses it
<!-- id: who-uses-it -->
## Stack and modules
<!-- id: stack-and-modules -->
<!-- covers: <the manifests DISCOVER read> -->
## Where it runs
<!-- id: where-it-runs -->
<!-- covers: <the deploy and hosting configs, when any> -->
```

`RESOURCES-AWARENESS.md` - a credential never appears: a resource that needs a login names where its token lives (the
credentials rule above):

```markdown
Captured: <branch>@<short-sha>, <date>

# Resources

## Issue tracker
<!-- id: issue-tracker -->
## Wiki and docs
<!-- id: wiki-and-docs -->
## Error monitor
<!-- id: error-monitor -->
## Git host and CI
<!-- id: git-host-and-ci -->
<!-- covers: <the CI config files> -->
```

## The user's own file

`<docs-path>/awareness/USER-AWARENESS.md` is the user's. The first run of this part that finds it absent creates it
with one header line, and no run writes it again - not a refresh, not a NOTE:

```markdown
# My notes - yours alone: the stack creates this file once and never writes it again
```

It is machine-local - the data root's ignore list keeps it out of git - and the awareness rule imports it whenever it
exists, so a note typed into it reaches the next session without a re-run.

## covers and watch.json

Only a section built from repo files carries a `covers:` line, and its globs are exactly those files:
`**package.json` for a build read from the manifest, `**launchSettings.json` or `**docker-compose*.yml` for a start
read from the launch config. Reach and log in, Flows to verify and Edge cases come from the user and cover nothing.
The spelling is the engine's: `**` matches any depth, the root included, so `**package.json` covers
`package.json` and `web/package.json` alike.

`<docs-path>/awareness/watch.json` is the domain's one watch file, shared by every awareness part: the run book owns
its `watch` entries, one per file family the doc cites, each `kind` opening with `run book: `, pointing at the
sections that family feeds - a change to a cited file then asks, at the session's close, whether that section still
holds. The project info's entries open with `project info: ` and the resources' with `resources: `, the same way.
The `notOwned` entry for `AGENTS-AWARENESS.md` is the script's, the `seam with <slug>` entries are the
related-projects part's and the `architecture: ` entries the architecture part's: the merge (WRITE, below) keeps them
all, so the run book never writes the file whole.
No `sourceRoots`: this domain describes how to run the code, not where it lives, so it leaves the first-change gate
to the domains that map the code. For a project whose commands came from `package.json` and whose services came
from a compose file, the run book's entries are:

```json
[
  { "kind": "run book: build and test commands", "globs": ["**package.json"], "sections": ["RUN-AND-DEBUG-AWARENESS#build"] },
  { "kind": "run book: services and start config", "globs": ["**docker-compose*.yml"], "sections": ["RUN-AND-DEBUG-AWARENESS#before-you-run", "RUN-AND-DEBUG-AWARENESS#start", "RUN-AND-DEBUG-AWARENESS#debugging"] }
]
```

## The keys in the sensitive data

The project's sensitive data, `<data root>/.secrets` (`.alfred` unless `ALFRED_CODE_DATA_PATH` names another
root; `.sensitive-data` on an install no update has renamed yet, the same file under its old name), exists from the install on - one comment line, no key - so a capture normally finds it present and hands
each key as a `KEY=` line the user adds. Present, it is the user's - never read, rewritten or appended to (the
secret guard refuses each); the session's `Sensitive data:` line lists its keys, and a key the doc needs that it
lacks is a `KEY=` line the report hands the user to add.

The capture writes it only when the login answer asked for the keys and it is absent (an install older than that),
after proving it is ignored: `git check-ignore -q <data root>/.secrets` exits 0 - the root's own `.gitignore`
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

- **A first capture** writes each FIRST doc whole (Write), creating `<docs-path>/awareness/` when absent - `docs.js
  set` refuses a file that does not exist yet - then merges the watch (below).
- **A refresh** lands each changed section through `node .claude/hooks/docs.js set <DOC>#<id> <textfile>`:
  the engine writes it in place on mainline, without git or under git versioning, and into this branch's overlay
  otherwise - the capture never decides which. Sections nobody changed are not rewritten. Each section `set` writes
  carries its own `captured:` stamp; where it wrote in place, also edit the top `Captured:` line to this run's.
- **The watch, every run** - each doc this run wrote merges its own entries, which replace as one set, by their
  prefix:

  ```bash
  node .claude/hooks/docs.js watch-merge awareness --kinds 'run book: ' --doc RUN-AND-DEBUG-AWARENESS <<'EOF'
  [ <the run book's entries, as in covers and watch.json above> ]
  EOF
  node .claude/hooks/docs.js watch-merge awareness --kinds 'project info: ' --doc PROJECT-INFO-AWARENESS <<'EOF'
  [ <the project info's entries> ]
  EOF
  node .claude/hooks/docs.js watch-merge awareness --kinds 'resources: ' --doc RESOURCES-AWARENESS <<'EOF'
  [ <the resources' entries> ]
  EOF
  ```

  `--doc RUN-AND-DEBUG-AWARENESS` also takes in an older capture's entries written without the prefix (every section they
  name is in this doc), so the first run after an update replaces them instead of leaving duplicates; the `seam
  with` entries and the `notOwned` key are kept. An engine older than the merge answers with a line that opens
  `usage: docs.js where`: then edit `watch.json` by hand as before - replace the entries whose sections are all in
  `RUN-AND-DEBUG-AWARENESS`, keep every other entry and key - and say so in the report; a line opening `watch-merge:` is
  this call's own error - fix the call and run it again.

Every repo fact cites its file; every gap nobody filled says `unknown` and names this capture. Then three checks,
all before the report:

```bash
grep -HnE '(PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|password|passwd)[A-Za-z0-9_]*[:=][[:space:]]*[^[:space:]<]' "<docs-path>/awareness/RUN-AND-DEBUG-AWARENESS.md" "<docs-path>/awareness/PROJECT-INFO-AWARENESS.md" "<docs-path>/awareness/RESOURCES-AWARENESS.md" 2>/dev/null | sed -E 's/((PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|password|passwd)[A-Za-z0-9_]*)[:=].*/\1/'
node .claude/hooks/docs.js lint awareness --no-map
node .claude/hooks/docs.js watch <one file DISCOVER cited>
```

The sensitive data is never in the grep - it holds the values by design. The grep prints nothing - a hit (file,
line and key, the `sed` cuts the value off the screen; an env line, a YAML `KEY: value` copied from a compose file
and a lower-case `password:` key all count, a `<placeholder>` does not) is a value in the doc: replace it with where
it lives, and treat it as a pasted value (above). A `PROBLEM` line from the lint is fixed before the report; the
`--no-map` part leaves the architecture map's rows to its own part. The
watch names the sections that file feeds - none named means a `watch.json` glob is wrong, fixed before the report.

The part's field template, one line per field (a table where a field lists several items):

```text
Project:     <created | refreshed | appended | current | kept> - <each doc this run wrote, with the sections touched, or none>
From repo:   <the files DISCOVER read the facts from, or not run>
Asked:       <each question asked with the answer's label, or none>
Unknown:     <the sections or lines still unknown, or none>
Credentials: <where each account's credentials live, by name only | keys in <data root>/.secrets, ignored: yes | no login>
Value check: <no hit | <n> hit(s) replaced with where the value lives | not run>
Watch:       <the cited file> -> <the sections it names, or not run>
```

Record how the app actually runs, not how it should: every command, port, URL and resource traces to a file DISCOVER
read or to the user's own answer, and a gap stays `unknown` rather than filled with a plausible default.
