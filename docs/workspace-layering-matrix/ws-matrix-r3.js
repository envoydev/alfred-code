'use strict';
// Workspace layering release 3 (docs, preferences and memory for a child) - the temp-project matrix, run from a CLEAN
// EXPORT of the working tree and of release 2's last commit, in throwaway trees with a throwaway account, HOME and a stub
// `claude`. Every row reads the written files or a hook's own output.
//   node ws-matrix-r3.js <export> <export-release-2> [<claude> for the logged-out SessionStart row] [case ...]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const EXPORT = path.resolve(process.argv[2]);
const OLD = path.resolve(process.argv[3]);
const CLAUDE = process.argv[4] && !/^R3-/.test(process.argv[4]) ? process.argv[4] : '';
const ONLY = process.argv.slice(CLAUDE ? 5 : 4);
const { scrubStackEnv } = require(path.join(EXPORT, 'scripts', 'seed-sandbox.js'));
const layout = require(path.join(EXPORT, 'stack', 'hooks', 'layout.js'));
const { memoryLine, MEMORY_ROOM } = require(path.join(EXPORT, 'stack', 'hooks', 'preferences-session.js'));
const PLUGINS = JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true, scope: 'user' }]);
const ROOT_SEL = 'skill javascript\nrule alfred-security\nrule alfred-navigation\n';
const CHILD_SEL = `${ROOT_SEL}skill npm\n`;
const PERSONAL = '# Personal preferences\n\nUpdated: 2026-10-27\n\n## P1 - Short answers\n<!-- id: p1 -->\n- Rule: ROOT-PERSONAL lead with the verdict.\n- Scope: every answer\n';
const rows = [];
const check = (id, ok, detail = '') => rows.push(`${ok ? 'PASS' : 'FAIL'} ${id}${ok ? '' : `\n     ${String(detail).replace(/\n/g, '\n     ').slice(0, 2000)}`}`);
const notRun = (id, why) => rows.push(`NOT RUN ${id} - ${why}`);
const readOr = (f, d = null) => { try { return fs.readFileSync(f, 'utf8'); } catch { return d; } };
const json = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const want = (id) => !ONLY.length || ONLY.includes(id);
const ctxOf = (out) => { try { return String(JSON.parse(out).hookSpecificOutput.additionalContext || ''); } catch { return ''; } };

function sandbox()
{
    const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wsr3-')));
    const bin = path.join(work, 'bin');
    fs.mkdirSync(bin);
    fs.mkdirSync(path.join(work, 'acct'));
    fs.writeFileSync(path.join(work, 'plugins.json'), PLUGINS);
    fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$CLAUDE_STUB_LOG"\nif [ "$1" = "plugin" ] && [ "$2" = "list" ]; then cat "$CLAUDE_STUB_PLUGINS"; exit 0; fi\nexit 0\n', { mode: 0o755 });
    for (const t of ['uvx', 'npx', 'npm', 'curl']) fs.writeFileSync(path.join(bin, t), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const env = { ...process.env, HOME: work, CLAUDE_CONFIG_DIR: path.join(work, 'acct'), PATH: bin + path.delimiter + process.env.PATH,
        CLAUDE_STUB_LOG: path.join(work, 'claude-calls.log'), CLAUDE_STUB_PLUGINS: path.join(work, 'plugins.json'), ALFRED_CODE_MEMORY_WARM: '0' };
    for (const k of Object.keys(env)) if (/^(SENTRY_|CONTEXT7_|UV_EXCLUDE|ANDROID_|JAVA_HOME|CLAUDE_PROJECT_DIR|CLAUDE_PLUGIN_ROOT|CLAUDE_CODE_PROJECT_DIR_NAME)/.test(k)) delete env[k];
    scrubStackEnv(env);
    const at = (rel = '.') => path.join(work, 'ws', ...(rel === '.' ? [] : rel.split('/')));
    const node = (cwd, argv, extra = {}, input) =>
    {
        const r = spawnSync(process.execPath, argv, { cwd, env: { ...env, ...extra }, encoding: 'utf8', timeout: 600000, input });
        return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}`, stdout: r.stdout || '', stderr: r.stderr || '' };
    };
    const sel = (text) => { const f = path.join(work, `sel-${crypto.randomBytes(4).toString('hex')}.txt`); fs.writeFileSync(f, text); return f; };
    const put = (abs, text) => { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, text); };
    const sb = {
        work, env, at, node, put,
        mk: (rel, git = true) => { fs.mkdirSync(at(rel), { recursive: true }); if (git) spawnSync('git', ['init', '-q', at(rel)]); },
        install: (rel, selection, args = [], { src = EXPORT } = {}) => node(at(rel), [path.join(src, 'scripts', 'install', 'alfred-code.js'), 'install', '--source', src, '--selection', sel(selection), ...args]),
        update: (rel, { src = EXPORT } = {}) => node(at(rel), [path.join(src, 'scripts', 'install', 'alfred-code.js'), 'update', '--source', src, '--installed-only']),
        ws: (rel, verb, args = [], src = EXPORT) => node(at(rel), [path.join(src, 'scripts', 'workspace.js'), verb, '--root', '.', ...args]),
        initChild: (rel, args = [], src = EXPORT) =>
        {
            const parentDir = path.dirname(at(rel));
            const plan = path.join(work, `parent-${crypto.randomBytes(4).toString('hex')}.json`);
            const scope = node(parentDir, [path.join(src, 'scripts', 'install', 'stamp.js'), 'scope', '.']).out.trim();
            node(parentDir, [path.join(src, 'scripts', 'install', 'alfred-code.js'), 'update', '--source', src, '--scope', scope, '--installed-only', '--print-plan', '--plan-out', plan]);
            const join = sb.ws(rel, 'role', ['--answer', 'child'], src);
            return node(at(rel), [path.join(src, 'scripts', 'install', 'alfred-code.js'), 'install', '--source', src, '--selection', sel(CHILD_SEL),
                ...(join.code === 0 ? ['--parent-plan', plan] : []), '--instructions-file', 'agents', '--instructions-at', 'claude', ...args]);
        },
        local: (rel) => json(path.join(at(rel), '.claude', 'settings.local.json')) || {},
        perms: (rel) => (sb.local(rel).permissions || {}),
        docsOf: (rel) => path.join(at(rel), '.alfred', 'docs'),
        memOf: (rel) => layout.memoryDirsOf(at(rel), { env })[0],
        hook: (rel, file, payload, extra = {}) => node(at(rel), [path.join(EXPORT, 'stack', 'hooks', file)], { CLAUDE_PROJECT_DIR: at(rel), CLAUDE_PLUGIN_ROOT: EXPORT, ...extra },
            JSON.stringify({ session_id: `mx-${crypto.randomBytes(3).toString('hex')}`, cwd: at(rel), ...payload })),
        start: (rel, file, extra = {}) => ctxOf(sb.hook(rel, file, { hook_event_name: 'SessionStart', source: 'startup' }, extra).stdout),
        write: (rel, file) => sb.hook(rel, 'guard-cross-project-write.js', { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: file, content: 'x' } }, { ALFRED_CODE_ALLOW_WRITE_OUTSIDE: '' }),
        done: () => fs.rmSync(work, { recursive: true, force: true }),
    };
    return sb;
}
const run = (id, body) =>
{
    if (!want(id)) return;
    const sb = sandbox();
    try { body(sb); }
    catch (e) { check(`${id} (threw)`, false, e.stack); }
    finally { sb.done(); }
};
const deny = (p) => `Edit(/${String(p).replace(/[\\/]+$/, '')}/**)`;
// A root with docs, a personal preference doc and a memory index; a child `api` and a grandchild `api/tool`.
function tree(sb, { src = EXPORT, childArgs = [] } = {})
{
    sb.mk('.', false); sb.mk('api'); sb.mk('api/tool');
    const root = sb.install('.', ROOT_SEL, [], { src });
    sb.ws('.', 'role', ['--answer', 'root'], src);
    sb.put(path.join(sb.docsOf('.'), 'awareness', 'ARCHITECTURE-AWARENESS.md'), '# Ws\n\nThe workspace root.\n');
    sb.put(path.join(sb.docsOf('.'), 'preferences', 'PERSONAL-PREFERENCES.md'), PERSONAL);
    sb.put(path.join(sb.memOf('.'), 'MEMORY.md'), '- [Root note](root-note.md) - the root keeps this\n');
    sb.put(path.join(sb.memOf('.'), 'root-note.md'), 'a root memory\n');
    const api = sb.initChild('api', childArgs, src);
    const tool = sb.initChild('api/tool', [], src);
    return { root, api, tool };
}

// ---------------------------------------------------------------- R3-1 a fresh install: the rows, the lines, the deny
run('R3-1', (sb) =>
{
    const t = tree(sb);
    const wsDocs = sb.docsOf('.'); const apiDocs = sb.docsOf('api'); const wsMem = sb.memOf('.'); const apiMem = sb.memOf('api');
    const pa = sb.perms('api'); const pt = sb.perms('api/tool');
    check('R3-1a a fresh child lists the root\'s docs root in additionalDirectories and denies Edit on it and on the root\'s memory',
        t.root.code === 0 && t.api.code === 0 && JSON.stringify(pa.additionalDirectories) === JSON.stringify([wsDocs])
        && [deny(wsDocs), deny(wsMem)].every((r) => (pa.deny || []).includes(r)), `${JSON.stringify(pa)}\n${t.api.out.slice(-600)}`);
    check('R3-1b the grandchild lists both docs roots and denies both memory folders; the root writes no rows',
        t.tool.code === 0 && JSON.stringify(pt.additionalDirectories) === JSON.stringify([apiDocs, wsDocs].sort())
        && [deny(wsDocs), deny(apiDocs), deny(wsMem), deny(apiMem)].every((r) => (pt.deny || []).includes(r)) && !sb.perms('.').additionalDirectories,
        `${JSON.stringify(pt)}\n${JSON.stringify(sb.perms('.'))}`);
    const docs = sb.start('api', 'docs-session.js');
    check('R3-1c the child\'s start names the root\'s docs root and its areas, read-only',
        docs.includes(`Workspace root docs (read-only): ${wsDocs} - `) && /Workspace root docs \(read-only\): .* - [a-z, -]*awareness/.test(docs), docs.slice(0, 1200));
    const prefs = sb.start('api', 'preferences-session.js');
    check('R3-1d the child\'s start pushes the root\'s personal doc and the root\'s memory index',
        prefs.includes('ROOT-PERSONAL') && prefs.includes(`Workspace root memory (read-only): ${path.join(wsMem, 'MEMORY.md')}\n- [Root note](root-note.md)`), prefs.slice(-1500));
    const deep = sb.start('api/tool', 'preferences-session.js');
    check('R3-1e the grandchild\'s memory line names the TOP member\'s index', deep.includes(`Workspace root memory (read-only): ${path.join(wsMem, 'MEMORY.md')}`), deep.slice(-800));
    const seat = ctxOf(sb.hook('api', 'preferences-session.js', { hook_event_name: 'SessionStart', source: 'compact', agent_id: 'seat-1', agent_type: 'alfred-code:reviewer' }).stdout);
    const seatDocs = ctxOf(sb.hook('api', 'docs-session.js', { hook_event_name: 'SessionStart', source: 'compact', agent_id: 'seat-1' }).stdout);
    check('R3-1f a seat\'s start gets neither line', !/Workspace root (memory|docs)/.test(seat + seatDocs), `${seat}\n${seatDocs}`);
    const w1 = sb.write('api', path.join(wsMem, 'MEMORY.md')); const w2 = sb.write('api', path.join(apiMem, 'MEMORY.md'));
    const w3 = sb.write('api/tool', path.join(apiMem, 'MEMORY.md')); const w4 = sb.write('.', path.join(wsMem, 'MEMORY.md'));
    check('R3-1g the guard: a child into the root\'s memory 2, into its own 0; the grandchild into the child\'s 2; the root into its own 0',
        w1.code === 2 && /memory of/.test(w1.stderr) && w2.code === 0 && w3.code === 2 && w4.code === 0, `${w1.code} ${w2.code} ${w3.code} ${w4.code}\n${w1.stderr}`);
    const st = sb.ws('api', 'status').out;
    check('R3-1h status names the docs root and the memory index', st.includes(`docs: ${wsDocs}`) && st.includes(`memory: ${path.join(wsMem, 'MEMORY.md')}`), st);
});

// ---------------------------------------------------------------- R3-2 a re-run changes nothing
run('R3-2', (sb) =>
{
    tree(sb);
    const before = readOr(path.join(sb.at('api'), '.claude', 'settings.local.json'));
    const u1 = sb.update('api'); const mid = readOr(path.join(sb.at('api'), '.claude', 'settings.local.json'));
    const u2 = sb.update('api'); const after = readOr(path.join(sb.at('api'), '.claude', 'settings.local.json'));
    check('R3-2 two updates of the child leave settings.local.json byte for byte', u1.code === 0 && u2.code === 0 && /additionalDirectories/.test(before || '') && before === mid && mid === after,
        `${before}\n---\n${after}\n${u2.out.slice(-600)}`);
});

// ---------------------------------------------------------------- R3-3 an update over a release 2 install
run('R3-3', (sb) =>
{
    const t = tree(sb, { src: OLD });
    const old = sb.perms('api');
    const ur = sb.update('.'); const ua = sb.update('api'); const ut = sb.update('api/tool');
    const pa = sb.perms('api');
    check('R3-3 release 2 wrote no rows; the update adds the docs root and the two denies, and the grandchild\'s',
        t.api.code === 0 && !old.additionalDirectories && ur.code === 0 && ua.code === 0 && ut.code === 0
        && JSON.stringify(pa.additionalDirectories) === JSON.stringify([sb.docsOf('.')]) && (pa.deny || []).includes(deny(sb.memOf('.')))
        && (sb.perms('api/tool').additionalDirectories || []).length === 2, `${JSON.stringify(old)} -> ${JSON.stringify(pa)}\n${ua.out.slice(-600)}`);
});

// ---------------------------------------------------------------- R3-4 the user's own config and memory are kept
run('R3-4', (sb) =>
{
    tree(sb);
    const f = path.join(sb.at('api'), '.claude', 'settings.local.json');
    const data = json(f);
    data.permissions.additionalDirectories.push('/opt/own-dir');
    data.permissions.deny.push('Edit(//opt/own/**)');
    data.permissions.allow = ['Bash(npm test)'];
    fs.writeFileSync(f, `${JSON.stringify(data, null, 2)}\n`);
    const mem = path.join(sb.memOf('.'), 'MEMORY.md');
    sb.put(mem, '- [Root note](root-note.md) - the root keeps this\n- [Hand](hand.md) - written by hand\n');
    const memBefore = readOr(mem); const noteBefore = readOr(path.join(sb.memOf('.'), 'root-note.md'));
    const u1 = sb.update('.'); const u2 = sb.update('api');
    const p = sb.perms('api');
    check('R3-4 the user\'s own additionalDirectories entry, deny and allow rows and the root\'s memory files survive both updates',
        u1.code === 0 && u2.code === 0 && p.additionalDirectories.includes('/opt/own-dir') && p.additionalDirectories.includes(sb.docsOf('.'))
        && p.deny.includes('Edit(//opt/own/**)') && JSON.stringify(p.allow) === '["Bash(npm test)"]' && readOr(mem) === memBefore
        && readOr(path.join(sb.memOf('.'), 'root-note.md')) === noteBefore, JSON.stringify(p));
});

// ---------------------------------------------------------------- R3-5 an ancestor with a garbage settings.json
run('R3-5', (sb) =>
{
    tree(sb);
    fs.writeFileSync(path.join(sb.at('.'), '.claude', 'settings.json'), '{ not json');
    const u = sb.update('api');
    const d = sb.hook('api', 'docs-session.js', { hook_event_name: 'SessionStart', source: 'startup' });
    const p = sb.hook('api', 'preferences-session.js', { hook_event_name: 'SessionStart', source: 'startup' });
    const w = sb.write('api', path.join(sb.memOf('.'), 'MEMORY.md'));
    check('R3-5 a root with a garbage settings.json: the child\'s update keeps its rows, both hooks exit 0 with their lines, the guard still denies',
        (sb.perms('api').additionalDirectories || []).includes(sb.docsOf('.')) && d.code === 0 && p.code === 0
        && ctxOf(d.stdout).includes('Workspace root docs') && ctxOf(p.stdout).includes('Workspace root memory') && w.code === 2,
        `update ${u.code}\n${u.out.slice(-500)}\n${d.stderr}\n${p.stderr}\nguard ${w.code}`);
});

// ---------------------------------------------------------------- R3-6 a child at each scope
for (const scope of ['project', 'user', 'local'])
{
    run(`R3-6-${scope}`, (sb) =>
    {
        const t = tree(sb, { childArgs: ['--scope', scope] });
        const p = sb.perms('api');
        check(`R3-6 a child installed at ${scope} scope writes the rows into its settings.local.json`,
            t.api.code === 0 && JSON.stringify(p.additionalDirectories) === JSON.stringify([sb.docsOf('.')]) && (p.deny || []).includes(deny(sb.memOf('.'))),
            `${JSON.stringify(p)}\n${t.api.out.slice(-600)}`);
    });
}

// ---------------------------------------------------------------- R3-7 the index's boundaries, through the export's hook
run('R3-7', (sb) =>
{
    tree(sb);
    const mem = path.join(sb.memOf('.'), 'MEMORY.md');
    const lines = (n) => Array.from({ length: n }, (_, i) => `- line ${i + 1}`).join('\n') + '\n';
    const counts = [59, 60, 61].map((n) => { sb.put(mem, lines(n)); const c = sb.start('api', 'preferences-session.js'); return [c.includes(`- line ${Math.min(n, 60)}`), !c.includes('- line 61')]; });
    check('R3-7a an index of 59, 60 and 61 lines: the first 60 at most', counts.every(([a, b]) => a && b), JSON.stringify(counts));
    const nine = Array.from({ length: 9 }, (_, i) => `${i}`.padEnd(600, 'a')).join('\n') + '\n';
    const bytes = [6143, 6144, 6145].map((n) => { sb.put(mem, `${nine}${'z'.repeat(n - nine.length)}`); return /z$/.test(sb.start('api', 'preferences-session.js')); });
    check('R3-7b 6 KB minus one and at 6 KB whole, plus one byte cut at a line', bytes[0] && bytes[1] && !bytes[2], JSON.stringify(bytes));
    sb.put(mem, '');
    check('R3-7c an empty MEMORY.md gives no line', !sb.start('api', 'preferences-session.js').includes('Workspace root memory'));
    const big = `# Personal preferences\n\n${Array.from({ length: 90 }, (_, i) => `- rule ${i}: keep answers short and lead with the verdict`).join('\n')}\n`;
    sb.put(path.join(sb.docsOf('api'), 'preferences', 'PERSONAL-PREFERENCES.md'), big);
    sb.put(mem, Array.from({ length: 50 }, (_, i) => `- memory ${String(i).padStart(2, '0')} ${'m'.repeat(109)}`).join('\n'));
    const full = sb.start('api', 'preferences-session.js');
    check('R3-7d a personal doc at its cap, the tool order, the host lines and a 6 KB index: under 10,000 characters, the index cut',
        full.length < 10000 && full.includes('- memory 00') && !full.includes('- memory 49'), `${full.length} chars`);
    const file = mem;
    const head = `Workspace root memory (read-only): ${file}`;
    const at = (left) => memoryLine(file, lines(60), MEMORY_ROOM - head.length - 1 - left);
    check('R3-7e 299 characters left gives the path alone, 300 and 301 the cut index (the export\'s memoryLine)',
        at(299) === head && at(300).startsWith(`${head}\n- line 1`) && at(301).startsWith(`${head}\n- line 1`), `${at(299)}\n${at(300).length}`);
    const atRoom = (used) => memoryLine(file, lines(60), used);
    const over = [MEMORY_ROOM - head.length - 1 - 300, MEMORY_ROOM - head.length - 1 - 299].map((u) => u + atRoom(u).length + 2 <= 10000);
    check('R3-7f at the floor and one past it the whole start stays under 10,000 characters', over.every(Boolean), JSON.stringify(over));
});

// ---------------------------------------------------------------- R3-9 the root gone since the install (Review Focus 5)
run('R3-9', (sb) =>
{
    tree(sb);
    const wsDocs = sb.docsOf('.'); const wsMem = sb.memOf('.');
    fs.renameSync(sb.at('.'), path.join(sb.work, 'moved'));
    fs.mkdirSync(sb.at('.'));
    fs.renameSync(path.join(sb.work, 'moved', 'api'), sb.at('api'));
    const u = sb.update('api');
    const p = sb.perms('api');
    const docs = sb.start('api', 'docs-session.js'); const prefs = sb.start('api', 'preferences-session.js');
    const w = sb.write('api', path.join(wsMem, 'MEMORY.md'));
    check('R3-9 a child whose root is gone: the update drops the stale docs-root and deny rows, no line at start, no memory deny',
        u.code === 0 && !(p.additionalDirectories || []).includes(wsDocs) && !(p.deny || []).some((r) => r === deny(wsDocs) || r === deny(wsMem))
        && !/Workspace root (docs|memory)/.test(docs + prefs) && w.code === 0,
        `${JSON.stringify(p)}\n${u.out.slice(-600)}\nguard ${w.code} ${w.stderr.slice(0, 300)}`);
});

// ---------------------------------------------------------------- R3-10 a child's linked worktree (final review I1)
run('R3-10', (sb) =>
{
    tree(sb);
    const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: sb.at('api'), encoding: 'utf8' });
    git('add', '-A', '--', '.', ':!tool');
    git('commit', '-qm', 'i');
    const wt = path.join(sb.work, 'api-wt');
    git('worktree', 'add', '-q', wt, '-b', 'feat');
    const hook = (file, payload, extra = {}) => sb.node(wt, [path.join(EXPORT, 'stack', 'hooks', file)], { CLAUDE_PROJECT_DIR: wt, CLAUDE_PLUGIN_ROOT: EXPORT, ...extra },
        JSON.stringify({ session_id: `mx-${crypto.randomBytes(3).toString('hex')}`, cwd: wt, ...payload }));
    const start = { hook_event_name: 'SessionStart', source: 'startup' };
    const docs = ctxOf(hook('docs-session.js', start).stdout); const prefs = ctxOf(hook('preferences-session.js', start).stdout);
    const w = hook('guard-cross-project-write.js', { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: path.join(sb.memOf('.'), 'MEMORY.md'), content: 'x' } }, { ALFRED_CODE_ALLOW_WRITE_OUTSIDE: '' });
    check('R3-10 a child\'s linked worktree: the docs and memory lines at start, the guard denies the root\'s memory',
        fs.existsSync(path.join(wt, '.git')) && docs.includes(`Workspace root docs (read-only): ${sb.docsOf('.')} - `)
        && prefs.includes(`Workspace root memory (read-only): ${path.join(sb.memOf('.'), 'MEMORY.md')}`) && w.code === 2 && /memory of/.test(w.stderr),
        `${docs.slice(0, 400)}\n${prefs.slice(-400)}\nguard ${w.code} ${w.stderr.slice(0, 300)}`);
});

// ---------------------------------------------------------------- R3-11 a root setting that would deny the child (final review I2/M3)
run('R3-11', (sb) =>
{
    tree(sb);
    const holds = (rules, p) => (rules || []).filter((r) => `${p}/`.startsWith(r.slice('Edit(/'.length, -'**)'.length)));
    sb.put(path.join(sb.at('.'), '.claude', 'settings.local.json'), JSON.stringify({ autoMemoryDirectory: '.', env: { ALFRED_CODE_DOCS_PATH: '.' } }));
    const u = sb.update('api');
    const p = sb.perms('api');
    const fileInApi = path.join(sb.at('api'), 'src', 'a.ts');
    check('R3-11a a root autoMemoryDirectory "." and docs path ".": the child\'s update denies nothing holding it, lists no additional directory holding it, still denies the root\'s default memory',
        u.code === 0 && !holds(p.deny, fileInApi).length && !(p.additionalDirectories || []).includes(sb.at('.')) && (p.deny || []).includes(deny(sb.memOf('.'))),
        `${JSON.stringify(p)}\n${u.out.slice(-500)}`);
    // Under the account folder: the guard opens a folder elsewhere only when the account or managed settings name it
    // (R3-12) or an untracked settings.local.json does (R3-13), never a file a clone carries.
    const mem = path.join(sb.env.CLAUDE_CONFIG_DIR, 'mem');
    sb.put(path.join(sb.at('.'), '.claude', 'settings.local.json'), JSON.stringify({ autoMemoryDirectory: path.join(mem, 'ws') }));
    sb.put(path.join(sb.at('api'), '.claude', 'settings.local.json'), JSON.stringify({ ...sb.local('api'), autoMemoryDirectory: path.join(mem, 'ws', 'api') }));
    const u2 = sb.update('api');
    const p2 = sb.perms('api');
    const own = sb.write('api', path.join(mem, 'ws', 'api', 'MEMORY.md'));
    const root = sb.write('api', path.join(mem, 'ws', 'MEMORY.md'));
    check('R3-11b the child\'s own memory nested in the root\'s: no deny row over it, the guard lets the child write its own and denies the root\'s',
        u2.code === 0 && !holds(p2.deny, path.join(mem, 'ws', 'api', 'MEMORY.md')).length && own.code === 0 && root.code === 2 && /memory of/.test(root.stderr),
        `${JSON.stringify(p2)}\n${u2.out.slice(-500)}\nown ${own.code} ${own.stderr.slice(0, 200)}\nroot ${root.code}`);
});

// ---------------------------------------------------------------- R3-12 a custom memory folder outside the account folder
run('R3-12', (sb) =>
{
    sb.mk('.');
    const inst = sb.install('.', ROOT_SEL);
    const mem = path.join(sb.work, 'mem', 'solo');
    const acctFile = path.join(sb.env.CLAUDE_CONFIG_DIR, 'settings.json');
    sb.put(acctFile, JSON.stringify({ ...(json(acctFile) || {}), autoMemoryDirectory: mem }));
    const own = sb.write('.', path.join(mem, 'MEMORY.md'));
    const off = sb.hook('.', 'guard-cross-project-write.js', { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: path.join(mem, 'MEMORY.md'), content: 'x' } }, { ALFRED_CODE_ALLOW_WRITE_OUTSIDE: '', ALFRED_CODE_WORKSPACE: '0' });
    const beside = sb.write('.', path.join(sb.work, 'mem', 'other.md'));
    sb.put(path.join(sb.at('.'), '.claude', 'settings.json'), JSON.stringify({ ...(json(path.join(sb.at('.'), '.claude', 'settings.json')) || {}), autoMemoryDirectory: '~/.ssh' }));
    const ssh = sb.write('.', path.join(sb.work, '.ssh', 'authorized_keys'));
    check('R3-12 the account settings name a memory folder outside the account folder: writable, the switch at 0 too; a file beside it and a repo settings.json naming ~/.ssh stay blocked',
        inst.code === 0 && own.code === 0 && off.code === 0 && beside.code === 2 && ssh.code === 2,
        `install ${inst.code}\nown ${own.code} ${own.stderr.slice(0, 300)}\noff ${off.code}\nbeside ${beside.code}\nssh ${ssh.code}`);
});

// ---------------------------------------------------------------- R3-13 the memory folder in an untracked settings.local.json (3.1.0)
run('R3-13', (sb) =>
{
    sb.mk('.');
    const inst = sb.install('.', ROOT_SEL);
    const mem = path.join(sb.work, 'mem', 'solo');
    const localFile = path.join(sb.at('.'), '.claude', 'settings.local.json');
    sb.put(localFile, JSON.stringify({ ...(json(localFile) || {}), autoMemoryDirectory: mem }));
    const own = sb.write('.', path.join(mem, 'MEMORY.md'));
    const beside = sb.write('.', path.join(sb.work, 'mem', 'other.md'));
    const upd = sb.update('.');
    const kept = (json(localFile) || {}).autoMemoryDirectory === mem;
    const after = sb.write('.', path.join(mem, 'MEMORY.md'));
    check('R3-13a an untracked settings.local.json names a memory folder outside the account folder: writable, a file beside it blocked; an update keeps the key and the allowance',
        inst.code === 0 && own.code === 0 && beside.code === 2 && upd.code === 0 && kept && after.code === 0,
        `install ${inst.code}\nown ${own.code} ${own.stderr.slice(0, 300)}\nbeside ${beside.code}\nupdate ${upd.code} kept ${kept}\nafter ${after.code} ${after.stderr.slice(0, 300)}`);
    // A session started in a sub-folder: Claude Code reads the root's file there (v2.1.211), and a file in the sub-folder
    // may be an archive's - on Windows Claude Code reads the start folder's, so neither opens.
    sb.mk('pkg', false);
    sb.put(path.join(sb.at('pkg'), '.claude', 'settings.local.json'), JSON.stringify({ autoMemoryDirectory: path.join(sb.work, 'mem', 'pkg') }));
    const subRoot = sb.write('pkg', path.join(mem, 'MEMORY.md'));
    const subOwn = sb.write('pkg', path.join(sb.work, 'mem', 'pkg', 'MEMORY.md'));
    const rootRead = process.platform === 'win32' ? 2 : 0;
    check('R3-13d from a sub-folder: the root\'s untracked file opens its folder, the sub-folder\'s own file opens nothing',
        subRoot.code === rootRead && subOwn.code === 2, `root's ${subRoot.code} ${subRoot.stderr.slice(0, 300)}\nown ${subOwn.code}`);
    spawnSync('git', ['add', '-f', '.claude/settings.local.json'], { cwd: sb.at('.') });
    const tracked = sb.write('.', path.join(mem, 'MEMORY.md'));
    check('R3-13b the same file once git tracks it (a clone carries it): blocked', tracked.code === 2, `${tracked.code} ${tracked.stderr.slice(0, 300)}`);
    sb.mk('../plain', false);
    const plainInst = sb.install('../plain', ROOT_SEL);
    const plainLocal = path.join(sb.at('../plain'), '.claude', 'settings.local.json');
    sb.put(plainLocal, JSON.stringify({ ...(json(plainLocal) || {}), autoMemoryDirectory: path.join(sb.work, 'mem', 'plain') }));
    const plain = sb.write('../plain', path.join(sb.work, 'mem', 'plain', 'MEMORY.md'));
    check('R3-13c a project outside any git repo: nothing says the file is untracked, so blocked', plainInst.code === 0 && plain.code === 2,
        `install ${plainInst.code} ${plainInst.out.slice(-300)}\nwrite ${plain.code} ${plain.stderr.slice(0, 300)}`);
    if (process.platform === 'win32') { notRun('R3-13e a clone with a symlinked .claude', 'a symlink needs a privilege Windows CI lacks'); return; }
    // A repository whose .claude is a symlink to a folder holding settings.local.json naming ~/.ssh: git tracks the link and
    // conf/settings.local.json, never .claude/settings.local.json, so ls-files alone calls it untracked.
    const src = path.join(sb.work, 'evil-src');
    sb.put(path.join(src, 'conf', 'settings.local.json'), JSON.stringify({ autoMemoryDirectory: '~/.ssh' }));
    fs.symlinkSync('conf', path.join(src, '.claude'));
    const g = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
    g(src, 'init', '-q');
    g(src, 'add', '-A');
    g(src, 'commit', '-qm', 'i');
    const cloned = g(sb.work, 'clone', '-q', src, sb.at('../evil'));
    // Installed, as the user would: the plugin's guard stands down in a project with no install.
    const evilInst = sb.install('../evil', ROOT_SEL);
    const ssh = sb.write('../evil', path.join(sb.work, '.ssh', 'authorized_keys'));
    check('R3-13e a clone whose .claude is a symlink, its settings.local.json naming ~/.ssh: blocked', cloned.status === 0 && evilInst.code === 0 && ssh.code === 2,
        `clone ${cloned.status} ${cloned.stderr}\ninstall ${evilInst.code} ${evilInst.out.slice(-300)}\nssh ${ssh.code} ${ssh.stderr.slice(0, 300)}`);
});

// ---------------------------------------------------------------- R3-8 a real logged-out start
run('R3-8', (sb) =>
{
    if (!CLAUDE) { notRun('R3-8 a logged-out claude -p start', 'no claude binary passed'); return; }
    tree(sb);
    const out = path.join(sb.work, 'start.json');
    const wrap = path.join(sb.work, 'wrap.js');
    fs.writeFileSync(wrap, `const { spawnSync } = require('child_process'); let s = ''; process.stdin.on('data', (d) => { s += d; }).on('end', () => { const r = spawnSync(process.execPath, [${JSON.stringify(path.join(EXPORT, 'stack', 'hooks', 'docs-session.js'))}], { input: s, encoding: 'utf8' }); require('fs').writeFileSync(${JSON.stringify(out)}, r.stdout || ''); process.stdout.write(r.stdout || ''); });\n`);
    const settings = path.join(sb.work, 'hooks.json');
    fs.writeFileSync(settings, JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `node "${wrap}"` }] }] } }));
    const debug = path.join(sb.work, 'debug.log');
    const env = { PATH: process.env.PATH, HOME: sb.work, CLAUDE_CONFIG_DIR: path.join(sb.work, 'acct-real') };
    fs.mkdirSync(env.CLAUDE_CONFIG_DIR);
    spawnSync(CLAUDE, ['-p', 'hi', '--settings', settings, '--debug-file', debug], { cwd: sb.at('api'), env, encoding: 'utf8', timeout: 90000 });
    const got = ctxOf(readOr(out, ''));
    if (!readOr(out)) { notRun('R3-8 a logged-out claude -p start', `no SessionStart hook ran before the auth stop (debug log ${/SessionStart/.test(readOr(debug, '')) ? 'names' : 'does not name'} SessionStart)`); return; }
    check('R3-8 a logged-out claude -p start in the child: the docs-session hook prints the workspace docs line', got.includes(`Workspace root docs (read-only): ${sb.docsOf('.')}`), got.slice(0, 800));
});

console.log(rows.join('\n'));
const failed = rows.filter((r) => r.startsWith('FAIL')).length;
const notRunCount = rows.filter((r) => r.startsWith('NOT RUN')).length;
console.log(`\n${rows.length - failed - notRunCount}/${rows.length} pass, ${failed} fail, ${notRunCount} not run`);
process.exitCode = failed ? 1 : 0;
