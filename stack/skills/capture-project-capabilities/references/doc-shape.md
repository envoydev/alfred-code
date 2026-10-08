# project-capabilities/PROJECT-CAPABILITIES.md - the run book's shape and write protocol

## Contents

- **The domain** - one file, its `watch.json`, nothing else of the stack's
- **The skeleton** - the seven sections in reading order, the one a seat reads first on top
- **covers and watch.json** - derived from the files DISCOVER read, never a template
- **The credentials template** - empty keys, gitignored in its own folder
- **Write mechanics** - a first capture writes the file; a refresh lands section by section

## The domain

`<docs-path>/project-capabilities/` is a docs domain like `architecture/` or `code-style/`: its
`watch.json` is what makes the docs engine (`.claude/hooks/docs.js`) section, lint and watch it, and what
lets a seat find one section by path (`docs.js where package.json`) or by id
(`docs.js show PROJECT-CAPABILITIES#reach-and-log-in`) instead of reading the whole file. This capture
is its sole author. The folder holds the doc, its `watch.json`, and - only when the user chose it - the
credentials template with its `.gitignore`.

## The skeleton

Fill every `<...>`; a line the repo and the user left open reads
`unknown - re-run /capture-project-capabilities to fill it`. Each fact the repo gave ends with its
source in parentheses. Keep it a quick reference - short lines, commands in code spans.

```markdown
Captured: <branch>@<short-sha>, <date>

# Run book - build, start, log in, verify

What an agent needs to run this app and check a change by hand. Commands, ports and names come from the
files each line cites; the rest is the team's answer as of the stamp. A credential is named by where it
lives, never by value.

## Before you run
<!-- id: before-you-run -->
<!-- covers: <globs of the files these lines came from> -->
- Services: <what must be up first, and the command that brings it up> (<source>)
- Environment: <the variable NAMES the app reads> - values live in <where>
- Data: <the migration or seed command, or 'none needed'> (<source>)
- Tools: <the SDK or runtime versions the manifests pin> (<source>)
- Trips a first run: <a VPN, a busy port, a feature flag - or 'nothing known'>

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
- Credentials live in: <env var `<NAME>` | `<docs-path>/project-capabilities/credentials.local.env`, key `<NAME>` | vault item `<name>`> - checked for presence, never printed; typing a value goes through the secret guard's ask

## Flows to verify
<!-- id: flows-to-verify -->
1. <flow name> - <the steps and actions, in order> -> <the result that proves it works> (<source, when a spec drives it>)

## Edge cases
<!-- id: edge-cases -->
- <the case> - <how to trigger it> -> <the expected behavior>

## Debugging
<!-- id: debugging -->
<!-- covers: <globs of the files these lines came from> -->
- Entry points: <launch profile, attach target, or inspect flag> (<source>)
- Logs: <where they go, and how to raise the level>
- Health: <the endpoint, dashboard or command that shows the app's state>
```

Before you run leads because a seat reads it before anything else; the rest follow the order a run takes.

## covers and watch.json

Only a section built from repo files carries a `covers:` line, and its globs are exactly those files:
`**package.json` for a build read from the manifest, `**launchSettings.json` or `**docker-compose*.yml`
for a start read from the launch config. Reach and log in, Flows to verify and Edge cases come from the
user and cover nothing. The spelling is the engine's: `**` matches any depth, the root included, so
`**package.json` covers `package.json` and `web/package.json` alike.

`watch.json` carries one entry per file family the doc cites, pointing at the sections that family
feeds - a change to a cited file then asks, at the session's close, whether that section still holds.
No `sourceRoots`: this domain describes how to run the code, not where it lives, so it leaves the
first-change gate to the domains that map the code. For a project whose commands came from
`package.json` and whose services came from a compose file:

```json
{
  "watch": [
    { "kind": "build and test commands", "globs": ["**package.json"], "sections": ["PROJECT-CAPABILITIES#build"] },
    { "kind": "services and start config", "globs": ["**docker-compose*.yml"], "sections": ["PROJECT-CAPABILITIES#before-you-run", "PROJECT-CAPABILITIES#start", "PROJECT-CAPABILITIES#debugging"] }
  ]
}
```

Run `node .claude/hooks/docs.js watch <a cited file>` once after the write: it names the sections that
file feeds, or the glob is wrong.

## The credentials template

Written only when the login answer asked for it, and only when absent - a filled one is the user's, never
read or rewritten. One key per account the answer named, every value EMPTY; a key ending in `PASSWORD`,
`TOKEN` or `SECRET` is what the secret guard judges, so the filled file stays protected:

```dotenv
# Test credentials for the run book - fill the values by hand. Never commit this file, never paste a value into chat.
# Agents check it for presence only and ask before they type a value into the app.
APP_TEST_USER=
APP_TEST_PASSWORD=
```

The folder lists `credentials.local.env` in its own `.gitignore` - a one-line file inside
`project-capabilities/`, never an edit to the project's own `.gitignore`. The doc's `Credentials live in`
line names the file and each key.

## Write mechanics

- **A first capture** writes `PROJECT-CAPABILITIES.md` and `watch.json` whole (Write), creating the
  folder when absent - `docs.js set` refuses a file that does not exist yet.
- **A refresh** lands each changed section through
  `node .claude/hooks/docs.js set PROJECT-CAPABILITIES#<id> <textfile>`: the engine writes it in place
  on mainline, without git or under git versioning, and into this branch's overlay otherwise - the
  capture never decides which. Sections nobody changed are not rewritten. Each section `set` writes carries its own
  `captured:` stamp; where it wrote in place, also edit the top `Captured:` line to this run's.
