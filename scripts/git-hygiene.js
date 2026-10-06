#!/usr/bin/env node
'use strict';
// THE DATA ROOT'S GIT LINE - whether `.alfred/` (ALFRED_CODE_DATA_PATH) should be ignored by the repo, and the
// write on the user's answer. The root carries its own `.gitignore` (stack/mcp/data-root.js dataIgnoreText), which
// re-includes itself and the docs folder so committed docs reach a teammate's clone - so git always lists the root
// as untracked (`?? .alfred/`). Where nothing under it is meant to be committed - the docs root sits elsewhere, or
// the docs are machine-local (ALFRED_CODE_DOCS_VERSIONING=local) - that line is noise, and the guided commands
// offer one ignore line for it (the user's report of 2026-10-06: '.alfred/ is not suggested to be added to git
// ignore or git exclude'). Read-only unless `--apply` names the home the user picked.
//
//   node scripts/git-hygiene.js --root <project> [--apply gitignore|exclude]
//
// Prints ONE line:
//   git-hygiene: offer <root>/<TAB><why>                  nothing under the root is committed or meant to be
//   git-hygiene: none (<why>)                             no repository, already ignored, or it holds committed docs
//   git-hygiene: applied <file>: /<root>/                 the line written (--apply), git now ignores the root
//   git-hygiene: current <file>                           the line was already there
// Exit 0, or 1 on a usage error or a write that failed.
const fs = require('node:fs');
const path = require('node:path');
const rt = require('./install/runtime.js');

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : ''; };
const git = (args, cwd) => String(rt.execCommand('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).trim();
const posix = (p) => p.split(path.sep).join('/');

// { state: 'offer' | 'none', root, why, top? } - the decision, with no write.
function dataRootOffer({ projectRoot })
{
    const dataRoot = require('../stack/mcp/data-root.js');
    const { settingFrom } = require('../stack/mcp/uv-python.js');
    // Settings only, never a shell export: a settings value applies over one, and the installer reads it so.
    const root = dataRoot.dataRootOf({ env: {}, projectDir: projectRoot }).root;
    const none = (why) => ({ state: 'none', root, why });
    let top;
    try { top = git(['rev-parse', '--show-toplevel'], projectRoot); }
    catch { return none('not a git repository'); }
    // Probe the root's own .gitignore, which that file re-includes: only a rule OUTSIDE the root ignores it. Asking
    // about `<root>/` itself matched the root's own `/*` (measured, git 2.x) and read every root as ignored.
    try { git(['check-ignore', '-q', '--', `${root}/.gitignore`], projectRoot); return none(`${root}/ is already ignored`); }
    catch { /* not ignored: read on */ }
    let tracked = '';
    try { tracked = git(['ls-files', '--', root], projectRoot); } catch { tracked = ''; }
    if (tracked) return none(`git tracks files under ${root}/ - committed docs stay committed`);
    const docsPath = settingFrom({ env: {}, projectDir: projectRoot, suffix: 'DOCS_PATH' }) || `${root}/docs`;
    const rel = path.posix.relative(root, docsPath.replace(/\\/g, '/').replace(/^\.\//, ''));
    const docsInside = rel && !rel.startsWith('..') && !path.posix.isAbsolute(rel);
    let versioning = null;
    try { versioning = require('./install/copy.js').resolveDocsVersioning(projectRoot); } catch { versioning = null; }
    if (docsInside && versioning !== 'local')
        return none(`the docs under ${root}/ are committed (ALFRED_CODE_DOCS_VERSIONING=${versioning || 'git'})`);
    const why = docsInside ? `its docs are machine-local (ALFRED_CODE_DOCS_VERSIONING=local) and the rest is machine state`
        : `the docs root is ${docsPath}, outside it - everything under ${root}/ is machine state`;
    return { state: 'offer', root, why, top };
}

// The line goes to the project's own `.gitignore` (committed - the team shares it) or the repo's
// `.git/info/exclude` (this clone only, no committed file touched). Anchored, so a nested folder of the same
// name elsewhere is untouched; the exclude file's patterns are relative to the top level.
function applyIgnore({ projectRoot, home })
{
    const offer = dataRootOffer({ projectRoot });
    if (offer.state !== 'offer') return { state: 'none', why: offer.why };
    let file;
    let line;
    if (home === 'gitignore')
    {
        file = path.join(projectRoot, '.gitignore');
        line = `/${offer.root}/`;
    }
    else
    {
        file = path.resolve(projectRoot, git(['rev-parse', '--git-path', 'info/exclude'], projectRoot));
        const fromTop = posix(path.relative(fs.realpathSync.native(offer.top), fs.realpathSync.native(projectRoot)));
        line = `/${fromTop ? `${fromTop}/` : ''}${offer.root}/`;
    }
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { text = ''; }
    if (text.split(/\r?\n/).some((l) => l.trim() === line)) return { state: 'current', file };
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lead = text && !/\r?\n$/.test(text) ? eol : '';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${lead}# alfred-code: the data root (ALFRED_CODE_DATA_PATH) is machine-local${eol}${line}${eol}`);
    return { state: 'applied', file, line };
}

function main()
{
    const projectRoot = path.resolve(arg('--root') || '.');
    const home = arg('--apply');
    if (home && !['gitignore', 'exclude'].includes(home))
    {
        console.error("usage: git-hygiene.js --root <project> [--apply gitignore|exclude]");
        return 1;
    }
    if (!home)
    {
        const o = dataRootOffer({ projectRoot });
        console.log(o.state === 'offer' ? `git-hygiene: offer ${o.root}/\t${o.why}` : `git-hygiene: none (${o.why})`);
        return 0;
    }
    try
    {
        const r = applyIgnore({ projectRoot, home });
        const shown = (f) => posix(path.relative(projectRoot, f)) || f;
        if (r.state === 'applied') console.log(`git-hygiene: applied ${shown(r.file)}: ${r.line}`);
        else if (r.state === 'current') console.log(`git-hygiene: current ${shown(r.file)}`);
        else console.log(`git-hygiene: none (${r.why})`);
        return 0;
    }
    catch (err)
    {
        console.error(`git-hygiene: the line could not be written (${err.message})`);
        return 1;
    }
}

if (require.main === module) process.exitCode = main();
module.exports = { dataRootOffer, applyIgnore };
