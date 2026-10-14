'use strict';
// THE PROJECT'S OWN TOOLS SKIP THE DATA ROOT (the user's ruling, 2026-10-14: the stack's data is never the project's
// code to analyse). A tool that walks the tree reads its own ignore file and, at most, the ROOT .gitignore - never the
// data root's nested one - so `prettier --check .` walked a project's .alfred/ and flagged 272 files (measured
// 2026-10-14 on Prettier 3.9.1: a browser profile, the docs, serena's memories) while the project's source was clean.
// The model cannot fix it there: an existing ignore file is a whole-file config the config guard keeps it out of.
//
// So each run writes ONE marked block into the ignore file of each such tool the project uses: the data root and
// `.claude/`, where the stack's library copies live (a fresh install's Prettier run flagged 13 of them; `prettier
// --write .` rewrote them, the next update wrote them back and validate reported drift - the user's call of the same
// day). A data move re-points it. What it wrote is the stamp's `tool-ignores:` line (`<file>=created|appended`): a
// block the user took out stays out, a file the user deleted is not made again, and uninstall takes the block back -
// and a file the stack created, once nothing else is left in it. A line of the project's own already ignoring one of
// the two is the answer for it, and the block names only the other. The block is the installer's: an edit inside it
// is rewritten.
const fs = require('node:fs');
const path = require('node:path');
const { readJson } = require('./json-file.js');

const MARK = "# alfred-code: the stack's data and copies, never this project's code - the installer keeps this block";
const END = '# alfred-code: end';

const PRETTIER_CONFIGS = ['.prettierrc', ...['json', 'json5', 'yaml', 'yml', 'toml', 'js', 'cjs', 'mjs', 'ts', 'cts', 'mts'].map((x) => `.prettierrc.${x}`),
    ...['js', 'cjs', 'mjs', 'ts', 'cts', 'mts'].map((x) => `prettier.config.${x}`)];
function prettierUsed(projectRoot)
{
    if (PRETTIER_CONFIGS.some((f) => fs.existsSync(path.join(projectRoot, f)))) return true;
    const pkg = readJson(path.join(projectRoot, 'package.json'));
    return Boolean(pkg && (pkg.prettier !== undefined
        || ['dependencies', 'devDependencies'].some((k) => pkg[k] && typeof pkg[k] === 'object' && Object.hasOwn(pkg[k], 'prettier'))));
}
// Prettier's file is made where Prettier is in use; the others are only ever appended to, where the project keeps one.
const TOOLS = [
    { file: '.prettierignore', create: prettierUsed },
    { file: '.eslintignore' },
    { file: '.stylelintignore' },
    { file: '.markdownlintignore' },
];

const lineFor = (root) => `/${String(root).replace(/^\/+|\/+$/g, '')}/`;
// A line of the project's own that already keeps the whole root out.
function covers(lines, root)
{
    const r = String(root).replace(/^\/+|\/+$/g, '');
    const forms = new Set([r, `${r}/`, `/${r}`, `/${r}/`, `${r}/**`, `/${r}/**`, `${r}/*`, `/${r}/*`, `${r}/**/*`, `/${r}/**/*`]);
    return lines.some((l) => forms.has(l.trim()));
}
const isRootLine = (l) => /^\/\S*\/$/.test(String(l || '').trim());
// The stack's block in a file's lines: from its mark to its end line (or, with the end line lost, the folder lines
// after the mark), or null.
function blockOf(lines)
{
    const at = lines.findIndex((l) => l.trim() === MARK);
    if (at < 0) return null;
    let end = lines.findIndex((l, i) => i > at && l.trim() === END);
    if (end < 0) { end = at; while (isRootLine(lines[end + 1])) end++; }
    return { at, end };
}
// What the block names: each of the two folders no line of the project's own keeps out already.
const wantedLines = (outside, root) => [root, '.claude'].filter((r) => !covers(outside, r)).map(lineFor);

// Writes or re-points the block in each tool's file. `prior` is the stamp's record; returns the record to stamp.
function ensureToolIgnores({ projectRoot, root, prior = {}, log = () => {}, note = () => {} })
{
    const record = {};
    for (const tool of TOOLS)
    {
        const file = path.join(projectRoot, tool.file);
        let text = null;
        try { text = fs.readFileSync(file, 'utf8'); }
        catch (err)
        {
            if (err.code !== 'ENOENT') { note(`${tool.file} could not be read (${err.code || err.message}) - the stack's folders are not added to it`); if (prior[tool.file]) record[tool.file] = prior[tool.file]; continue; }
        }
        if (text === null)
        {
            // gone: the user deleted the file the stack made, or the tool is not this project's
            if (prior[tool.file] || !tool.create || !tool.create(projectRoot)) { if (prior[tool.file]) record[tool.file] = prior[tool.file]; continue; }
            text = '';
        }
        const eol = text.includes('\r\n') ? '\r\n' : '\n';
        const lines = text.split(/\r?\n/);
        const block = blockOf(lines);
        const outside = block ? [...lines.slice(0, block.at), ...lines.slice(block.end + 1)] : lines;
        const want = wantedLines(outside, root);
        if (block)
        {
            const now = want.length ? [MARK, ...want, END] : [];
            if (now.join('\n') === lines.slice(block.at, block.end + 1).map((l) => l.trim()).join('\n')) { record[tool.file] = prior[tool.file] || 'appended'; continue; }
            const from = !now.length && block.at > 0 && lines[block.at - 1].trim() === '' ? block.at - 1 : block.at;
            lines.splice(from, block.end + 1 - from, ...now);
            try
            {
                fs.writeFileSync(file, lines.join(eol));
                if (now.length) { record[tool.file] = prior[tool.file] || 'appended'; log(`  tool ignores: ${tool.file} now names ${want.join(' ')}`); }
                else log(`  tool ignores: ${tool.file} - the project's own lines keep both folders out, so the stack's block left it`);
            }
            catch (err) { note(`${tool.file} could not be written (${err.code || err.message}) - set its alfred-code block to ${want.join(' ') || 'nothing'} by hand`); if (prior[tool.file]) record[tool.file] = prior[tool.file]; }
            continue;
        }
        // The block the stack wrote is gone: the user took it out, and it stays out.
        if (prior[tool.file]) { record[tool.file] = prior[tool.file]; continue; }
        if (!want.length) continue;
        const created = text === '';
        const body = text === '' ? '' : `${text}${text.endsWith('\n') ? '' : eol}${text.trim() ? eol : ''}`;
        try
        {
            fs.writeFileSync(file, `${body}${[MARK, ...want, END].join(eol)}${eol}`);
            record[tool.file] = created ? 'created' : 'appended';
            log(`  tool ignores: ${tool.file} ${created ? 'written' : 'gains'} ${want.join(' ')} - the tool reads no nested .gitignore, so it walked the stack's files as this project's code`);
        }
        catch (err) { note(`${tool.file} could not be written (${err.code || err.message}) - add ${want.join(' ')} to it by hand`); }
    }
    return record;
}

// Uninstall: the block leaves each file the record names; a file the stack created goes once nothing else is in it.
function removeToolIgnores({ projectRoot, record = {}, log = () => {}, note = () => {} })
{
    for (const [name, how] of Object.entries(record))
    {
        const file = path.join(projectRoot, name);
        let text;
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        const eol = text.includes('\r\n') ? '\r\n' : '\n';
        const lines = text.split(/\r?\n/);
        const block = blockOf(lines);
        if (!block) continue;
        const from = block.at > 0 && lines[block.at - 1].trim() === '' ? block.at - 1 : block.at;
        lines.splice(from, block.end + 1 - from);
        const left = lines.join(eol);
        try
        {
            if (how === 'created' && !left.trim()) { fs.rmSync(file); log(`  tool ignores: ${name} removed - the stack made it and nothing else is in it`); }
            else { fs.writeFileSync(file, left); log(`  tool ignores: the alfred-code block left ${name}`); }
        }
        catch (err) { note(`${name} could not be written (${err.code || err.message}) - remove its alfred-code block by hand`); }
    }
}

module.exports = { ensureToolIgnores, removeToolIgnores, prettierUsed, MARK, END, TOOLS };
