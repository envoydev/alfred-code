'use strict';
// Layered native rules: each picked rule is written to `.claude/rules/<name>.md` with a marker line, so Claude Code loads
// it itself. The store (`.alfred/stack/rules`) stays the source. A file without the marker is the user's and is never
// touched; a marked one is the stack's, rewritten when the store text moves and removed when the rule is no longer picked.
const fs = require('node:fs');
const path = require('node:path');
const links = require('./links.js');
const { MARKER, CHILD_WINS_LINE, RULES_DIR_PARTS, AWARENESS_FILE, FRONTMATTER_FENCE, RULE_PICK, LOG, REMOVED_WHY } = require('./native-rules-constants.js');

const rulesDirOf = (projectRoot) => path.join(projectRoot, ...RULES_DIR_PARTS);
const lstatOf = (file) => fs.lstatSync(file, { throwIfNoEntry: false }) || null;
const readText = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n');

// Where the text after the frontmatter starts (0 with none): the index just past the closing fence line and its line end.
function bodyStart(text)
{
    const eol = eolOf(text);
    if (!text.startsWith(`${FRONTMATTER_FENCE}${eol}`)) return 0;
    const close = text.indexOf(`${eol}${FRONTMATTER_FENCE}`, FRONTMATTER_FENCE.length);
    if (close === -1) return 0;
    const afterFence = close + eol.length + FRONTMATTER_FENCE.length;
    if (afterFence === text.length) return -1;   // the fence ends the text: the body starts after a line end the text lacks
    return text.startsWith(eol, afterFence) ? afterFence + eol.length : 0;
}

// `line` as the first line after the frontmatter, in the text's own line ending; the text as it is when it is there already.
function withLineAfterFrontmatter(text, line)
{
    const eol = eolOf(text);
    const start = bodyStart(text);
    if (start === -1) return `${text}${eol}${line}${eol}`;
    if (text.startsWith(`${line}${eol}`, start) || text.slice(start) === line) return text;
    return `${text.slice(0, start)}${line}${eol}${text.slice(start)}`;
}

const withMarker = (text) => withLineAfterFrontmatter(text, MARKER);

function hasMarker(text)
{
    if (typeof text !== 'string') return false;
    const start = bodyStart(text);
    if (start === -1) return false;
    const eol = eolOf(text);
    return text.startsWith(`${MARKER}${eol}`, start) || text.slice(start) === MARKER;
}

// The rule names an ordinary pick list holds: `rule/<name>` (the card's spelling) and `rule <name>` (stamp.js readOwnPicks).
const ruleNamesOf = (picks) => (picks || []).map((p) => RULE_PICK.exec(p)).filter(Boolean).map((m) => m[1]);

// The rules this project writes natively: a root or standalone project takes every library rule except one only a member
// picked; a child takes its own rule picks that no chain root above holds natively.
// `child` defaults to a non-empty `chainRoots`; a joined child whose chain is unreadable passes it true.
function nativeNames({ projectRoot, library, ownPicks = [], memberPicks = [], chainRoots = [], child = chainRoots.length > 0 })
{
    const own = ruleNamesOf(ownPicks);
    if (child)
        return [...new Set(own)].filter((name) => !chainRoots.some((root) => lstatOf(path.join(rulesDirOf(root), `${name}.md`))));
    const memberOnly = new Set(ruleNamesOf(memberPicks).filter((name) => !own.includes(name)));
    return Object.keys((library && library.rules) || {}).filter((name) => !memberOnly.has(name));
}

// Writes `.claude/rules/<name>.md` = withMarker(store text), only when the bytes differ. A target without the marker, or a
// link, is the user's: kept and named. A name with no store text is skipped.
function writeNative({ projectRoot, names, sourceOf, log = () => {} })
{
    const out = { written: [], updated: [], kept: [] };
    for (const name of names)
    {
        const source = sourceOf(name);
        const stackText = source ? readText(source) : null;
        if (stackText === null) continue;
        const target = path.join(rulesDirOf(projectRoot), `${name}.md`);
        const want = withMarker(stackText);
        const at = lstatOf(target);
        if (at && (at.isSymbolicLink() || !at.isFile() || !hasMarker(readText(target))))
        {
            out.kept.push(name);
            log(LOG.keptUnmarked(name));
            continue;
        }
        if (at && readText(target) === want) continue;
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, want);
        (at ? out.updated : out.written).push(name);
    }
    return out;
}

// Removes each marked `.claude/rules/*.md` not in `keep`. In a child also each `<childName>.<rule>.md` of a shipped rule that
// carries the marker or holds the stack's own text; one at any other text is the user's: kept and named.
function pruneNative({ projectRoot, keep, childName, shipped, sourceOf, log = () => {} })
{
    const out = { removed: [], kept: [] };
    const dir = rulesDirOf(projectRoot);
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort(); } catch { return out; }
    const stackTextOf = (rule) => { const source = sourceOf(rule); return source ? readText(source) : null; };
    const remove = (file, name, why) => { fs.unlinkSync(path.join(dir, file)); out.removed.push(name); log(LOG.removed(name, why)); };
    for (const file of files)
    {
        const name = file.slice(0, -3);
        const at = lstatOf(path.join(dir, file));
        if (!at || !at.isFile()) continue;
        const text = readText(path.join(dir, file));
        const childRule = childName && shipped.find((rule) => name === `${childName}.${rule}`);
        if (hasMarker(text)) { if (!keep.includes(name)) remove(file, name, REMOVED_WHY.unpicked); continue; }
        if (!childRule) continue;
        const stackText = stackTextOf(childRule);
        if (stackText !== null && text === stackText) remove(file, name, REMOVED_WHY.childCopy);
        else { out.kept.push(name); log(LOG.keptChildCopy(name)); }
    }
    return out;
}

// Uninstall: every marked file in `.claude/rules` goes (it is the stack's text); an unmarked one is the user's and stays.
function removeNative({ projectRoot, log = () => {} })
{
    const removed = [];
    const dir = rulesDirOf(projectRoot);
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort(); } catch { return removed; }
    for (const file of files)
    {
        const at = lstatOf(path.join(dir, file));
        if (!at || !at.isFile() || !hasMarker(readText(path.join(dir, file)))) continue;
        fs.unlinkSync(path.join(dir, file));
        removed.push(file.slice(0, -3));
        log(`  rule removed: ${file.slice(0, -3)} (native)`);
    }
    return removed;
}

// A root whose record lists a child: its awareness rule carries the child-wins line after the frontmatter; with no child
// the line goes. True when the file changed. The capture's writer (awareness-state.js) writes the same bytes.
function ensureChildWins({ projectRoot, hasChildren })
{
    const file = path.join(rulesDirOf(projectRoot), AWARENESS_FILE);
    const text = readText(file);
    if (text === null || !lstatOf(file).isFile()) return false;
    let next = text;
    if (hasChildren) next = withLineAfterFrontmatter(text, CHILD_WINS_LINE);
    else
    {
        const eol = eolOf(text);
        const start = bodyStart(text);
        if (start >= 0 && text.startsWith(`${CHILD_WINS_LINE}${eol}`, start)) next = `${text.slice(0, start)}${text.slice(start + CHILD_WINS_LINE.length + eol.length)}`;
    }
    if (next === text) return false;
    fs.writeFileSync(file, next);
    return true;
}

// One run's pass over a project: the child-wins line, then the native files of the rules this project picks, then the prune.
// `child` is null for a root or standalone project, else { holders: the chain roots, parentLines: the lines it inherits }.
function syncNative({ projectRoot, rulesDir, child, listedRules, heldRules, library, shippedRules, hasChildren, log = () => {} })
{
    ensureChildWins({ projectRoot, hasChildren });
    if (rulesDir !== links.storeOf(projectRoot, 'rules')) return { written: [], updated: [], kept: [], removed: [], names: [] };   // the store was not made: rules stay in .claude
    const chainRoots = child ? child.holders : [];
    const inherited = new Set(child ? child.parentLines.filter((l) => l.startsWith('rule ')).map((l) => l.slice(5)) : []);
    const stores = [rulesDir, ...chainRoots.map((root) => links.storeOf(root, 'rules'))];
    const sourceOf = (name) => stores.map((dir) => path.join(dir, `${name}.md`)).find((file) => fs.existsSync(file)) || null;
    const names = nativeNames({ projectRoot, library, chainRoots, child: Boolean(child),
        ownPicks: listedRules.filter((name) => !inherited.has(name)).map((name) => `rule/${name}`), memberPicks: heldRules.map((name) => `rule/${name}`) });
    const wrote = writeNative({ projectRoot, names, sourceOf, log });
    const pruned = pruneNative({ projectRoot, keep: names, childName: child ? path.basename(projectRoot) : null, shipped: shippedRules, sourceOf, log });
    return { ...wrote, removed: pruned.removed, names };
}

module.exports = { syncNative, MARKER, CHILD_WINS_LINE, withMarker, hasMarker, nativeNames, writeNative, pruneNative, removeNative, ensureChildWins };
