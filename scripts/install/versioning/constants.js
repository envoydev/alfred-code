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

module.exports = { KEY, VALUES, RANK };
