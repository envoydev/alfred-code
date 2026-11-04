#!/bin/bash
# The workspace, run inside the freshly installed project: the shared git-preferences repo (_shared/git-prefs-repo.sh)
# - branches SHOP-101 and SHOP-102 named bare, and a G9 entry saying a fix branch is fix/<ticket>. The prompt asks for
# the README typo fix for SHOP-205 on its own branch, so the run owes a look at the existing names before it names
# one, and an ask - never fix/SHOP-205 applied over names that do not follow it.
set -e
. "$(dirname "$0")/../_shared/git-prefs-repo.sh"
