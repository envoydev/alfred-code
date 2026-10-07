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
    two. The renamed MCP ids were listed as RETIRED aliases through 2.2.0; from 2.2.1 (the user's ruling of
    2026-10-06) none is (the MCP prune drops each from the live file, lint 49 names one still there), and update
    still migrates an install that holds one. No `renames` key - a rename strands an install
    (`docs/plugin-cli-evidence.md` S11); lint 49 fails on a `renames` key or an
    `alfred-code-hooks` entry.
  - `evals/library/` - one `claude plugin eval` case per stack profile, graded `arm: both`, plus the
    three `size-first-*` cases of `task-solve` (2.1.4 - a library skill only the bundle carries);
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
    `capture-related-projects` / `related-project-analyzer`: addable, never seeded or re-added); its
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
    under its old spelling as fallback until every install has it; the 1.x spellings are past that point
    and read nowhere (the user's ruling of 2026-10-07: every install had moved across).
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
  evidence scan; `--orientation` prints the provisional `ORIENTATION.md` the `capture-first-look` skill writes. `scripts/skill-comply.js` - grades whether a skill's steps were followed in a transcript (`check` / `grade`, offline, over the expectation files in `meta/skill-comply/`); `replay` runs the fixtures through `claude -p` only on `--live`, which is billed; `compare` applies the A/B ship rule over two replay outputs (a step failing on both arms is INCONCLUSIVE, never not-worse; one graded by nothing offline is NOT GRADED). `README.md` stays compact (headline counts lint-checked; inventories live in the HTML).
