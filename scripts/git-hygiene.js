#!/usr/bin/env node
'use strict';
// THE DATA ROOT'S GIT LINE - whether `.alfred/` (ALFRED_CODE_DATA_PATH) should be ignored by the repo, and the
// write on the user's answer. The root carries its own `.gitignore` (stack/mcp/data-root.js dataIgnoreText), which
// re-includes itself and the docs folder so committed docs reach a teammate's clone - so git always lists the root
// as untracked (`?? .alfred/`). Where nothing under it is meant to be committed - the docs root sits elsewhere, or
// the docs are machine-local (ALFRED_CODE_DOCS_VERSIONING=local) - that line is noise, and the guided commands
// offer one ignore line for it (the user's report of 2026-10-06: '.alfred/ is not suggested to be added to git
// ignore or git exclude'). With `--local-child` (init's ask in a workspace child at `local` scope, which commits
// nothing it writes - the workspace spec, AC8) the root is offered whatever the docs mode, and a `.prettierignore` the
// run created is offered beside it; update and configure pass no flag, so their ask stays as it was.
// Read-only unless `--apply` names the home the user picked.
//
//   node scripts/git-hygiene.js --root <project> [--apply gitignore|exclude] [--local-child]
//
// Prints ONE line:
//   git-hygiene: offer <root>/<TAB><why>                  nothing under the root is committed or meant to be
//   git-hygiene: offer .prettierignore<TAB><why>          a second line, with --local-child only
//   git-hygiene: none (<why>)                             no repository, already ignored, or it holds committed docs
//   git-hygiene: applied <file>: /<root>/ [/.prettierignore]  the lines written (--apply), git now ignores them
//   git-hygiene: current <file>                           the line was already there
// Exit 0, or 1 on a usage error or a write that failed.
const fs = require('node:fs');
const path = require('node:path');
const rt = require('./install/runtime.js');

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : ''; };
const git = (args, cwd) => String(rt.execCommand('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).trim();
const posix = (p) => p.split(path.sep).join('/');

// A workspace child installed at `local` scope: the stamp's `scope: local` and a `parent` line in its workspace file.
function localChild(projectRoot)
{
    const stamp = require('./install/stamp.js');
    if (stamp.readStampScope(stamp.stampFiles({ projectRoot }).read) !== 'local') return false;
    return Boolean(require('./install/workspace.js').readWorkspace(projectRoot).view.parent);
}

// { state: 'offer' | 'none', root, why, top? } - the decision, with no write.
function dataRootOffer({ projectRoot, localChild: asked = false })
{
    const dataRoot = require('../stack/mcp/data-root.js');
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
    const docsPath = dataRoot.settingFrom({ env: {}, projectDir: projectRoot, suffix: 'DOCS_PATH' }) || `${root}/docs`;
    const rel = path.posix.relative(root, docsPath.replace(/\\/g, '/').replace(/^\.\//, ''));
    const docsInside = rel && !rel.startsWith('..') && !path.posix.isAbsolute(rel);
    let versioning = null;
    try { versioning = require('./install/copy.js').resolveDocsVersioning(projectRoot); } catch { versioning = null; }
    const child = asked && docsInside && versioning !== 'local' && localChild(projectRoot);
    if (docsInside && versioning !== 'local' && !child)
        return none(`the docs under ${root}/ are committed (ALFRED_CODE_DOCS_VERSIONING=${versioning || 'git'})`);
    const why = child ? 'a local install in a workspace - nothing it writes is meant to reach the repo' : docsInside ? `its docs are machine-local (ALFRED_CODE_DOCS_VERSIONING=local) and the rest is machine state`
        : `the docs root is ${docsPath}, outside it - everything under ${root}/ is machine state`;
    return { state: 'offer', root, why, top };
}

// The `.prettierignore` a local workspace child's run created (the stamp's `tool-ignores:` record) - git neither tracks
// nor ignores it, so a teammate never sees it and this clone does not list it. A file the project had is its own.
function toolIgnoreOffer({ projectRoot, localChild: asked = false })
{
    const file = '.prettierignore';
    const none = (why) => ({ state: 'none', file, why });
    if (!asked) return none('offered with --local-child only');
    const stamp = require('./install/stamp.js');
    if (stamp.readToolIgnores(stamp.stampFiles({ projectRoot }).read)[file] !== 'created') return none('the run created none');
    if (!localChild(projectRoot)) return none('not a local install in a workspace');
    let top;
    try { top = git(['rev-parse', '--show-toplevel'], projectRoot); }
    catch { return none('not a git repository'); }
    try { git(['check-ignore', '-q', '--', file], projectRoot); return none(`${file} is already ignored`); }
    catch { /* not ignored: read on */ }
    let tracked = '';
    try { tracked = git(['ls-files', '--', file], projectRoot); } catch { tracked = ''; }
    if (tracked) return none(`git tracks ${file}`);
    return { state: 'offer', file, why: 'the install created it for Prettier in a local install in a workspace', top };
}

// git-hygiene's own comment above the data root's line - the mark that the line is the stack's, so an update may rewrite it.
const OWN_COMMENT = '# alfred-code: the data root (ALFRED_CODE_DATA_PATH) is machine-local';
// At project and user scope the stack's variables are committed (workspace roles and variables, D6), and git cannot
// re-include a file under an ignored folder: the root's contents are ignored instead, the file re-included.
const sharedScope = (projectRoot) =>
{
    const stamp = require('./install/stamp.js');
    return ['project', 'user'].includes(stamp.readStampScope(stamp.stampFiles({ projectRoot }).read));
};
const rootLines = (line, shared) => (shared ? [`${line}*`, `!${line}.variables`] : [line]);

// An earlier `/<root>/` line this script wrote (its comment right above it), in the project's .gitignore or the repo's
// exclude file, becomes the `/<root>/*` and `!/<root>/.variables` pair. A line of the user's own is never touched.
// Returns the files rewritten.
function rewriteOwnLine({ projectRoot, root })
{
    const files = [path.join(projectRoot, '.gitignore')];
    try { files.push(path.resolve(projectRoot, git(['rev-parse', '--git-path', 'info/exclude'], projectRoot))); }
    catch { /* no repository: the .gitignore alone */ }
    const done = [];
    for (const file of files)
    {
        let text;
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        const eol = text.includes('\r\n') ? '\r\n' : '\n';
        const lines = text.split(/\r?\n/);
        let changed = false;
        for (let i = lines.length - 1; i > 0; i--)
        {
            const line = lines[i].trim();
            if (lines[i - 1].trim() !== OWN_COMMENT || !line.startsWith('/') || !line.endsWith(`/${root}/`)) continue;
            lines.splice(i, 1, ...rootLines(line, true));
            changed = true;
        }
        if (!changed) continue;
        fs.writeFileSync(file, lines.join(eol));
        done.push(file);
    }
    return done;
}

// The lines go to the project's own `.gitignore` (committed - the team shares it) or the repo's
// `.git/info/exclude` (this clone only, no committed file touched). Anchored, so a nested folder of the same
// name elsewhere is untouched; the exclude file's patterns are relative to the top level.
function applyIgnore({ projectRoot, home, localChild: asked = false })
{
    const offer = dataRootOffer({ projectRoot, localChild: asked });
    const tool = toolIgnoreOffer({ projectRoot, localChild: asked });
    const shared = !asked && sharedScope(projectRoot);
    const wanted = [
        ...(offer.state === 'offer' ? [{ name: `${offer.root}/`, top: offer.top, comment: OWN_COMMENT.slice('# alfred-code: '.length), shared }] : []),
        ...(tool.state === 'offer' ? [{ name: tool.file, top: tool.top, comment: 'the .prettierignore this local install created' }] : []),
    ];
    if (!wanted.length) return { state: 'none', why: offer.why };
    let file;
    let anchor = () => '/';
    if (home === 'gitignore') file = path.join(projectRoot, '.gitignore');
    else
    {
        file = path.resolve(projectRoot, git(['rev-parse', '--git-path', 'info/exclude'], projectRoot));
        anchor = (top) =>
        {
            const fromTop = posix(path.relative(fs.realpathSync.native(top), fs.realpathSync.native(projectRoot)));
            return `/${fromTop ? `${fromTop}/` : ''}`;
        };
    }
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { text = ''; }
    const have = new Set(text.split(/\r?\n/).map((l) => l.trim()));
    const add = wanted.map((w) => ({ ...w, lines: rootLines(`${anchor(w.top)}${w.name}`, w.shared) })).filter((w) => !w.lines.every((l) => have.has(l)));
    if (!add.length) return { state: 'current', file };
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lead = text && !/\r?\n$/.test(text) ? eol : '';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${lead}${add.map((w) => `# alfred-code: ${w.comment}${eol}${w.lines.join(eol)}${eol}`).join('')}`);
    const lines = add.flatMap((w) => w.lines);
    return { state: 'applied', file, line: lines.join(' '), lines };
}

function main()
{
    const projectRoot = path.resolve(arg('--root') || '.');
    const home = arg('--apply');
    const asked = process.argv.includes('--local-child');
    if (home && !['gitignore', 'exclude'].includes(home))
    {
        console.error("usage: git-hygiene.js --root <project> [--apply gitignore|exclude] [--local-child]");
        return 1;
    }
    if (!home)
    {
        const o = dataRootOffer({ projectRoot, localChild: asked });
        console.log(o.state === 'offer' ? `git-hygiene: offer ${o.root}/\t${o.why}` : `git-hygiene: none (${o.why})`);
        const t = toolIgnoreOffer({ projectRoot, localChild: asked });
        if (t.state === 'offer') console.log(`git-hygiene: offer ${t.file}\t${t.why}`);
        return 0;
    }
    try
    {
        const r = applyIgnore({ projectRoot, home, localChild: asked });
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

if (require.main === module)
{
    require('../stack/hooks/hook-prelude.js').blockingStdio();
    process.exitCode = main();
}
module.exports = { dataRootOffer, toolIgnoreOffer, applyIgnore, rewriteOwnLine, OWN_COMMENT };
