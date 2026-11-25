'use strict';

const NAME_ONLY = 'name-only';

const ROOT_SKILLS = Object.freeze({ key: 'ALFRED_CODE_ROOT_SKILLS', own: 'own', all: 'all' });

const CATALOG_FILES = Object.freeze({
    evidence: 'evidence.json',
    graph: 'stack-graph.json',
    recommendations: 'recommendations.json',
});

const META_DIR = 'meta';

const CAP_LINE = '!! workspace: the root\'s file walk stopped at depth 6 - no skill is trimmed to its name this run';

const trimLogLine = (name) => `  skills: ${name} listed by name at the root - no root file needs it; to list it in full: set "skillOverrides": { "${name}": "on" } in .claude/settings.local.json`;

const catalogLine = (file) => `!! workspace: ${file} could not be read - no skill is trimmed to its name this run`;

const sameRepoLine = (rel) => `skills: nothing listed by name at the root - ${rel} shares its repository`;

const failureLine = (message) => `!! workspace: the skills listed by name could not be worked out (${message}) - no skill is trimmed to its name this run`;

module.exports = { NAME_ONLY, ROOT_SKILLS, CATALOG_FILES, META_DIR, CAP_LINE, trimLogLine, catalogLine, sameRepoLine, failureLine };
