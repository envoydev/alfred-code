'use strict';
// Release 3's probe A5 against the REAL claude, logged out, in a throwaway CLAUDE_CONFIG_DIR and HOME (never the user's
// account): the folder Claude Code keys a project by under `<config>/projects/`, beside the name R6's rule computes from
// the git top - every character outside [A-Za-z0-9] as `-`, NFC, and past 200 characters the first 200 plus `-<hash>`.
// An `InstructionsLoaded` hook from `--settings` (A9: it fires before the auth stop) writes its payload; its
// `transcript_path` names the folder. Each case runs from its git top, typed as the case says.
//   node memory-probe.js <claude>
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLAUDE = process.argv[2];
if (!CLAUDE) { process.stderr.write('usage: node memory-probe.js <claude>\n'); process.exit(2); }

const work = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mem-probe-')));
const acct = path.join(work, 'acct');
fs.mkdirSync(acct);
const S = (text) => String(text).split(work).join('<S>');
const say = (line) => process.stdout.write(`${S(line)}\n`);

const env = { PATH: process.env.PATH, HOME: work, USERPROFILE: work, CLAUDE_CONFIG_DIR: acct };
for (const k of ['TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'ComSpec', 'PATHEXT', 'SystemDrive', 'ProgramFiles', 'APPDATA', 'LOCALAPPDATA']) if (process.env[k]) env[k] = process.env[k];
const shell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(CLAUDE);

const hookJs = path.join(work, 'hook.js');
fs.writeFileSync(hookJs, "let s='';process.stdin.on('data',(d)=>{s+=d;}).on('end',()=>{require('fs').writeFileSync(process.argv[2],s);});\n");
const rule = (top) =>
{
    const name = top.normalize('NFC').replace(/[^A-Za-z0-9]/g, '-');
    return name.length > 200 ? `${name.slice(0, 200)}-*` : name;
};
// On Windows Claude Code keeps the case the cwd was TYPED in, and NTFS opens a folder under any case: there the names are
// compared case-folded, and each row also says whether R6's own spelling opens the folder.
const fold = (n) => (process.platform === 'win32' ? n.toLowerCase() : n);
const fits = (got, want) => (want.endsWith('-*') ? fold(got).startsWith(fold(want.slice(0, -1))) && got.length > want.length - 1 : fold(got) === fold(want));

// A folder name whose absolute path sanitizes to `total` characters.
const padTo = (parent, total, stem) => stem + 'x'.repeat(Math.max(1, total - (parent.length + 1) - stem.length));
const cases = [
    { label: 'plain', dir: 'Plain' },
    { label: 'lowercase-typed', dir: 'MixedCase', typed: (p) => path.join(path.dirname(p), path.basename(p).toLowerCase()) },
    { label: 'all-caps-typed', dir: 'MixedCase2', typed: (p) => path.join(path.dirname(p), path.basename(p).toUpperCase()) },
    { label: 'space and e-acute', dir: 'my projé' },
    ...[199, 200, 201].map((n) => ({ label: `sanitized ${n}`, dir: padTo(work, n, `len${n}-`) })),
    { label: 'sanitized 201 lowercase-typed', dir: padTo(work, 201, 'LEN201B-').toUpperCase(), typed: (p) => path.join(path.dirname(p), path.basename(p).toLowerCase()) },
];

let n = 0;
for (const c of cases)
{
    const top = path.join(work, c.dir);
    fs.mkdirSync(path.join(top, '.claude', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(top, '.claude', 'rules', 'r.md'), '# probe rule\n');
    spawnSync('git', ['init', '-q', top]);
    const ev = path.join(work, `ev-${n}.json`);
    const settings = path.join(work, `hooks-${n++}.json`);
    fs.writeFileSync(settings, JSON.stringify({ hooks: { InstructionsLoaded: [{ hooks: [{ type: 'command', command: `node "${hookJs}" "${ev}"` }] }] } }));
    const cwd = c.typed ? c.typed(top) : top;
    const r = spawnSync(CLAUDE, ['-p', 'hi', '--settings', settings], { cwd, env, encoding: 'utf8', timeout: 90000, shell });
    let payload = null;
    try { payload = JSON.parse(fs.readFileSync(ev, 'utf8')); } catch { /* no event */ }
    if (!payload || !payload.transcript_path)
    {
        say(`NOT RUN A5 ${c.label}: no InstructionsLoaded payload (exit ${r.status}) ${(r.stderr || '').slice(0, 200)}`);
        continue;
    }
    const got = path.basename(path.dirname(payload.transcript_path));
    const want = rule(top);
    const opens = want.endsWith('-*') ? '' : `, R6's spelling opens it: ${fs.existsSync(path.join(acct, 'projects', want)) ? 'yes' : 'no'}`;
    say(`${fits(got, want) ? 'PASS' : 'FAIL'} A5 ${c.label}: cwd typed '${cwd}' -> projects/${got} (R6: ${want}, ${got.length} chars${opens})`);
}
for (const d of fs.existsSync(path.join(acct, 'projects')) ? fs.readdirSync(path.join(acct, 'projects')) : []) say(`folder on disk: projects/${d}`);
fs.rmSync(work, { recursive: true, force: true });
