'use strict';

// What the pass does with one agent folder's `.gitignore` - values in, a verdict out (workspace versioning, D4).
const {
    FOLDER, STACK_TEXTS, ACTION, SCOPE_LOCAL, VERSIONING_LOCAL, trackedNotice, ownNotice, ownEntry,
    CLAUDE_IGNORE, CLAUDE_VERSIONING_IGNORE, CURSOR_VERSIONING_IGNORE,
} = require('./constants.js');

const isStackText = (text) => typeof text === 'string' && STACK_TEXTS.includes(text);

// The text this folder should hold, or null. `.claude`: a local install keeps its own text, else versioning `local`
// writes the versioning one. `.cursor`: versioning `local`, at any scope.
function wantedText({ folder, scope, versioning })
{
    if (folder === FOLDER.claude)
    {
        if (scope === SCOPE_LOCAL) return CLAUDE_IGNORE;
        return versioning === VERSIONING_LOCAL ? CLAUDE_VERSIONING_IGNORE : null;
    }
    if (folder === FOLDER.cursor) return versioning === VERSIONING_LOCAL ? CURSOR_VERSIONING_IGNORE : null;
    return null;
}

// `have`: the file's text, null when absent. `tracked`: git tracks a file under the folder. `told`, `created`: the stamp's
// records. A file that is not the stack's text is the project's: never rewritten or removed, named once (`own:<folder>`)
// where the stack would have written. Not in a repository, no versioning text is written (a local install's own text keeps
// the behaviour it had before this pass). A folder git tracks files in gets no file and one notice, said once. An unread
// versioning (null) decides nothing. `dir: true` on a remove says the folder was made by the stack, so the caller takes it
// too once it is empty.
function folderPlan({ folder, scope, versioning, have = null, tracked = false, inRepo = true, told = [], created = [] })
{
    const text = wantedText({ folder, scope, versioning });
    // An unread docs versioning (null) changes nothing the answer decides; a local install's own `.claude` text does not depend on it.
    if (versioning == null && !(folder === FOLDER.claude && scope === SCOPE_LOCAL)) return { action: ACTION.keep };
    if (have !== null && !isStackText(have))
        return text !== null && (inRepo || text === CLAUDE_IGNORE) && !told.includes(ownEntry(folder)) ? { action: ACTION.tell, line: ownNotice(folder, text), entry: ownEntry(folder) } : { action: ACTION.keep };
    if (text === null) return have === null ? { action: ACTION.keep } : { action: ACTION.remove, dir: created.includes(folder) };
    if (have === text || (!inRepo && text !== CLAUDE_IGNORE)) return { action: ACTION.keep };
    if (have === null && tracked) return told.includes(folder) ? { action: ACTION.keep } : { action: ACTION.tell, line: trackedNotice(folder, text), entry: folder };
    return { action: ACTION.write, text };
}

module.exports = { folderPlan, wantedText, isStackText };
