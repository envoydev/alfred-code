# The live probe - launching the app, the visual check, driving a browser MCP

Read at step 4, before the first probe run. The mandate (probe the failable inputs, boot through
the production composition root, make one real end-to-end call) is in SKILL.md; this file is how.

## Launch recipe

Bind the port explicitly and verify it from the app's own log line before polling.

- **.NET:** `dotnet run --no-launch-profile --urls <url>` - launchSettings silently overrides
  `ASPNETCORE_URLS` and a plain `--urls` (measured: a probe polled a dead port through its full
  ~23s timeout because the profile won).
- **Angular:** the dev server prints its bound port - poll that one.

A stack not listed here follows the same rule: bind the port explicitly, read the bound port back
from the app's own startup output, then poll.

## The visual check

When the diff touches styles or templates (`.scss` / `.css` / `.html`), the probe includes ONE
targeted visual check of the changed surface - a screenshot of the element or region through the
browser-driving MCP, not a DOM assertion alone (measured: a DOM-only probe signed off a style diff
and the user caught a CSS-only defect in the exact reviewed feature 92 seconds later). That MCP is
per-project - the baseline comments out the servers a project does not need, so it can be absent
from your tool list; absent it, the visual check is reported `live-probe: visual NOT RUN - no
browser MCP`, never assumed from the DOM.

## Driving the probe through a browser MCP

- Resolve interactive targets from a page snapshot's element refs before any click or form fill -
  never a guessed CSS or text selector (measured: 4 of 5 probe errors in one session were guessed
  selectors, re-guessed three times).
- On a second consecutive miss of an element that was previously present, check the page URL and
  state before retrying - the page has usually navigated out from under you (measured: two
  identical misses traced to an unnoticed mid-probe logout, found only by a snapshot two blind
  retries later).
