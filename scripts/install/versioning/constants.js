'use strict';

// The docs versioning variable, the two values it takes, and where a ranked answer came from (spec D2).
const KEY = 'ALFRED_CODE_DOCS_VERSIONING';

const VALUES = Object.freeze({ git: 'git', local: 'local' });

const RANK = Object.freeze({
    flag: 'flag',
    carry: 'carry',
    reseed: 'reseed',
    own: 'own',
    firm: 'firm',
    chain: 'chain',
    seed: 'seed',
});

// The notices (spec D6b, D7). The marker sits on the data root's `.gitignore` head line; a told entry records a value said once.
const MARKER_PATTERN = new RegExp(`${KEY}=(${Object.values(VALUES).join('|')})`);
const SHARED_SCOPES = Object.freeze(['project', 'user']);
const TOLD = Object.freeze({ chained: 'versioning:', pulled: 'versioning-pulled:' });

const chainedNotice = (value, seed) => `docs versioning ${value} comes from the workspace and changed .alfred/.gitignore, which git tracks - teammates without the workspace read ${seed}; set ${KEY} here to share it`;
const pulledNotice = (value, chain) => `docs versioning ${value} in .variables came from another machine and outranks the workspace's ${chain} - remove the line to inherit, or keep it to share ${value}`;
const lagNotice = (rel, value) => `workspace: ${rel} reads versioning ${value} from here - its .gitignore files follow at its next update`;

module.exports = { KEY, VALUES, RANK, MARKER_PATTERN, SHARED_SCOPES, TOLD, chainedNotice, pulledNotice, lagNotice };
