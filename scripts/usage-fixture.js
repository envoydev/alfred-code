'use strict';
// TEST HELPER (not shipped): the usage scope's trees and transcripts for scripts/usage-scope.test.js and
// scripts/analyze-usage.test.js. A tree is a throwaway workspace with its own config dir and an env pointing HOME,
// USERPROFILE and CLAUDE_CONFIG_DIR inside it; a session is a synthetic transcript under that config dir, never a
// real session's text. Nothing here asserts.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execCommand } = require('./install/runtime.js');  // M6: every external command through the one Windows-safe spawn
const { putWorkspace } = require('./workspace-fixture.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-fx-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* already gone */ } });
const STAMP = 'sha: x\n';

// `spec` maps a relative folder to { stamp, git, record, vars, settings, local }: `record` its workspace record (a
// partial one), `vars` its `.alfred/.variables` text, `settings` / `local` its .claude/settings.json /
// settings.local.json text. Returns (rel) => the folder's real path, with `config`, `env` and `top` on it.
function tree(spec = {})
{
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(TMP, 't-')));
    const top = path.join(base, 'w');
    fs.mkdirSync(top, { recursive: true });
    const config = path.join(base, 'config');
    const home = path.join(base, 'home');
    fs.mkdirSync(path.join(config, 'projects'), { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    for (const [rel, o] of Object.entries(spec))
    {
        const dir = path.join(top, ...rel.split('/'));
        fs.mkdirSync(dir, { recursive: true });
        if (o.git) execCommand('git', ['init', '-q'], { cwd: dir, env: gitEnv(home), stdio: 'ignore' });
        const claude = path.join(dir, '.claude');
        if (o.stamp) { fs.mkdirSync(claude, { recursive: true }); fs.writeFileSync(path.join(claude, 'alfred-code.stamp'), STAMP); }
        if (o.settings !== undefined) { fs.mkdirSync(claude, { recursive: true }); fs.writeFileSync(path.join(claude, 'settings.json'), o.settings); }
        if (o.local !== undefined) { fs.mkdirSync(claude, { recursive: true }); fs.writeFileSync(path.join(claude, 'settings.local.json'), o.local); }
        if (o.record !== undefined) putWorkspace(dir, o.record);
        if (o.vars !== undefined) { fs.mkdirSync(path.join(dir, '.alfred'), { recursive: true }); fs.writeFileSync(path.join(dir, '.alfred', '.variables'), o.vars); }
    }
    const at = (rel = '.') => { const p = path.join(top, ...rel.split('/')); try { return fs.realpathSync.native(p); } catch { return p; } };
    at.top = top;
    at.config = config;
    at.home = home;
    at.env = { HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: config, GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
    return at;
}

function gitEnv(home)
{
    const env = { ...process.env, HOME: home, USERPROFILE: home, GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
    for (const k of Object.keys(env)) if (k.startsWith('ALFRED_CODE_')) delete env[k];
    return env;
}

// Claude Code names a project's transcript folder after the path, every character outside [A-Za-z0-9] as '-'.
const encode = (dir) => String(dir).replace(/[^a-zA-Z0-9]/g, '-');

// Writes `<config>/projects/<encoded cwd>/<sid>.jsonl` (or under `dir` when given): three head lines with no `cwd`
// (`head: false` drops them), then `rows` - by default one user row and one assistant row carrying `cwd: startCwd` and
// a usage. `at` sets the file's mtime (ms). Returns the file's path.
function session(t, cwd, sid, { cwd: startCwd = cwd, rows, at, head = true, dir } = {})
{
    const folder = dir || path.join(t.config, 'projects', encode(cwd));
    fs.mkdirSync(folder, { recursive: true });
    const stamp = new Date(at || Date.parse('2026-11-01T10:00:00.000Z')).toISOString();
    const heads = head ? [
        { type: 'last-prompt', lastPrompt: 'go', sessionId: sid },
        { type: 'mode', mode: 'normal', sessionId: sid },
        { type: 'file-history-snapshot', messageId: 'm0', isSnapshotUpdate: false, snapshot: { messageId: 'm0', trackedFileBackups: {}, timestamp: stamp } },
    ] : [];
    const body = rows || [
        { type: 'user', timestamp: stamp, cwd: startCwd, sessionId: sid, uuid: 'u1', parentUuid: null, message: { role: 'user', content: 'start' } },
        { type: 'assistant', timestamp: stamp, cwd: startCwd, sessionId: sid, uuid: 'a1', parentUuid: 'u1',
            message: { role: 'assistant', model: 'claude-opus-5-5', id: `msg-${sid}`, content: [{ type: 'text', text: 'done' }],
                usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } } },
    ];
    const file = path.join(folder, `${sid}.jsonl`);
    fs.writeFileSync(file, [...heads, ...body].map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n');
    if (at) fs.utimesSync(file, new Date(at), new Date(at));
    return file;
}

module.exports = { tree, session, encode, gitEnv };
