'use strict';
// Release 2's MCP probes against the REAL claude, each in a throwaway CLAUDE_CONFIG_DIR and HOME (never the user's account):
//   A7  - `mcp add-json -s local <name> <json>` (the option before the name) is accepted, the entry lands under the child's
//         `projects` key, and what the CLI stored differs from the JSON sent by which keys;
//   A10 - a stdio server starts with a `claude -p` run (logged out, or logged in with --logged-in), from which cwd, and
//         whether the child's settings `env` reaches it;
//   A11 - with a project (.mcp.json) and a local server of one name, the project one approved, which one starts.
//   node mcp-probe.js <claude> [--logged-in]   --logged-in: CLAUDE_CODE_OAUTH_TOKEN comes from the caller's env, never printed
//   node mcp-probe.js <claude> --keys <cwd>    A8: add-json from <cwd> as typed, print each `projects` key as stored
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const CLAUDE = process.argv[2];
const loggedIn = process.argv.includes('--logged-in');
const keysAt = process.argv.includes('--keys') ? process.argv[process.argv.indexOf('--keys') + 1] : null;
if (!CLAUDE) { process.stderr.write('usage: node mcp-probe.js <claude> [--logged-in | --keys <cwd>]\n'); process.exit(2); }

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-probe-'));
const acct = path.join(work, 'acct');
fs.mkdirSync(acct);
const S = (text) => String(text).split(work).join('<S>').split(fs.realpathSync(work)).join('<S>');
const lines = [];
const say = (line) => { lines.push(S(line)); process.stdout.write(`${S(line)}\n`); };

// An allow-list env: the token rides only on the logged-in leg's claude calls.
const env = { PATH: process.env.PATH, HOME: work, USERPROFILE: work, CLAUDE_CONFIG_DIR: acct };
for (const k of ['TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'ComSpec', 'PATHEXT', 'SystemDrive', 'ProgramFiles', 'APPDATA', 'LOCALAPPDATA']) if (process.env[k]) env[k] = process.env[k];
if (loggedIn)
{
    if (!/^sk-ant-oat/.test(process.env.CLAUDE_CODE_OAUTH_TOKEN || '')) { say('FAIL setup: --logged-in without a CLAUDE_CODE_OAUTH_TOKEN of the setup-token shape'); process.exit(1); }
    env.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;
}
const shell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(CLAUDE);
const claude = (args, cwd, timeout = 60000) => spawnSync(CLAUDE, args, { cwd, env, encoding: 'utf8', timeout, shell });
const account = () =>
{
    for (const f of [path.join(acct, '.claude.json'), path.join(work, '.claude.json')])
    {
        try { return { file: f, data: JSON.parse(fs.readFileSync(f, 'utf8')) }; } catch { /* next */ }
    }
    return { file: null, data: {} };
};
const projectKeys = () => Object.keys(account().data.projects || {});
const entryAt = (name) =>
{
    for (const [key, p] of Object.entries(account().data.projects || {})) if (p && p.mcpServers && p.mcpServers[name]) return { key, entry: p.mcpServers[name] };
    return null;
};

if (keysAt)
{
    const r = claude(['mcp', 'add-json', '-s', 'local', 'probe', JSON.stringify({ type: 'stdio', command: 'node', args: ['x.js'] })], keysAt);
    say(`RESULT A8: add-json from '${keysAt}' exit ${r.status}`);
    for (const k of projectKeys()) say(`RESULT A8: projects key stored as '${k}'`);
    fs.rmSync(work, { recursive: true, force: true });
    process.exit(0);
}

const root = path.join(work, 'ws');
const child = path.join(root, 'api');
fs.mkdirSync(child, { recursive: true });
execFileSync('git', ['init', '-q', child]);
const server = path.join(work, 'server.js');
fs.writeFileSync(server, [
    "'use strict';",
    "const fs = require('fs');",
    "fs.appendFileSync(process.argv[2], JSON.stringify({ tag: process.argv[3], cwd: process.cwd(), dataPath: Object.prototype.hasOwnProperty.call(process.env, 'ALFRED_CODE_DATA_PATH') }) + '\\n');",
    'setTimeout(() => {}, 4000);',
    '',
].join('\n'));
const stdio = (out, tag) => ({ type: 'stdio', command: 'node', args: [server, out, tag] });
const local = path.join(child, '.claude', 'settings.local.json');
const writeLocal = (data) => { fs.mkdirSync(path.dirname(local), { recursive: true }); fs.writeFileSync(local, JSON.stringify(data, null, 2)); };
const started = (out) => { try { return fs.readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const run = (tag) =>
{
    const log = path.join(work, `${tag}.log`);
    const args = ['-p', 'hi', '--debug', '--debug-file', log];
    if (loggedIn) args.push('--model', 'haiku');
    const r = claude(args, child, 120000);
    let debug = '';
    try { debug = fs.readFileSync(log, 'utf8'); } catch { /* none */ }
    return { status: r.status, auth: /not logged in|please run \/login|invalid api key|authentication/i.test(`${r.stdout}\n${r.stderr}`), mcpLines: debug.split('\n').filter((l) => /MCP server "(?:a10|same)"/.test(l)).slice(0, 6) };
};
say(`RESULT setup: claude ${String(claude(['--version'], work).stdout).trim()}, ${loggedIn ? 'logged in (setup token)' : 'logged out'}, platform ${process.platform}`);

// A7 - the option before the name, then after it
const sent = stdio(path.join(work, 'a7.out'), 'a7');
const a7 = claude(['mcp', 'add-json', '-s', 'local', 'probe', JSON.stringify(sent)], child);
const got = entryAt('probe');
say(`${a7.status === 0 && got ? 'PASS' : 'FAIL'} A7: 'add-json -s local probe <json>' exit ${a7.status}, entry ${got ? `under key '${got.key}'` : 'not found'}`);
if (got)
{
    const added = Object.keys(got.entry).filter((k) => !(k in sent));
    const dropped = Object.keys(sent).filter((k) => !(k in got.entry));
    const changed = Object.keys(sent).filter((k) => k in got.entry && JSON.stringify(got.entry[k]) !== JSON.stringify(sent[k]));
    say(`RESULT A7: stored entry vs sent - added [${added.map((k) => `${k}=${JSON.stringify(got.entry[k])}`).join(', ')}], dropped [${dropped.join(', ')}], changed [${changed.join(', ')}]`);
    say(`RESULT A7/A8 (${process.platform}): child typed as '${child}', real '${fs.realpathSync(child)}', key '${got.key}'`);
}
const last = claude(['mcp', 'add-json', 'probe2', JSON.stringify(sent), '-s', 'local'], child);
say(`RESULT A7: option last ('add-json probe2 <json> -s local') exit ${last.status}${entryAt('probe2') ? ', stored' : ', not stored'}`);
claude(['mcp', 'remove', '-s', 'local', 'probe'], child);
claude(['mcp', 'remove', '-s', 'local', 'probe2'], child);

// A10 - does a server start with `claude -p`, from which cwd, with the settings env?
const a10out = path.join(work, 'a10.out');
writeLocal({ env: { ALFRED_CODE_DATA_PATH: 'var/data' } });
claude(['mcp', 'add-json', '-s', 'local', 'a10', JSON.stringify(stdio(a10out, 'a10'))], child);
const r10 = run('a10');
const s10 = started(a10out);
say(`RESULT A10: claude -p exit ${r10.status}${r10.auth ? ' (auth stop)' : ''}; server started ${s10.length ? `yes, cwd ${s10[0].cwd === child || s10[0].cwd === fs.realpathSync(child) ? 'the child' : `'${s10[0].cwd}'`}, settings env ALFRED_CODE_DATA_PATH ${s10[0].dataPath ? 'present' : 'absent'}` : 'no'}`);
for (const l of r10.mcpLines) say(`  log: ${l.slice(0, 200)}`);
claude(['mcp', 'remove', '-s', 'local', 'a10'], child);

// A11 - project and local of one name, the project one approved; then the control with the project one alone
const a11out = path.join(work, 'a11.out');
fs.writeFileSync(path.join(child, '.mcp.json'), JSON.stringify({ mcpServers: { same: stdio(a11out, 'project') } }, null, 2));
writeLocal({ enabledMcpjsonServers: ['same'] });
claude(['mcp', 'add-json', '-s', 'local', 'same', JSON.stringify(stdio(a11out, 'local'))], child);
const r11 = run('a11');
const s11 = started(a11out).map((x) => x.tag);
claude(['mcp', 'remove', '-s', 'local', 'same'], child);
const ctlOut = path.join(work, 'a11c.out');
fs.writeFileSync(path.join(child, '.mcp.json'), JSON.stringify({ mcpServers: { same: stdio(ctlOut, 'project') } }, null, 2));
const rc = run('a11c');
const sc = started(ctlOut).map((x) => x.tag);
const control = sc.includes('project');
say(`RESULT A11 control: project server alone started [${sc.join(', ')}] (exit ${rc.status}) - ${control ? 'valid' : 'the A11 run proves nothing'}`);
say(`RESULT A11: both registered, started [${s11.join(', ')}] (exit ${r11.status})${control ? '' : ' - not proven (control failed)'}`);

fs.rmSync(work, { recursive: true, force: true });
