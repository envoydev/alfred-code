# A worked greenfield run

Read when the shape of a whole run is unclear - one brief taken through the five steps.

## Example

Brief: 'Start a new Angular admin dashboard.'
1. **DESIGN** in-session: three options - standalone + signals with feature folders; NgRx-backed modular; minimal-shell MVP - each with routing, state tier, folder shape, and the tradeoff that decides it.
2. **THE PICK**: the user chooses option one.
3. **SCAFFOLD**: `ng new admin`, structure per the Angular framework-conventions skill, wire lint/format config, a test setup, the core routing shell.
4. **BUILD**: first slice (the auth shell) - dispatch the web-Angular stack's own trio in order, its solution-designer, then its implementer(s), then its verifier; loop the punch-list. Repeat per slice to the first milestone.
5. **HANDOFF**: suggest the captures so the repo gets its map and style artifacts.
