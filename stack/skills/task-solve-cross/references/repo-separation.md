# Separate-Repository Protocol

If frontend and backend live in different repositories, do not force every agent to load both repos. Use a shared contract plus separate per-repo flows joined by the final gate.

```text
One repo   = one local domain flow.
Many repos = shared contract + separate repo flows + integration gate.
```

## Recommended split

```text
Shared planning / ticket / contract doc
  -> producer repo's designer runs first - its interface section recorded as Contract v1
  -> Backend repo flow:
       data-solution-designer   -> data-implementer(s)   -> data-verifier
       aspnet-solution-designer  -> aspnet-implementer(s)  -> aspnet-verifier
     -> Backend PR
  -> Frontend repo flow:
       web-angular-solution-designer -> web-angular-implementer(s) -> web-angular-verifier
     -> Frontend PR
  -> integration-reviewer checks both PRs against Contract v1/v2
```

Backend and frontend implementation may run in parallel only after the contract is frozen.

## Shared contract storage

Store the contract where both repos and agents can read it:

```text
<docs-path>/work/cross-project-tasks/<feature>.contract.md (a committed docs/ path only on the user's asked-first approval)
openapi.yaml or openapi.json
ticket acceptance criteria
shared-api-schema.yaml
a generated TypeScript client snapshot
a generated C# DTO/API snapshot
```

The contract must include: routes; request DTOs; response DTOs; the error envelope and codes; auth/permissions; pagination/filtering/versioning; feature flags; migration/deployment order; backward-compatibility rules. Same fields as the single-repo contract in `references/contract-protocol.md`.

## Drift across repos

If the backend finds the contract impossible, it must not silently change anything on the shared-contract change list in `references/contract-protocol.md` - it emits BLOCKED_CONTRACT_CHANGE. Then:

```text
Contract v1 -> Contract Change Request -> Contract v2
Backend repo updates to v2
Frontend repo receives v2 through the docs-root rule's hand-off block, and updates
integration-reviewer verifies both PRs against v2
```
