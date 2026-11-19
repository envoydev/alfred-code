'use strict';

const RECORD_KIND = Object.freeze({ skill: 'skill', agent: 'agent' });

const VIEW_MAP = Object.freeze({ skill: 'skills', agent: 'agents' });

const LEDGER_ROW = Object.freeze({
    skill: Object.freeze({ prefix: 'skills/', suffix: '' }),
    agent: Object.freeze({ prefix: 'agents/', suffix: '.md' }),
});

module.exports = { RECORD_KIND, VIEW_MAP, LEDGER_ROW };
