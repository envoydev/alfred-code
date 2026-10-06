---
paths:
  - "meta/**"
  - "scripts/lint*"
  - "scripts/build-*"
  - "scripts/analyze-usage*"
  - "scripts/scan-evidence*"
  - "scripts/skill-comply*"
  - "scripts/plugin-*"
---

# meta/ and the repo scripts

What each meta file owns and what the repo-level scripts (lint, usage analysis, evidence scan) do. Moved here verbatim from the repo `CLAUDE.md` so it loads only when you edit these files.

- `meta/` - never installed:
  - `shared-rules.json` pins every deliberate multi-home rule (owner + marker-pinned copies); the lint
    goes red when a copy's marker breaks.
  - `stack-graph.json` - generated dependency graph read by `stack-select.js`; regenerate with
    `npm run graph` (lint fails when stale).
  - `plugin-entries.json` - the GENERATED core entry, computed by `scripts/build-marketplace.js` from
    the placement rule in `scripts/plugin-placement.js`: the core is the router skill, every seat and
    every stack hook, every stack skill is library (2.1.0). Regenerate with `npm run marketplace`; lint
    checks 44 and 45 fail when the file is stale, a second plugin appears, or an item has no home or
    two. The live marketplace also lists the two 1.x ids as RETIRED aliases (`aliasEntries`, from
    `brand.js` `LEGACY`): the core under its old name carrying what the core carried before 2.1.0 (the
    always closure, `formerCore` - a straggler has no copies yet), and the old hooks id carrying
    nothing. No `renames` key -
    a rename strands a 1.x install, a listed id refreshes in place (`docs/rebrand-evidence.md` S11,
    S21); lint 49 fails on a `renames` key or an `alfred-code-hooks` entry.
  - `retired-entries.json` - the 20 per-stack entries 1.2.0 shipped, FROZEN. No longer LISTED in the marketplace
    (2.1.7, the user's ruling of 2026-10-06 - the Discover tab showed 20 'RETIRED in 1.3.0' rows; `build-marketplace.js
    unlistedRetired` drops each from an applied marketplace, lint 49 names one still there). An install still holding
    one migrates from this file alone: update copies its picks and uninstalls it (leaves first); a PARKED one, or one
    at another scope, is kept and logged with its uninstall command. The FILE stays while the names are retired: it is
    the only record of what each entry carried. The two 1.x core aliases and the six renamed MCP ids stay listed
    through the 2.x line (a straggler on them keeps its update command and its tools).
  - `evals/library/` - one `claude plugin eval` case per stack profile, graded `arm: both`, plus the
    three `size-first-*` cases of `alfred-task-solve` (2.1.4 - a library skill only the bundle carries);
    `npm run eval-bundle -- <out>` puts the core and the whole library into ONE plugin named
    `alfred-code` so the eval CLI can load a library item, with the `scripts/`, `meta/`, `stack/` and
    `setup-plugin/references/` trees at the core's own relative paths, so every
    `${CLAUDE_PLUGIN_ROOT}/...` a bundled body names resolves. The core's own cases
    (`setup-plugin/evals/`) run against the CORE entry installed from a scratch marketplace of the tree,
    never `setup-plugin/` alone (its plugin root holds no `scripts/`). The run is billed.
  - `environment.json` - the ONE list of settings.json `env` values the stack owns; adding a variable is
    one row plus the seed's own (lint check 58 - not check 27, which is the `suggests:` removal
    check below).
  - `recommendations.json` - seeds + the never-flag `general` list (project-conditional opt-ins, e.g.
    `alfred-capture-related-projects` / `related-project-analyzer`: addable, never seeded or re-added); its
    `notes` give an opt-in row nothing selects its walk-table why.
  - `evidence.json` - need-signals `scripts/scan-evidence.js` matches against manifests; evidence rows
    arrive pre-selected, absence is advisory, evidence never creates a `required` lock.
  - `plugin-settings.json` - recommended config for INSTALLED plugins, applied by
    `scripts/plugin-settings.js`: walks report and ask in the plugins layer turn, apply after install;
    add-only by default (`--replace` overwrites); each row names the verified plugin VERSION (lint 28).
  - `mcp-pins.json` / `mcp-tools.json` - the MCP runtime pins with their `refreshed` day (the uvx dependency
    cut-off), and each pinned server's tool names at its pin (lint check 62), both written only by
    `node scripts/refresh-mcp-pins.js --write`.
  - `model-prices.json` - the list prices `analyze-usage.js` bills its cost row from, with the source page and
    fetch date inside; refreshed from that page, never from memory (a unit test pins the page's multipliers). It
    keeps every row the page prices, retired ones included, and every model in `model-windows.json`, so a model with
    no row is reported 'not on the pricing page (fetched <date>)', never guessed (2.1.6 K3).
  - `judgment.json`, `migrations.json` - existence-detected retirements of GENERATED artifacts plus the
    `env` RENAMES the env pass applies every run (order pinned as `env-pass-order`). A renamed key is read
    under its old spelling as fallback until every install has it (e.g. `ALFRED_CODE_DOCS_PATH`,
    ex-`CLAUDE_DOCS_PATH`).
  Commands reach `meta/` through the run's snapshot (`$TMP/repo/meta/`), never `${CLAUDE_PLUGIN_ROOT}`.
- `scripts/lint-skills.js` - the parity lint. `scripts/analyze-usage.js` - offline token/tool report over
  a session transcript (+ `subagents/`), with an EFFICIENCY scorecard (one measured number per practice);
  it reads `PowerShell` and `Monitor` as the shell route, writes with `--out <file>` (never a `>` redirect), and
  `--check-report <file>` re-reads a finished report, printing every judgment number that cites no
  machine row of that same report (judgment lines only, an ISO date never read as a locator - 2.1.7). A slash run of a
  manual-only skill counts as a skill run, its body read from the expansion's `Base directory for this skill:` row. Its rollup skips the live session (`CLAUDE_CODE_SESSION_ID`,
  `--exclude-session <id>`) and counts a plugin only where a registry record reaches or it was used.
  `scripts/agents-md-check.js` - a project's AGENTS.md (and CLAUDE.md) files against the tree they describe, read-only
  and no model call. `scripts/scan-evidence.js` - deterministic manifest-only
  evidence scan; `--orientation` prints the provisional `ORIENTATION.md` the `alfred-capture-first-look` skill writes. `scripts/skill-comply.js` - grades whether a skill's steps were followed in a transcript (`check` / `grade`, offline, over the expectation files in `meta/skill-comply/`); `replay` runs the fixtures through `claude -p` only on `--live`, which is billed; `compare` applies the A/B ship rule over two replay outputs (a step failing on both arms is INCONCLUSIVE, never not-worse; one graded by nothing offline is NOT GRADED). `README.md` stays compact (headline counts lint-checked; inventories live in the HTML).
