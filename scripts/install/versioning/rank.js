'use strict';

// The ranked docs versioning answer and the remover's test - pure: values in, values out (spec D2, D3).
const { KEY, VALUES, RANK } = require('./constants.js');

// A value as the key holds it: `git` or `local` in any case, anything else is no value.
function normaliseValue(raw)
{
    const value = String(raw ?? '').trim().toLowerCase();
    return value === VALUES.git || value === VALUES.local ? value : undefined;
}

// Whether the workspace chain's value answers a linked child (D10): it does unless the child's own layout holds a firm
// answer that differs from it (rankVersioning's order). `advice` is the seed rule's { value, firm }. Returns the value or
// undefined. The walk's default (`variables.js recommend --child`) and the seed (`stamp-docs-root.js --seed-versioning`) read it.
function chainAnswers({ chain, advice })
{
    return chain && !(advice && advice.firm && advice.value !== chain) ? chain : undefined;
}

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
// answer, and either the seed rule's answer is not firm or equals the chain's. A project outside any git repository
// (`noRepo`) holds no stack seed at all - only a chosen value chains - so its seed leaves under the same conditions with
// no chain needed. `answeredEnv` is the stamp's answered
// keys (a list or a set), or a plain flag for this key. `heldElsewhere`: a layer the loader reads between `.variables` and
// the members (settings.json, the account's, the launch env) holds a value - it would answer once the line left, so it stays.
function seedLeaves({ value, atLedgerHash, answeredEnv, firm, chain, linked, heldElsewhere = false, noRepo = false })
{
    const chained = linked && chain !== undefined;
    if ((!chained && !noRepo) || !atLedgerHash || heldElsewhere) return false;
    const answered = Array.isArray(answeredEnv) || answeredEnv instanceof Set ? [...answeredEnv].includes(KEY) : Boolean(answeredEnv);
    if (answered) return false;
    return noRepo || !firm || value === chain;
}

module.exports = { rankVersioning, seedLeaves, normaliseValue, chainAnswers };
