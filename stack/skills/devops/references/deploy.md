# Deploy and release - reversible and health-gated

`SKILL.md` names the rules; these are the mechanics behind each.

- Promote one immutable artifact through the environments (with required reviewers on prod); never rebuild per environment, or you ship something you never tested.
- Run migrations as a discrete, gated step BEFORE the app rolls, expand-then-contract so the old and new app versions both work mid-deploy (mechanics belong to the skill covering the .NET migration workflow, where the install has it; without it, keep the step gated and reversible from here); every deploy carries a rollback path.
- Cut over health-gated - blue-green, or a rolling update behind readiness checks, never a big-bang replace that routes traffic to a not-ready instance.
- Pull config and secrets at runtime from the store (Key Vault, an OIDC-federated secret) - never bake them into the image (the app- and data-layer hardening skills own the placement rule where installed; without them, this line is the rule).
