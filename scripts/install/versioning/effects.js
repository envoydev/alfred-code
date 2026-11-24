'use strict';

// The one place the ranked docs versioning answer reads the disk: the project's own value, the seed rule's advice, the
// workspace chain and the last stamp. Computed once per installer run; every later step reads it (spec D2).
const { KEY } = require('./constants.js');
const { rankVersioning, seedLeaves, normaliseValue } = require('./rank.js');
const copy = require('../copy.js');
const docs = require('../docs.js');
const stamp = require('../stamp.js');
const workspace = require('../workspace.js');

// The chain's value for the key, undefined when the workspace is off, unreadable or holds none.
function chainValueOf(projectRoot, env)
{
    try { return normaliseValue(workspace.chainValues(projectRoot, { env })[KEY]); }
    catch { return undefined; }
}

// `ledgerRows` (the stamp ledger's `.variables` rows) and `answeredEnv` (the stamp's answered keys): a null one is read
// from the project's own stamp, so a caller with no run context ranks as the installer does.
function effectiveVersioning({ projectRoot, scope, docsPath, dataRoot, env = process.env, flag = null, carry = null, reseed = null, ledgerRows = null, answeredEnv = null })
{
    const file = stamp.stampFiles({ projectRoot }).read;
    const at = scope || stamp.readStampScope(file || '');
    const rows = ledgerRows || (((stamp.readLedger(file) || {}).env || {})['.variables']) || {};
    const answered = answeredEnv || stamp.readAnsweredEnv(file);
    const chain = chainValueOf(projectRoot, env);
    const linked = chain !== undefined;
    const advice = docs.docsVersioningAdvice({ projectRoot, docsPath, scope: at, child: linked, dataRoot });
    let own = copy.resolveDocsVersioning(projectRoot, at) || undefined;
    const heldElsewhere = Boolean(workspace.layerHolding(projectRoot, KEY, { env }));
    if (own && seedLeaves({ value: own, atLedgerHash: rows[KEY] === stamp.valueHash(own), answeredEnv: answered, firm: advice.firm, chain, linked, heldElsewhere, noRepo: Boolean(advice.noRepo) })) own = undefined;
    const { value, source } = rankVersioning({ flag, carry, reseed, own, firm: advice, chain, linked });
    return { value, source, advice, linked, chain };
}

module.exports = { effectiveVersioning, chainValueOf };
