# angular-conventions - evidence appendix

The measured anecdotes behind this skill's rules, kept out of the run-time body so every session stops paying
for them. Audit material: read it to learn WHY a rule is shaped the way it is, never to run the skill.

## Intro - docs currency
- **For any API surface not pinned down here, reach for the documentation MCP or the Angular CLI MCP rather than memory, never by grepping node_modules** - measured: one session spent ~5.2k tokens grep/sed-ing minified `@angular/core` for a `LOCALE_ID` answer while both MCPs sat live and unused; the routing line lived only in the web-frontend router, which is deliberately not loaded once this leaf skill is.
