'use strict';

// The ranked docs versioning answer and the remover's test - pure: values in, values out (spec D2, D3).
const { KEY, VALUES, RANK } = require('./constants.js');

// `firm` is the seed rule's advice, { value, firm }. In a linked child whose chain holds a value the reseed is skipped:
// the stack's own local seed leaves through the remover, so one scope change rewrites the git files once.
function rankVersioning({ flag, carry, reseed, own, firm, chain, linked })
{
    if (flag) return { value: flag, source: RANK.flag };
    if (carry) return { value: carry, source: RANK.carry };
    if (reseed && !(linked && chain)) return { value: reseed, source: RANK.reseed };
    if (own) return { value: own, source: RANK.own };
    if (firm && firm.firm) return { value: firm.value, source: RANK.firm };
    if (chain) return { value: chain, source: RANK.chain };
    return { value: firm ? firm.value : VALUES.git, source: RANK.seed };
}

// D3's remover rule: a linked child whose chain holds a value loses its own line when it is at its ledger hash, is no
// answer, and either the seed rule's answer is not firm or equals the chain's. `answeredEnv` is the stamp's answered
// keys (a list or a set), or a plain flag for this key.
function seedLeaves({ value, atLedgerHash, answeredEnv, firm, chain, linked })
{
    if (!linked || chain === undefined || !atLedgerHash) return false;
    const answered = Array.isArray(answeredEnv) || answeredEnv instanceof Set ? [...answeredEnv].includes(KEY) : Boolean(answeredEnv);
    if (answered) return false;
    return !firm || value === chain;
}

module.exports = { rankVersioning, seedLeaves };
