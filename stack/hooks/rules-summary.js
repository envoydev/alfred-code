#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
//
// rules-summary.js - the native rules summary line the prompt reminder carries (communication-reminder.js requires it):
// how many `.claude/rules` files Claude Code holds in context, a count pair per level from the topmost ancestor below the
// home folder down to the session folder, then each touched child's total. A module, never a hook: no `main`, nothing wired.
// `noteTouch` has its caller in the edit-time reminder (file-guards). Every function fails open.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathGlob, pathsOf, mdFiles, RULE_FILES } = require(path.join(__dirname, 'rules-session.js'));

// THE SUMMARY LINE (card 'Layered native rules', 2026-11-23): how many native rules Claude Code holds in context, one count
// pair per level from the topmost ancestor below the home folder down to the session folder, then each touched child's total.
const SUMMARY_HEAD = 'Native rules, full text in context - follow them: ';
const SETTINGS_FILES = ['settings.local.json', 'settings.json'];
const touchFile = (session) => `rules-touched-${String(session || 'nosession').replace(/[^\w.-]/g, '_')}.json`;
const homeOf = (env) => path.resolve(env.HOME || env.USERPROFILE || require('node:os').homedir());
const realOf = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

// The claudeMdExcludes patterns of the given folders' settings files (local first; the callers pass the session folder alone), each as a RegExp; a pattern that
// is no glob is dropped. They match an absolute path without its leading separator.
function excludesOf(folders)
{
    const patterns = folders.flatMap((dir) => SETTINGS_FILES.flatMap((f) =>
    {
        const list = (readJson(path.join(dir, '.claude', f)) || {}).claudeMdExcludes;
        return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
    }));
    return patterns.map(pathGlob).filter(Boolean);
}
const asGlobPath = (file) => file.split(path.sep).join('/').replace(/^\//, '');

// The rule files of one folder that count, as { always, scoped }: a `paths:` frontmatter makes a rule scoped; an excluded one is out.
function countRules(root, excludes)
{
    const counts = { always: 0, scoped: 0 };
    const dir = path.join(root, ...RULE_FILES);
    for (const f of mdFiles(dir))
    {
        const file = path.join(dir, f);
        if (excludes.some((re) => re.test(asGlobPath(file)))) continue;
        let text = '';
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        counts[pathsOf(text).length ? 'scoped' : 'always'] += 1;
    }
    return counts;
}

// Every folder from the topmost ancestor below the home folder (or the filesystem root) down to `start`, top first.
function ancestorsOf(start, env)
{
    const home = realOf(homeOf(env));
    const out = [];
    for (let at = realOf(start); at !== path.dirname(at) && at !== home; at = path.dirname(at)) out.unshift(at);
    return out;
}

// The levels that hold native rules: [{ root, name, always, scoped }], top first, after the settings' claudeMdExcludes.
function levelsOf(start, env = process.env)
{
    const folders = ancestorsOf(start, env);
    const excludes = excludesOf([realOf(start)]);
    return folders.map((root) => ({ root, name: path.basename(root), ...countRules(root, excludes) })).filter((l) => l.always + l.scoped > 0);
}

// The touched-children record of a session: the child roots (folders below the project holding their own `.claude/rules`)
// a file was touched in. Never throws.
function touchedOf(project, sessionId, env = process.env)
{
    try
    {
        const list = readJson(require(path.join(__dirname, 'layout.js')).statePath(project, 'sessions', touchFile(sessionId), env));
        return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
    }
    catch { return []; }
}

// True when `at` sits strictly below `top` on the same drive: the relative path is no parent step and no absolute path
// (a file on another Windows drive relates to `top` as an absolute path). `pathModule` lets a test use path.win32.
function isBelow(top, at, pathModule = path)
{
    const rel = pathModule.relative(top, at);
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${pathModule.sep}`) && !pathModule.isAbsolute(rel);
}

// The real path of `file`'s folder, or of its nearest existing ancestor with the rest appended as given.
function realFolderOf(file)
{
    const tail = [];
    let at = path.dirname(path.resolve(file));
    for (; at !== path.dirname(at); at = path.dirname(at))
    {
        try { return path.join(fs.realpathSync.native(at), ...tail.reverse()); }
        catch { tail.push(path.basename(at)); }
    }
    return path.join(at, ...tail.reverse());
}

// Add to the record each child root `file` sits in below `project` (both real-pathed, the roots stored real). Never throws.
function noteTouch(project, sessionId, file, env = process.env)
{
    try
    {
        const top = realOf(project);
        const kept = touchedOf(project, sessionId, env);
        const found = [];
        for (let at = realFolderOf(file); isBelow(top, at); at = path.dirname(at))
            if (mdFiles(path.join(at, ...RULE_FILES)).length) found.push(at);
        const fresh = found.filter((root) => !kept.includes(root));
        if (!fresh.length) return;
        const target = require(path.join(__dirname, 'layout.js')).statePath(project, 'sessions', touchFile(sessionId), env);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, JSON.stringify([...kept, ...fresh]));
    }
    catch { /* the record is a hint */ }
}

// The one line the prompt reminder carries; '' when no level holds a rule. Never throws.
function summaryLine(start, sessionId, env = process.env)
{
    try
    {
        const levels = levelsOf(start, env);
        if (!levels.length) return '';
        const shown = new Set(levels.map((l) => l.root));
        const excludes = excludesOf([realOf(start)]);
        const touched = touchedOf(start, sessionId, env).filter((root) => !shown.has(root)).map((root) =>
        {
            const n = countRules(root, excludes);
            return { name: path.basename(root), total: n.always + n.scoped };
        }).filter((c) => c.total > 0);
        return SUMMARY_HEAD + [...levels.map((l) => `${l.name} (${l.always} always-on, ${l.scoped} by path)`), ...touched.map((c) => `${c.name} (${c.total})`)].join(' + ');
    }
    catch { return ''; }
}

module.exports = { levelsOf, touchedOf, noteTouch, summaryLine, isBelow };
