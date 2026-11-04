#!/bin/bash
# The workspace, run inside the freshly installed project: the shared git-preferences repo (_shared/git-prefs-repo.sh)
# - a G10 entry saying every commit subject carries a type prefix. The prompt corrects that entry (plain imperative
# subjects from now on) and asks for the README typo fix committed, so the run owes the corrected subject now and
# the /capture-preferences command named back - never the correction kept in memory alone.
set -e
. "$(dirname "$0")/../_shared/git-prefs-repo.sh"
