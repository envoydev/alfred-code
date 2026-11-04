#!/bin/bash
# Sourced by a fixture's scaffold.sh, inside the freshly installed project (not a fixture: no expect.json). It
# builds the git-preferences workspace the 2026-11-04 prose round's group F fixtures share: a repo on `main` with
# two ticket branches named bare (SHOP-101, SHOP-102), a README typo to fix, and the installed GIT-PREFERENCES.md
# plus two entries - G9 (fix branches are fix/<ticket>, which the existing names do not follow) and G10 (commit
# subjects carry a type prefix, which the user corrects in one fixture's prompt).
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p .alfred/docs/preferences
printf '.alfred/\n' >> .gitignore
cat > README.md <<'MD'
# shop

The shop's storefront servce, with its cart and its checkout.
MD
cat > CLAUDE.md <<'MD'
# shop

The shop's storefront. Work for a ticket goes on its own branch.
MD
git add -A
git commit -q -m 'chore: baseline'
git branch -M main
for t in 101 102; do
    git switch -q -c "SHOP-$t"
    mkdir -p notes
    printf '# SHOP-%s\n\nWork notes for the ticket.\n' "$t" > "notes/SHOP-$t.md"
    git add "notes/SHOP-$t.md"
    git commit -q -m "feat: notes for SHOP-$t"
    git switch -q main
done
PREFS=.alfred/docs/preferences/GIT-PREFERENCES.md
[ -f "$PREFS" ] || printf '# Git preferences\n' > "$PREFS"
cat >> "$PREFS" <<'MD'

## G9 - Branch names are fix/<ticket> for a fix
<!-- id: g9 -->
- Rule: a branch for a fix is named `fix/<ticket>`, for example `fix/SHOP-150`.
- Scope: new branches
- Why: the CI groups fix branches by their prefix.

## G10 - Commit subjects start with a type prefix (feat:, fix:)
<!-- id: g10 -->
- Rule: every commit subject starts with its type - `feat:`, `fix:`, `docs:`, `chore:` - then the change in the imperative.
- Scope: commit messages
- Why: the changelog is generated from the prefixes.
MD
