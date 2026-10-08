# GitHub Actions - the CI/CD contract

`SKILL.md` keeps the three rules every workflow review starts from (SHA-pinned actions, secrets behind a least-privilege `permissions` block, OIDC to the cloud). This is the full contract.

- Structure the graph - a lint/build job and a test job sequenced with needs, fail-fast on lint so a formatting break does not burn a full test run. A matrix covers multiple target frameworks or Node versions.
- Key the cache on a lockfile hash (packages.lock.json, package-lock.json, yarn.lock) with restore-keys for partial hits; a cache key that ignores the lockfile serves a stale restore. Restore deterministically - restore in locked mode, npm ci, never a floating install.
- Pin every third-party action to a full commit SHA, not a moving major tag - the tag is mutable, and a compromised action runs with your token.
- Handle secrets as GitHub Secrets only; mask any derived secret before it can reach a log, never echo one, and set a least-privilege permissions block (default read, elevate per job). Federate to the cloud with OIDC (short-lived) rather than a long-lived stored credential.
- Run integration tests against real service containers, not a mock - a suite green against a stub proves nothing about the wired system.
- Add a security-scan stage past the dependency audit - a secret scanner (gitleaks) failing the build on a committed credential, and a Trivy scan of the built image gating CRITICAL/HIGH; run the dependency + image scans on a cron schedule off the PR path too, so a CVE disclosed against an already-merged clean dependency is still caught.
- Set timeout-minutes on every job so a hung step is killed in minutes instead of burning the runner's full default budget.
- Add a concurrency group keyed on workflow + ref with cancel-in-progress: true, so a fast follow-up push cancels the now-stale run instead of queueing behind it.
- Upload diagnostic artifacts on failure only (if: failure()) - test results and logs with a short retention - so a red run is debuggable without a rerun.
