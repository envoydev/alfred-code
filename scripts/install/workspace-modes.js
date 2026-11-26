'use strict';
// The installer's readers of a workspace member's mode file (mode inheritance D3b), beside workspace.js: `chainModes`, the
// mode keys a member's MODE FILE wins in the loader, and the carry a leaving child takes into its own mode file. workspace.js
// is past the size rule, so the new code sits here; its `chain`, `readWorkspace` and `realOf` are required inside each
// function, since workspace.js requires this file first.
const path = require('node:path');
const layout = require('../../stack/hooks/layout.js');
const { readJson } = require('./json-file.js');

const FOREIGN_FILE = 'the mode file is another checkout\'s';
const plain = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);

// chainValues' sibling for the mode keys: the keys a member's MODE FILE wins in the loader, with the loader's own order -
// nearest member first, a member's mode file ahead of its `.variables`, `ignore env K` lines stopping K from that member
// on - and a mode file read only where the member owns it. Only pruneChained reads it: chainValues stays on the members'
// `.variables`, which envPlan and settings.js applyEnv compare an answer with, and neither may read one person's
// untracked file.
function chainModes(projectRoot, { env = process.env } = {})
{
    const { chain, readWorkspace, realOf } = require('./workspace.js');
    const won = new Set();
    if (!layout.workspaceOn({ env, projectRoot })) return won;
    const modeKeys = new Set(layout.MODE_KEYS);
    const decided = new Set();
    const { members } = chain(projectRoot);
    const skip = new Set((readWorkspace(realOf(projectRoot)).view.ignores || []).filter((i) => i.category === 'env').map((i) => i.name));
    for (const member of members)
    {
        const read = layout.readDotenv(path.join(member.root, ...member.dataRoot.split('/'), '.variables'));
        const modeFile = layout.modeFile(member.root);
        const owned = layout.pathKey(path.dirname(modeFile)) === layout.pathKey(path.join(member.root, '.claude'));
        const data = owned ? readJson(modeFile) : null;
        const modeEnv = data && plain(data.env) ? data.env : null;
        for (const key of layout.VARIABLE_KEYS)
        {
            if (layout.MEMBER_NEVER.has(key) || skip.has(key) || decided.has(key)) continue;
            if (modeKeys.has(key) && layout.valueIn(modeEnv, key) !== undefined) { won.add(key); decided.add(key); }
            else if (read && layout.valueIn(read.values, key) !== undefined) decided.add(key);
        }
        for (const i of member.view.ignores || []) if (i.category === 'env') skip.add(i.name);
    }
    return won;
}

// What a leaving child took from a member's mode file, read while the chain still holds (keepOnLeave) and written by
// `carryModes` once the unlink holds: { updates, rels, writeEnv, autoRunFrom }, or null when there is nothing to carry.
// Auto-run is no variable and is not carried: it ends at the leave, and `autoRunFrom` names the member whose own,
// untracked `1` stood.
function modeCarryOf(root, { env, values, from, modeUpdates })
{
    const { autoRunInherited } = require('../../stack/hooks/mode-settings.js');
    const standing = autoRunInherited(root, env);
    const keys = Object.keys(modeUpdates);
    const autoRunFrom = standing && standing.held === 'own' ? standing.from : null;
    if (!keys.length && autoRunFrom === null) return null;
    return { updates: modeUpdates, rels: [...new Set(keys.map((k) => from[k]))].join(', '), writeEnv: { ...env, ...values }, autoRunFrom };
}

// The carry's write, run only after the child is unlinked: the keys go into the child's OWN mode file through the one
// writer, never into the tracked `.variables`. A refused write (git tracks the file, or it cannot be read) keeps nothing
// and says so; the leave goes on. Returns the keys written.
function carryModes(root, carry, { log = () => {} } = {})
{
    if (!carry) return [];
    const { writeModes, WHY, said } = require('../../stack/hooks/mode-settings.js');
    if (carry.autoRunFrom !== null)
        log(`workspace: auto-run was inherited from ${carry.autoRunFrom} - it ends here; /alfred-code:mode:auto-run on in this project keeps it`);
    const keys = Object.keys(carry.updates);
    if (!keys.length) return [];
    const r = require('./modes.js').ownsModeFile(root) ? writeModes(root, carry.updates, carry.writeEnv) : { why: 'foreign' };
    if (r.why)
    {
        log(`!! workspace: ${keys.join(', ')} were inherited from ${carry.rels}'s mode file and could not be kept here (${WHY[r.why] || FOREIGN_FILE}) - they read the stack's defaults now`);
        return [];
    }
    log(`workspace: ${keys.length} ${keys.length === 1 ? 'value' : 'values'} this project read from ${carry.rels}'s mode file written into its own .claude/settings.local.json (${keys.join(', ')}) - each reads the same after it leaves${said(r)}`);
    return keys;
}

module.exports = { chainModes, modeCarryOf, carryModes };
