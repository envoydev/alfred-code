'use strict';
// One compose project per cell. The fixture's compose.yaml names no project, so every cell's `docker compose up`
// landed in the project named for its folder - `repo`, the same for every cell: pilot 3 left `repo-db-1` up, and
// two cells rewrote each other's migration history in that one database. Each session gets its own
// COMPOSE_PROJECT_NAME, and the driver takes down exactly that project - its containers, networks and volumes -
// before the session (what a killed attempt of the same cell left) and after it. Never another project: `-p` names
// it, and the command runs in the cell's work dir, above the clone, so no compose file the session edited is read.
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const DOWN_TIMEOUT_MS = 2 * 60 * 1000;
const PROJECT = /^[a-z0-9][a-z0-9_-]*$/;

// Neutral on purpose: a session reads the name in `docker ps` and its env, so it names neither the benchmark nor
// the arm. Stable per cell, so a resumed cell finds what its killed attempt left.
function composeProject(cell)
{
    const id = `${cell.run}/${cell.arm}/${cell.task}/r${cell.rep}`;
    return `cell-${crypto.createHash('sha256').update(id).digest('hex').slice(0, 12)}`;
}

// A failed or impossible teardown is recorded, never thrown: the cell's result is its session's.
function composeDown({ project, env, cwd, docker = ['docker'] })
{
    if (typeof project !== 'string' || !PROJECT.test(project)) throw new Error(`'${project}' is not a compose project name - nothing is taken down`);
    const r = spawnSync(docker[0], [...docker.slice(1), 'compose', '-p', project, 'down', '-v'], { cwd, env, stdio: 'ignore', timeout: DOWN_TIMEOUT_MS, killSignal: 'SIGKILL' });
    return { exit: r.status, error: r.error ? (r.error.code || r.error.message) : null };
}

module.exports = { composeProject, composeDown };
