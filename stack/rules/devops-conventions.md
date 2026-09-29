---
paths: ["**/Dockerfile", "**/Dockerfile.*", "**/*.Dockerfile", "**/docker-compose*.yml", "**/docker-compose*.yaml", "**/compose*.yml", "**/compose*.yaml", "**/.github/workflows/*.yml", "**/.github/workflows/*.yaml", "**/.github/actions/**/action.yml", "**/.github/actions/**/action.yaml", "**/azure-pipelines*.yml", "**/azure-pipelines*.yaml", "**/.gitlab-ci.yml", "**/deploy*.sh", "**/deploy*.ps1", "**/.env.example", "**/.env.template", "**/*.env.example", "**/*.env.template"]
---

Editing a container build, a compose topology, a CI/CD pipeline, a deploy script or an env template -
load `devops`: the FIRST action after this rule attaches is that Skill call, before the NEXT edit lands
(a path-scoped rule attaches ON the touch, so it can never precede its own trigger) - skip the load
when it is already in context (the devops seats preload it); conventions are the source of truth, not
recall. Name the skill you loaded, or say it was already in context - the receipt is what makes the
load happen.

Covers Dockerfiles, compose files, GitHub Actions workflows and actions, Azure Pipelines, GitLab CI,
`deploy*.sh` / `deploy*.ps1` and env templates (`.env.example`, `*.env.template`) - the delivery
surface. Skip one-line tweaks.

<!-- Maintainer note: the deploy-script globs are a deliberate widening - a session that edits only a
     deploy script touches no Dockerfile, so the rule that names the concern could never reach it. The
     pipeline and env-template globs (audit M73) cover what the devops skill's own description claims;
     guard-read-whole-file.js's CONVENTION_RULES row is this list's shell-route twin. -->
