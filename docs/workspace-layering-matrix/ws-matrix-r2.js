'use strict';
// Workspace roles and variables (release 2) - the temp-project matrix, run from a CLEAN EXPORT of the working tree and of
// v2.12.0 and v2.10.0, in throwaway trees with a throwaway account, HOME and a stub `claude`. Every case reads the files.
//   node ws-matrix-r2.js <export> <export-2.12.0> <export-2.10.0> [case ...]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const EXPORT = path.resolve(process.argv[2]);
const OLD12 = path.resolve(process.argv[3]);
const OLD10 = path.resolve(process.argv[4]);
const ONLY = process.argv.slice(5);
const { scrubStackEnv } = require(path.join(EXPORT, 'scripts', 'seed-sandbox.js'));
const layout = require(path.join(EXPORT, 'stack', 'hooks', 'layout.js'));
const stampLib = require(path.join(EXPORT, 'scripts', 'install', 'stamp.js'));
// the suites' account-keeping `claude` stub, read from its one home
const ACCOUNT_STUB = Function(`return \`${/const ACCOUNT_STUB = `([\s\S]*?)`;\n/.exec(fs.readFileSync(path.join(EXPORT, 'scripts', 'seed-sandbox.js'), 'utf8'))[1]}\`;`)();
const PLUGINS = JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true, scope: 'user' }]);
const ROOT_SEL = 'skill javascript\nrule alfred-security\nrule alfred-navigation\n';
const CHILD_SEL = `${ROOT_SEL}skill npm\n`;
const SCOPES = ['project', 'user', 'local'];
const NEVER_SEEDED = new Set(['ALFRED_CODE_DATA_PATH', 'ALFRED_CODE_WORKSPACE', 'ALFRED_CODE_HOOKS_OFF']);
const SEEDED = layout.VARIABLE_KEYS.filter((k) => !NEVER_SEEDED.has(k));
const CATALOG = JSON.parse(fs.readFileSync(path.join(EXPORT, 'meta', 'environment.json'), 'utf8')).env.map((r) => r.key);
const rows = [];
const check = (id, ok, detail = '') => rows.push(`${ok ? 'PASS' : 'FAIL'} ${id}${ok ? '' : `\n     ${String(detail).replace(/\n/g, '\n     ').slice(0, 2000)}`}`);
const readOr = (f, d = null) => { try { return fs.readFileSync(f, 'utf8'); } catch { return d; } };
const json = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const pairs = (text) => Object.fromEntries((text || '').split(/\r?\n/).filter((l) => /^ALFRED_CODE_\w+=/.test(l)).map((l) => l.split(/=(.*)/s).slice(0, 2)));
const want = (id) => !ONLY.length || ONLY.includes(id);
const p50 = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function sandbox(rootName = 'ws', { account = false } = {})
{
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wsr2-'));
    const bin = path.join(work, 'bin');
    fs.mkdirSync(bin);
    fs.mkdirSync(path.join(work, 'acct'));
    fs.writeFileSync(path.join(work, 'plugins.json'), PLUGINS);
    if (account)
    {
        fs.writeFileSync(path.join(bin, 'account-stub.js'), ACCOUNT_STUB);
        fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "$CLAUDE_STUB_LOG"\nif [ "$1" = "plugin" ] && [ "$2" = "list" ]; then cat "$CLAUDE_STUB_PLUGINS"; exit 0; fi\nif [ "$1" = "mcp" ]; then exec "${process.execPath}" "${path.join(bin, 'account-stub.js')}" "$@"; fi\nexit 0\n`, { mode: 0o755 });
    }
    else fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$CLAUDE_STUB_LOG"\nif [ "$1" = "plugin" ] && [ "$2" = "list" ]; then cat "$CLAUDE_STUB_PLUGINS"; exit 0; fi\nexit 0\n', { mode: 0o755 });
    for (const t of ['uvx', 'npx', 'npm', 'curl']) fs.writeFileSync(path.join(bin, t), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const env = { ...process.env, HOME: work, CLAUDE_CONFIG_DIR: path.join(work, 'acct'), PATH: bin + path.delimiter + process.env.PATH,
        CLAUDE_STUB_LOG: path.join(work, 'claude-calls.log'), CLAUDE_STUB_PLUGINS: path.join(work, 'plugins.json'), ALFRED_CODE_MEMORY_WARM: '0' };
    for (const k of Object.keys(env)) if (/^(SENTRY_|CONTEXT7_|UV_EXCLUDE|ANDROID_|JAVA_HOME|CLAUDE_PROJECT_DIR|CLAUDE_PLUGIN_ROOT)/.test(k)) delete env[k];
    scrubStackEnv(env);
    const at = (rel = '.') => path.join(work, rootName, ...(rel === '.' ? [] : rel.split('/')));
    const node = (cwd, argv, extra = {}, input) =>
    {
        const r = spawnSync(process.execPath, argv, { cwd, env: { ...env, ...extra }, encoding: 'utf8', timeout: 600000, input });
        return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}`, stdout: r.stdout || '' };
    };
    const sel = (text) => { const f = path.join(work, `sel-${crypto.randomBytes(4).toString('hex')}.txt`); fs.writeFileSync(f, text); return f; };
    const sb = {
        work, env, at, node,
        mk: (rel, git = true) => { fs.mkdirSync(at(rel), { recursive: true }); if (git) spawnSync('git', ['init', '-q', at(rel)]); },
        install: (rel, selection, args = [], { src = EXPORT, extra = {} } = {}) => node(at(rel), [path.join(src, 'scripts', 'install', 'alfred-code.js'), 'install', '--source', src, '--selection', sel(selection), ...args], extra),
        update: (rel, args = [], { src = EXPORT, extra = {} } = {}) => node(at(rel), [path.join(src, 'scripts', 'install', 'alfred-code.js'), 'update', '--source', src, '--installed-only', ...args], extra),
        uninstall: (rel, { src = EXPORT, extra = {} } = {}) => node(at(rel), [path.join(src, 'scripts', 'install', 'alfred-code.js'), 'uninstall', '--source', src], extra),
        ws: (rel, verb, args = [], extra = {}, src = EXPORT) => node(at(rel), [path.join(src, 'scripts', 'workspace.js'), verb, '--root', '.', ...args], extra),
        vars: (rel, verb, args = [], extra = {}) => node(at(rel), [path.join(EXPORT, 'scripts', 'variables.js'), verb, '--root', '.', ...args], extra),
        asks: (rel, extra = {}) => node(at(rel), [path.join(EXPORT, 'scripts', 'update-preflight.js'), '--asks', '--root', '.'], extra),
        // the read-back init's child flow hands the installer, then the install itself
        parentPlan: (rel, src = EXPORT) =>
        {
            const parentDir = path.dirname(at(rel));
            const plan = path.join(work, `parent-${crypto.randomBytes(4).toString('hex')}.json`);
            const scope = node(parentDir, [path.join(src, 'scripts', 'install', 'stamp.js'), 'scope', '.']).out.trim();
            node(parentDir, [path.join(src, 'scripts', 'install', 'alfred-code.js'), 'update', '--source', src, '--scope', scope, '--installed-only', '--print-plan', '--plan-out', plan]);
            return plan;
        },
        // init as this release runs it: the role ask's Child answer (`role --answer child`), then the install with --parent-plan
        initChild: (rel, selection = CHILD_SEL, args = []) =>
        {
            const plan = sb.parentPlan(rel);
            const join = sb.ws(rel, 'role', ['--answer', 'child']);
            const inst = sb.install(rel, selection, [...(join.code === 0 ? ['--parent-plan', plan] : []), '--instructions-file', 'agents', '--instructions-at', 'claude', ...args]);
            return { join, inst };
        },
        // 2.12.0's own join: `register`, then its install with --parent-plan
        initChild12: (rel, selection = CHILD_SEL, args = [], extra = {}) =>
        {
            const plan = sb.parentPlan(rel, OLD12);
            const reg = sb.ws(rel, 'register', [], extra, OLD12);
            return { reg, inst: sb.install(rel, selection, [...(reg.code === 0 ? ['--parent-plan', plan] : []), '--instructions-file', 'agents', '--instructions-at', 'claude', ...args], { src: OLD12, extra }) };
        },
        stamp: (rel) => readOr(path.join(at(rel), '.claude', 'alfred-code.stamp'), ''),
        ledger: (rel) => stampLib.readLedger(path.join(at(rel), '.claude', 'alfred-code.stamp')) || { env: {} },
        wsFile: (rel) => readOr(path.join(at(rel), '.alfred', 'workspace'), null),
        varsFile: (rel) => path.join(at(rel), '.alfred', '.variables'),
        varsOf: (rel) => pairs(readOr(path.join(at(rel), '.alfred', '.variables'), '')),
        settingsOf: (rel, file = 'settings.json') => json(path.join(at(rel), '.claude', file)) || {},
        envOf: (rel, file = 'settings.json') => ((json(path.join(at(rel), '.claude', file)) || {}).env || {}),
        setEnv: (rel, file, values) =>
        {
            const f = path.join(at(rel), '.claude', file);
            const data = json(f) || {};
            data.env = { ...(data.env || {}), ...values };
            for (const [k, v] of Object.entries(values)) if (v === null) delete data.env[k];
            fs.mkdirSync(path.dirname(f), { recursive: true });
            fs.writeFileSync(f, `${JSON.stringify(data, null, 2)}\n`);
        },
        // `variables.js show`: KEY -> { value, source }
        show: (rel, extra = {}) =>
        {
            const r = sb.vars(rel, 'show', [], extra);
            const out = {};
            for (const m of r.out.matchAll(/^(ALFRED_CODE_\w+)=(.*) \(([^)]*)\)$/gm)) out[m[1]] = { value: m[2], source: m[3] };
            return { map: out, out: r.out };
        },
        // what a hook started in `rel` reads: the prelude applies the variables at load
        hookEnv: (rel, keys, extra = {}) =>
        {
            const code = `require(${JSON.stringify(path.join(EXPORT, 'stack', 'hooks', 'hook-prelude.js'))}); process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.map((k) => [k, process.env[k] ?? null]))));`;
            const r = node(at(rel), ['-e', code], { CLAUDE_PROJECT_DIR: at(rel), ...extra }, '');
            try { return JSON.parse(r.stdout); } catch { return { error: r.out }; }
        },
        hook: (rel, file, payload, extra = {}) => node(at(rel), [path.join(EXPORT, 'stack', 'hooks', file)], { CLAUDE_PROJECT_DIR: at(rel), CLAUDE_PLUGIN_ROOT: EXPORT, ...extra }, JSON.stringify({ session_id: 'mx', cwd: at(rel), ...payload })),
        commit: (rel, files) => { spawnSync('git', ['-C', at(rel), 'add', '-f', ...files]); spawnSync('git', ['-C', at(rel), '-c', 'user.email=m@x', '-c', 'user.name=m', 'commit', '-qm', 'x']); },
        ignored: (rel, file) => spawnSync('git', ['-C', at(rel), 'check-ignore', '-q', file]).status,
        account: () => json(path.join(work, 'acct', '.claude.json')) || {},
        setAccount: (data) => fs.writeFileSync(path.join(work, 'acct', '.claude.json'), JSON.stringify(data, null, 2)),
        calls: () => readOr(path.join(work, 'claude-calls.log'), ''),
        done: () => fs.rmSync(work, { recursive: true, force: true }),
    };
    return sb;
}

// path, size and sha256 of every file under dir, minus the given sub-folders and the stamp's run times
function treeHash(dir, skip = [])
{
    const out = {};
    const walk = (d) =>
    {
        for (const e of fs.readdirSync(d, { withFileTypes: true }))
        {
            const abs = path.join(d, e.name);
            const rel = path.relative(dir, abs).split(path.sep).join('/');
            if (e.name === '.git' || skip.includes(rel)) continue;
            if (e.isDirectory()) walk(abs);
            else
            {
                let buf = fs.readFileSync(abs);
                if (e.name === 'alfred-code.stamp') buf = Buffer.from(buf.toString('utf8').replace(/^installed(-ms)?:.*$/gm, ''));
                out[rel] = `${buf.length}:${crypto.createHash('sha256').update(buf).digest('hex')}`;
            }
        }
    };
    walk(dir);
    return out;
}
const changed = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
const firstAsk = (out) => { const m = /^ask: ([^\t]*)\t(.*)$/m.exec(out || ''); return m ? { label: m[1], answer: m[2] } : null; };
const asksLine = (out) => (/^workspace: role-ask (\S+)(?: (\S+))?$/m.exec(out || '') || []).slice(1).join(' ') || null;
const run = (id, body, opts = {}) =>
{
    if (!want(id)) return;
    const sb = sandbox(opts.name || 'ws', opts);
    try { body(sb); }
    catch (e) { check(`${id} (threw)`, false, e.stack); }
    finally { sb.done(); }
};

// ---------------------------------------------------------------- AC2 - init's role ask
run('AC2', (sb) =>
{
    sb.mk('.', false); sb.mk('api'); sb.mk('solo', false); fs.mkdirSync(sb.at('solo/git'), { recursive: true }); spawnSync('git', ['init', '-q', sb.at('solo/git')]);
    const i0 = sb.install('.', ROOT_SEL);
    sb.ws('.', 'role', ['--answer', 'root']);
    const api = sb.ws('api', 'role', ['--when', 'init']);
    check('AC2 under a root: \'Child of .. (Recommended)\' first', i0.code === 0 && firstAsk(api.out)?.label === 'Child of .. (Recommended)' && firstAsk(api.out)?.answer === 'child', api.out);
    const before = treeHash(sb.at('.'), ['api', 'solo']);
    const join = sb.ws('api', 'role', ['--answer', 'child']);
    const after = treeHash(sb.at('.'), ['api', 'solo']);
    check('AC2 \'Child\' changes the parent by exactly its one child line', join.code === 0 && JSON.stringify(changed(before, after)) === '[".alfred/workspace"]' && /^child api$/m.test(sb.wsFile('.')) && /^parent \.\.$/m.test(sb.wsFile('api')), `${join.out}\n${changed(before, after)}\n${sb.wsFile('.')}`);
});
run('AC2b', (sb) =>
{
    sb.mk('plain', false); sb.mk('git');
    const plain = sb.ws('plain', 'role', ['--when', 'init']);
    const git = sb.ws('git', 'role', ['--when', 'init']);
    check('AC2 nothing above: \'Root\' first in a plain folder, \'Standalone\' first in a git checkout',
        firstAsk(plain.out)?.label === 'Root (Recommended)' && firstAsk(git.out)?.label === 'Standalone (Recommended)', `${plain.out}\n${git.out}`);
}, { name: 'top' });
run('AC2c', (sb) =>
{
    sb.mk('.'); fs.mkdirSync(sb.at('sub'), { recursive: true });
    sb.install('.', ROOT_SEL);
    const sub = sb.ws('sub', 'role', ['--when', 'init']);
    check('AC2 inside the parent\'s repo: the why line and \'Standalone\' first', /^why: .*same git repository/m.test(sub.out) && firstAsk(sub.out)?.label === 'Standalone (Recommended)', sub.out);
});

// ---------------------------------------------------------------- AC3 - a quiet update after any answer
run('AC3', (sb) =>
{
    sb.mk('.', false); sb.mk('api'); sb.mk('solo');
    sb.install('.', ROOT_SEL); sb.ws('.', 'role', ['--answer', 'root']);
    const c = sb.initChild('api');
    sb.install('solo', ROOT_SEL); sb.ws('solo', 'role', ['--answer', 'standalone']);
    for (const rel of ['api', 'solo', '.'])
    {
        const a1 = sb.asks(rel); const h0 = treeHash(sb.at(rel), rel === '.' ? ['api', 'solo'] : []);
        const u1 = sb.update(rel); const h1 = treeHash(sb.at(rel), rel === '.' ? ['api', 'solo'] : []);
        const a2 = sb.asks(rel); const u2 = sb.update(rel); const h2 = treeHash(sb.at(rel), rel === '.' ? ['api', 'solo'] : []);
        check(`AC3 ${rel === '.' ? 'root' : rel}: two updates print no role-ask and the second changes no file`,
            c.inst.code === 0 && u1.code === 0 && u2.code === 0 && !asksLine(a1.out) && !asksLine(a2.out) && !/role-ask/.test(u1.out + u2.out) && !changed(h1, h2).length,
            `asks: ${asksLine(a1.out)} / ${asksLine(a2.out)}; first changed ${changed(h0, h1)}; second changed ${changed(h1, h2)}`);
    }
});

// ---------------------------------------------------------------- AC4 - tree changes
run('AC4', (sb) =>
{
    // a stamped folder installed above a standalone: one ask, Keep quiets it
    sb.mk('.', false); sb.mk('api');
    sb.install('api', ROOT_SEL); sb.ws('api', 'role', ['--answer', 'standalone']);
    const q0 = sb.asks('api');
    sb.install('.', ROOT_SEL); sb.ws('.', 'role', ['--answer', 'root']);
    const a = sb.asks('api'); const opts = sb.ws('api', 'role', ['--when', 'update']);
    const keep = sb.ws('api', 'role', ['--answer', 'stay']); const a2 = sb.asks('api');
    check('AC4 an install above a standalone: one ask, Join first; Keep quiets the next run',
        !asksLine(q0.out) && asksLine(a.out) === 'above ..' && firstAsk(opts.out)?.label === 'Join .. (Recommended)' && keep.code === 0 && !asksLine(a2.out), `${q0.out}\n${a.out}\n${opts.out}\n${keep.out}\n${a2.out}`);
});
run('AC4b', (sb) =>
{
    // a parent that lost the child line: Rejoin first; a parent holding no install: Become standalone first
    sb.mk('.', false); sb.mk('api');
    sb.install('.', ROOT_SEL); sb.ws('.', 'role', ['--answer', 'root']); sb.initChild('api');
    fs.writeFileSync(path.join(sb.at('.'), '.alfred', 'workspace'), sb.wsFile('.').replace(/^child api\n/m, ''));
    const lost = sb.asks('api'); const lostOpts = sb.ws('api', 'role', ['--when', 'update']);
    check('AC4 a parent that lost the child line offers Rejoin first', asksLine(lost.out) === 'rejoin ..' && firstAsk(lostOpts.out)?.label === 'Rejoin .. (Recommended)', `${lost.out}\n${lostOpts.out}`);
    const re = sb.ws('api', 'role', ['--answer', 'rejoin']);
    check('AC4 Rejoin (unattended, the first) restores both lines', re.code === 0 && /^child api$/m.test(sb.wsFile('.')) && /^parent \.\.$/m.test(sb.wsFile('api')) && !asksLine(sb.asks('api').out), re.out);
    fs.rmSync(path.join(sb.at('.'), '.claude'), { recursive: true, force: true });
    const gone = sb.asks('api'); const goneOpts = sb.ws('api', 'role', ['--when', 'update']);
    const leave = sb.ws('api', 'role', ['--answer', firstAsk(goneOpts.out)?.answer || 'none']);
    check('AC4 a parent holding no install offers Become standalone first; taking it writes role standalone',
        asksLine(gone.out) === 'parent-gone ..' && firstAsk(goneOpts.out)?.label === 'Become standalone (Recommended)' && leave.code === 0 && /^role standalone$/m.test(sb.wsFile('api')) && !/^parent /m.test(sb.wsFile('api')),
        `${gone.out}\n${goneOpts.out}\n${leave.out}\n${sb.wsFile('api')}`);
});
run('AC4c', (sb) =>
{
    // a new stamped folder between child and parent: Stay first
    sb.mk('.', false); fs.mkdirSync(sb.at('apps'), { recursive: true }); sb.mk('apps/api');
    sb.install('.', ROOT_SEL); sb.ws('.', 'role', ['--answer', 'root']);
    const c = sb.initChild('apps/api');
    const parentRel = (/^parent (.*)$/m.exec(sb.wsFile('apps/api') || '') || [])[1];
    sb.mk('apps'); sb.install('apps', ROOT_SEL); sb.ws('apps', 'role', ['--answer', 'root']);
    const a = sb.asks('apps/api'); const opts = sb.ws('apps/api', 'role', ['--when', 'update']);
    const stay = sb.ws('apps/api', 'role', ['--answer', 'stay']);
    check('AC4 a stamped folder between child and parent offers Stay first; Stay quiets it',
        c.inst.code === 0 && parentRel === '../..' && asksLine(a.out) === 'between ..' && firstAsk(opts.out)?.label === 'Stay child of ../.. (Recommended)' && stay.code === 0 && !asksLine(sb.asks('apps/api').out),
        `parent ${parentRel}\n${a.out}\n${opts.out}\n${stay.out}`);
});

// ---------------------------------------------------------------- AC5 - configure's role changes
run('AC5', (sb) =>
{
    sb.mk('.', false); sb.mk('api'); sb.mk('web');
    sb.install('.', ROOT_SEL); sb.ws('.', 'role', ['--answer', 'standalone']);
    const toRoot = sb.ws('.', 'role', ['--answer', 'root']);
    check('AC5 standalone to root writes role root', toRoot.code === 0 && /^role root$/m.test(sb.wsFile('.')), `${toRoot.out}\n${sb.wsFile('.')}`);
    sb.install('api', ROOT_SEL); sb.ws('api', 'role', ['--answer', 'root']);
    const opts = sb.ws('api', 'role', ['--when', 'configure']);
    const join = sb.ws('api', 'role', ['--answer', 'join:..']);
    check('AC5 root to child: Join .. offered, then parent .. here and child api in ws',
        /^ask: Join \.\.\tjoin:\.\.$/m.test(opts.out) && join.code === 0 && /^parent \.\.$/m.test(sb.wsFile('api')) && !/^role /m.test(sb.wsFile('api')) && /^child api$/m.test(sb.wsFile('.')), `${opts.out}\n${join.out}\n${sb.wsFile('api')}`);
    const toStd = sb.ws('api', 'role', ['--answer', 'leave:standalone']);
    check('AC5 child to standalone: role standalone, the parent line and ws\'s child line gone',
        toStd.code === 0 && /^role standalone$/m.test(sb.wsFile('api')) && !/^parent /m.test(sb.wsFile('api')) && !/^child api$/m.test(sb.wsFile('.')), `${toStd.out}\n${sb.wsFile('api')}\n${sb.wsFile('.')}`);
    sb.ws('api', 'role', ['--answer', 'join:..']);
    const toRoot2 = sb.ws('api', 'role', ['--answer', 'leave:root']);
    check('AC5 child to root: role root, the parent line gone', toRoot2.code === 0 && /^role root$/m.test(sb.wsFile('api')) && !/^parent /m.test(sb.wsFile('api')) && !/^child api$/m.test(sb.wsFile('.')), `${toRoot2.out}\n${sb.wsFile('api')}`);
    sb.initChild('web');
    const refuse = sb.ws('.', 'role', ['--answer', 'standalone']);
    check('AC5 root to standalone with a child is refused, naming it', refuse.code !== 0 && /web/.test(refuse.out) && /^role root$/m.test(sb.wsFile('.')), `${refuse.code}\n${refuse.out}`);
});

// ---------------------------------------------------------------- AC6 - status prints each role
run('AC6', (sb) =>
{
    sb.mk('.', false); sb.mk('api'); sb.mk('web'); sb.mk('solo'); sb.mk('fresh');
    sb.install('.', ROOT_SEL); sb.ws('.', 'role', ['--answer', 'root']);
    sb.initChild('api'); sb.initChild('web');
    sb.install('solo', ROOT_SEL); sb.ws('solo', 'role', ['--answer', 'standalone']);
    // `fresh` is a checkout of its own that never answered: install with the switch off so no role is written
    sb.install('fresh', ROOT_SEL, [], { extra: { ALFRED_CODE_WORKSPACE: '0' } });
    const role = (rel, extra) => (/^role: (.*)$/m.exec(sb.ws(rel, 'status', [], extra).out) || [])[1];
    const got = { api: role('api'), root: role('.'), solo: role('solo'), fresh: role('fresh'), off: role('solo', { ALFRED_CODE_WORKSPACE: '0' }) };
    check('AC6 status: child of .., root of 2 children, standalone, standalone (no role recorded), workspace off',
        got.api === 'child of ..' && got.root === 'root of 2 children' && got.solo === 'standalone' && got.fresh === 'standalone (no role recorded)' && got.off === 'workspace off', JSON.stringify(got));
});

// ---------------------------------------------------------------- AC7 - a fresh install at each scope
for (const scope of SCOPES)
{
    run(`AC7-${scope}`, (sb) =>
    {
        sb.mk('.');
        const r = sb.install('.', ROOT_SEL, ['--scope', scope]);
        const vars = sb.varsOf('.');
        const missing = SEEDED.filter((k) => !(k in vars));
        const extra = Object.keys(vars).filter((k) => !SEEDED.includes(k));
        const settingsKeys = [...Object.keys(sb.envOf('.')), ...Object.keys(sb.envOf('.', 'settings.local.json'))].filter((k) => CATALOG.includes(k) && !['ALFRED_CODE_DATA_PATH', 'ALFRED_CODE_HOOKS_OFF'].includes(k));
        const ign = sb.ignored('.', '.alfred/.variables');
        check(`AC7 ${scope}: .variables holds every seeded catalog key, the settings env none, git ${scope === 'local' ? 'ignores' : 'tracks'} it`,
            r.code === 0 && !missing.length && !extra.length && !settingsKeys.length && ign === (scope === 'local' ? 0 : 1),
            `code ${r.code}; missing ${missing}; extra ${extra}; in settings ${settingsKeys}; check-ignore ${ign}\n${r.out.slice(-1500)}`);
    });
}
run('AC7-hygiene', (sb) =>
{
    sb.mk('.');
    fs.writeFileSync(path.join(sb.at('.'), '.gitignore'), 'node_modules/\n# alfred-code: the data root (ALFRED_CODE_DATA_PATH) is machine-local\n/.alfred/\n');
    const r = sb.install('.', ROOT_SEL);
    const gi = readOr(path.join(sb.at('.'), '.gitignore'), '');
    check('AC7 git-hygiene\'s own .alfred/ line is rewritten to /.alfred/* plus !/.alfred/.variables, and .variables is tracked',
        r.code === 0 && /^\/\.alfred\/\*$/m.test(gi) && /^!\/\.alfred\/\.variables$/m.test(gi) && !/^\/\.alfred\/$/m.test(gi) && sb.ignored('.', '.alfred/.variables') === 1 && Object.keys(sb.varsOf('.')).length === SEEDED.length, `${gi}\n${r.out.slice(-800)}`);
});
run('AC7-own-line', (sb) =>
{
    sb.mk('.');
    fs.writeFileSync(path.join(sb.at('.'), '.gitignore'), 'node_modules/\n.alfred/\n');
    const r = sb.install('.', ROOT_SEL);
    const env = sb.envOf('.');
    const seededHere = SEEDED.filter((k) => k in env);
    check('AC7 the user\'s own .alfred/ line: the keys seeded into settings.json as 2.12.0 does, none into .variables, the !! line names .gitignore:2',
        r.code === 0 && seededHere.length === SEEDED.length && !Object.keys(sb.varsOf('.')).length && /^.*!! variables:.*\.gitignore:2/m.test(r.out), `seeded ${seededHere.length}/${SEEDED.length}; vars ${Object.keys(sb.varsOf('.'))}\n${r.out.split('\n').filter((l) => /variables/.test(l)).join('\n')}`);
});

// ---------------------------------------------------------------- AC8 - an update over v2.12.0 at each scope
for (const scope of SCOPES)
{
    run(`AC8-${scope}`, (sb) =>
    {
        sb.mk('.');
        const i = sb.install('.', ROOT_SEL, ['--scope', scope], { src: OLD12 });
        const file = scope === 'local' ? 'settings.local.json' : 'settings.json';
        const before = { ...sb.envOf('.'), ...sb.envOf('.', 'settings.local.json') };
        const ledgerBefore = sb.ledger('.').env || {};
        const rowsBefore = { ...(ledgerBefore['settings.json'] || {}), ...(ledgerBefore['settings.local.json'] || {}) };
        const u = sb.update('.', ['--scope', scope]);
        const show = sb.show('.').map;
        const diff = Object.entries(before).filter(([k]) => SEEDED.includes(k)).filter(([k, v]) => (show[k] || {}).value !== String(v)).map(([k, v]) => `${k}: ${v} -> ${JSON.stringify(show[k])}`);
        const rowsAfter = (sb.ledger('.').env || {})['.variables'] || {};
        const rowDiff = Object.entries(rowsBefore).filter(([k]) => SEEDED.includes(k)).filter(([k, h]) => rowsAfter[k] !== h).map(([k]) => k);
        const left = Object.keys({ ...sb.envOf('.'), ...sb.envOf('.', 'settings.local.json') }).filter((k) => SEEDED.includes(k));
        const h1 = treeHash(sb.at('.')); const u2 = sb.update('.', ['--scope', scope]); const h2 = treeHash(sb.at('.'));
        check(`AC8 ${scope}: every key reads its 2.12.0 value, its ledger row moved at the same hash, the settings keep none, a second update changes no file`,
            i.code === 0 && u.code === 0 && u2.code === 0 && Object.keys(before).length > 3 && !diff.length && !rowDiff.length && !left.length && !changed(h1, h2).length,
            `install ${i.code} update ${u.code}/${u2.code} (${file})\nvalue diffs: ${diff.join('; ')}\nrow diffs: ${rowDiff}\nleft in settings: ${left}\nsecond update changed: ${changed(h1, h2)}\n${u.out.slice(-1200)}`);
    });
}
run('AC8-own-line', (sb) =>
{
    sb.mk('.');
    sb.install('.', ROOT_SEL, [], { src: OLD12 });
    fs.writeFileSync(path.join(sb.at('.'), '.gitignore'), '.alfred/\n');
    const s0 = readOr(path.join(sb.at('.'), '.claude', 'settings.json'));
    const u = sb.update('.');
    check('AC8 a user\'s own repo-level .alfred/ line stops the move: settings.json byte-identical, the !! line names the rule',
        u.code === 0 && readOr(path.join(sb.at('.'), '.claude', 'settings.json')) === s0 && /!! variables:.*\.gitignore:1/.test(u.out), u.out.split('\n').filter((l) => /variables|gitignore/.test(l)).join('\n'));
});

// ---------------------------------------------------------------- AC9 - an update over v2.10.0
for (const scope of SCOPES)
{
    run(`AC9-${scope}`, (sb) =>
    {
        sb.mk('.', false); sb.mk('api');
        const i = sb.install('api', ROOT_SEL, ['--scope', scope], { src: OLD10 });
        const u = sb.update('api', ['--scope', scope]);
        const vars = sb.varsOf('api');
        const left = Object.keys({ ...sb.envOf('api'), ...sb.envOf('api', 'settings.local.json') }).filter((k) => /^ALFRED_CODE_/.test(k) && !['ALFRED_CODE_DATA_PATH', 'ALFRED_CODE_HOOKS_OFF'].includes(k));
        const quiet = sb.asks('api');
        check(`AC9 ${scope}: renamed and moved, no workspace file, no ask with nothing above`,
            i.code === 0 && u.code === 0 && SEEDED.every((k) => k in vars) && !left.length && sb.wsFile('api') === null && !asksLine(quiet.out),
            `install ${i.code} update ${u.code}; missing ${SEEDED.filter((k) => !(k in vars))}; left ${left}; ws file ${sb.wsFile('api')}; ${quiet.out}\n${u.out.slice(-800)}`);
        sb.install('.', ROOT_SEL, ['--scope', scope]);
        const ask = sb.asks('api');
        check(`AC9 ${scope}: one ask with a joinable folder above`, asksLine(ask.out) === 'never ..', ask.out);
    });
}

// ---------------------------------------------------------------- AC10 - the user's config is kept
run('AC10', (sb) =>
{
    sb.mk('.');
    sb.install('.', ROOT_SEL, [], { src: OLD12 });
    sb.setEnv('.', 'settings.json', { ALFRED_CODE_SCORER_LEVEL: '85', ALFRED_CODE_ALLOW_WRITE_OUTSIDE: '1' });
    sb.setEnv('.', 'settings.local.json', { ALFRED_CODE_HISTORY: '7' });
    const u = sb.update('.');
    const vars = sb.varsOf('.'); const rowsV = (sb.ledger('.').env || {})['.variables'] || {};
    const show = sb.show('.').map;
    check('AC10 a hand-typed value moves unchanged and unledgered; a non-catalog key stays in settings; a differing settings.local.json key stays, is named and wins',
        u.code === 0 && vars.ALFRED_CODE_SCORER_LEVEL === '85' && !rowsV.ALFRED_CODE_SCORER_LEVEL && sb.envOf('.').ALFRED_CODE_ALLOW_WRITE_OUTSIDE === '1'
        && sb.envOf('.', 'settings.local.json').ALFRED_CODE_HISTORY === '7' && /ALFRED_CODE_HISTORY/.test(u.out.split('\n').filter((l) => /settings\.local\.json/.test(l)).join('\n'))
        && show.ALFRED_CODE_HISTORY?.value === '7' && show.ALFRED_CODE_HISTORY?.source === 'settings.local.json',
        `vars ${JSON.stringify(vars)}\nrow ${rowsV.ALFRED_CODE_SCORER_LEVEL}\nsettings ${JSON.stringify(sb.envOf('.'))}\nlocal ${JSON.stringify(sb.envOf('.', 'settings.local.json'))}\nshow ${JSON.stringify(show.ALFRED_CODE_HISTORY)}\n${u.out.split('\n').filter((l) => /HISTORY|local/.test(l)).join('\n')}`);
    const v0 = readOr(sb.varsFile('.'));
    const set = sb.vars('.', 'set', ['ALFRED_CODE_HISTORY=9']);
    check('AC10 configure\'s change of that key lands in settings.local.json, names the file, leaves .variables unchanged',
        set.code === 0 && sb.envOf('.', 'settings.local.json').ALFRED_CODE_HISTORY === '9' && /settings\.local\.json/.test(set.out) && readOr(sb.varsFile('.')) === v0, `${set.out}\n${JSON.stringify(sb.envOf('.', 'settings.local.json'))}`);
    fs.writeFileSync(sb.varsFile('.'), `# my note\nNOT_A_KEY_LINE\n${readOr(sb.varsFile('.'))}`);
    sb.vars('.', 'set', ['--scope', 'project', 'ALFRED_CODE_SCORER_ROUNDS=4']); sb.update('.');
    const kept = readOr(sb.varsFile('.'), '');
    check('AC10 comments and unknown lines in .variables survive a set and an update', /^# my note$/m.test(kept) && /^NOT_A_KEY_LINE$/m.test(kept) && pairs(kept).ALFRED_CODE_SCORER_ROUNDS === '4', kept);
});
run('AC10-local', (sb) =>
{
    sb.mk('.');
    fs.mkdirSync(path.join(sb.at('.'), '.claude'), { recursive: true });
    const team = `${JSON.stringify({ env: { ALFRED_CODE_SCORER_LEVEL: '70' }, permissions: { allow: ['Bash(ls)'] } }, null, 2)}\n`;
    fs.writeFileSync(path.join(sb.at('.'), '.claude', 'settings.json'), team);
    sb.commit('.', ['.claude/settings.json']);
    const r = sb.install('.', ROOT_SEL, ['--scope', 'local']);
    check('AC10 a local-scope run leaves a tracked settings.json byte-identical and seeds none of its keys',
        r.code === 0 && readOr(path.join(sb.at('.'), '.claude', 'settings.json')) === team, `${r.code}\n${readOr(path.join(sb.at('.'), '.claude', 'settings.json'))}`);
});

// ---------------------------------------------------------------- AC11 - missing, empty and garbage input
run('AC11', (sb) =>
{
    sb.mk('.');
    sb.install('.', ROOT_SEL);
    const f = sb.varsFile('.');
    const read = (extra) => sb.hookEnv('.', ['ALFRED_CODE_SCORER_LEVEL', 'ALFRED_CODE_DATA_PATH'], extra);
    fs.rmSync(f); const none = read({ ALFRED_CODE_SCORER_LEVEL: '61' });
    fs.writeFileSync(f, ''); const empty = read({ ALFRED_CODE_SCORER_LEVEL: '62' });
    check('AC11 no file and a 0-byte file both read the process env', none.ALFRED_CODE_SCORER_LEVEL === '61' && empty.ALFRED_CODE_SCORER_LEVEL === '62', JSON.stringify({ none, empty }));
    fs.writeFileSync(f, 'this line is garbage\nALFRED_CODE_SCORER_LEVEL=63\n');
    const g = sb.show('.'); const gs = sb.vars('.', 'set', ['ALFRED_CODE_SCORER_ROUNDS=5']);
    check('AC11 a garbage line is kept and named', g.map.ALFRED_CODE_SCORER_LEVEL?.value === '63' && /!! variables:.*line 1/.test(g.out) && gs.code === 0 && /^this line is garbage$/m.test(readOr(f, '')), `${g.out}\n${gs.out}\n${readOr(f)}`);
    fs.writeFileSync(f, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('ALFRED_CODE_SCORER_LEVEL=64\r\n', 'utf16le')])); const u16 = read();
    fs.writeFileSync(f, `﻿ALFRED_CODE_SCORER_LEVEL=65\n`); const bom = read();
    check('AC11 a UTF-16 file and a BOM file read', u16.ALFRED_CODE_SCORER_LEVEL === '64' && bom.ALFRED_CODE_SCORER_LEVEL === '65', JSON.stringify({ u16, bom }));
    fs.rmSync(f); fs.mkdirSync(f); const dir = read({ ALFRED_CODE_SCORER_LEVEL: '66' }); const dirShow = sb.show('.');
    check('AC11 a folder named .variables is no file', dir.ALFRED_CODE_SCORER_LEVEL === '66' && !/Error|EISDIR/.test(dirShow.out), `${JSON.stringify(dir)}\n${dirShow.out}`);
    fs.rmSync(f, { recursive: true });
    fs.writeFileSync(f, 'ALFRED_CODE_SCORER_LEVEL=67\nALFRED_CODE_DATA_PATH=elsewhere\n');
    fs.writeFileSync(path.join(sb.at('.'), '.claude', 'settings.local.json'), '{ not json');
    const bad = read(); const badShow = sb.show('.');
    check('AC11 an unparseable settings.local.json skips step 2; a DATA_PATH line is ignored and named',
        bad.ALFRED_CODE_SCORER_LEVEL === '67' && bad.ALFRED_CODE_DATA_PATH !== 'elsewhere' && /!! variables:.*ALFRED_CODE_DATA_PATH/.test(badShow.out), `${JSON.stringify(bad)}\n${badShow.out}`);
    fs.rmSync(path.join(sb.at('.'), '.claude', 'settings.local.json'));
    // two writers at once, through the lock: six pairs started together, each on its own key
    const cli = JSON.stringify(path.join(EXPORT, 'scripts', 'variables.js'));
    const pairsAtOnce = Array.from({ length: 6 }, (_, n) => `"${process.execPath}" ${cli} set --root . ALFRED_CODE_FRESH_SESSION_AFTER_HOURS=${n + 3} & "${process.execPath}" ${cli} set --root . ALFRED_CODE_HISTORY=${n + 3} &`).join(' ');
    spawnSync('sh', ['-c', `${pairsAtOnce} wait`], { cwd: sb.at('.'), env: sb.env, timeout: 120000 });
    const v = pairs(readOr(f, ''));
    check('AC11 two writers on one .variables at once both land, through the lock', /^\d+$/.test(v.ALFRED_CODE_FRESH_SESSION_AFTER_HOURS || '') && /^\d+$/.test(v.ALFRED_CODE_HISTORY || '') && v.ALFRED_CODE_SCORER_LEVEL === '67', readOr(f));
});

// ---------------------------------------------------------------- AC12 + AC13 - the order and the chain, through real hooks
run('AC12', (sb) =>
{
    sb.mk('.', false); sb.mk('api'); sb.mk('api/tool');
    sb.install('.', ROOT_SEL); sb.ws('.', 'role', ['--answer', 'root']);
    sb.initChild('api'); sb.initChild('api/tool');
    sb.vars('.', 'set', ['ALFRED_CODE_SCORER_LEVEL=90', 'ALFRED_CODE_MAXIMUM_RUN_AGENTS=3', 'ALFRED_CODE_DOCS_VERSIONING=local']);
    const tool0 = treeHash(sb.at('api/tool'));
    const ga = sb.hook('api/tool', 'guard-answer.js', { hook_event_name: 'UserPromptSubmit', prompt: 'hello' });
    const t = sb.hookEnv('api/tool', ['ALFRED_CODE_SCORER_LEVEL', 'ALFRED_CODE_DOCS_VERSIONING', 'ALFRED_CODE_WORKSPACE']);
    check('AC13 the root\'s SCORER_LEVEL 90 and agent cap 3 reach a hook in ws/api/tool with no run there; DOCS_VERSIONING stays its own',
        t.ALFRED_CODE_SCORER_LEVEL === '90' && /Agents at once: 3/.test(ga.out) && t.ALFRED_CODE_DOCS_VERSIONING !== 'local' && !changed(tool0, treeHash(sb.at('api/tool'))).length, `${JSON.stringify(t)}\n${ga.out.slice(0, 600)}`);
    // step 2 over 3 over 4 over 5: settings.local.json, .variables, settings env, launch, then a member
    sb.vars('api', 'set', ['--scope', 'project', 'ALFRED_CODE_HISTORY=4']);
    sb.setEnv('api', 'settings.json', { ALFRED_CODE_FRESH_SESSION_AFTER_HOURS: '6' });
    const order = (extra) => sb.hookEnv('api', ['ALFRED_CODE_HISTORY', 'ALFRED_CODE_FRESH_SESSION_AFTER_HOURS', 'ALFRED_CODE_SCORER_LEVEL'], extra);
    const o1 = order({ ALFRED_CODE_HISTORY: '1', ALFRED_CODE_FRESH_SESSION_AFTER_HOURS: '1' });
    sb.setEnv('api', 'settings.local.json', { ALFRED_CODE_HISTORY: '2' });
    const o2 = order({ ALFRED_CODE_HISTORY: '1' });
    const o3 = order({ ALFRED_CODE_WORKSPACE: '0' });
    check('AC12 the order: settings.local.json over .variables over the settings env over the launch env over a member; a launch 0 freezes the chain',
        o1.ALFRED_CODE_HISTORY === '4' && o1.ALFRED_CODE_FRESH_SESSION_AFTER_HOURS === '6' && o1.ALFRED_CODE_SCORER_LEVEL === '90' && o2.ALFRED_CODE_HISTORY === '2' && o3.ALFRED_CODE_SCORER_LEVEL !== '90',
        JSON.stringify({ o1, o2, o3 }));
    const ig = sb.ws('api', 'ignore', ['--add', 'env ALFRED_CODE_SCORER_LEVEL']);
    const after = { api: sb.hookEnv('api', ['ALFRED_CODE_SCORER_LEVEL']).ALFRED_CODE_SCORER_LEVEL, tool: sb.hookEnv('api/tool', ['ALFRED_CODE_SCORER_LEVEL']).ALFRED_CODE_SCORER_LEVEL };
    check('AC12 ignore env K in ws/api stops K from ws for ws/api and ws/api/tool', ig.code === 0 && after.api !== '90' && after.tool !== '90', `${ig.out}\n${JSON.stringify(after)}`);
    sb.setEnv('.', 'settings.json', { ALFRED_CODE_HOOKS_OFF: 'guard-ungated-commit:push' });
    sb.setEnv('api', 'settings.json', { ALFRED_CODE_HOOKS_OFF: 'docs-session' });
    const off = sb.hookEnv('api', ['ALFRED_CODE_HOOKS_OFF']).ALFRED_CODE_HOOKS_OFF;
    sb.ws('api', 'ignore', ['--add', 'env ALFRED_CODE_HOOKS_OFF']);
    const off2 = sb.hookEnv('api', ['ALFRED_CODE_HOOKS_OFF']).ALFRED_CODE_HOOKS_OFF;
    check('AC12 the root\'s guard-ungated-commit:push reaches a child as docs-session,guard-ungated-commit:push and leaves under ignore env HOOKS_OFF',
        off === 'docs-session,guard-ungated-commit:push' && off2 === 'docs-session', JSON.stringify({ off, off2 }));
});

// ---------------------------------------------------------------- AC14 - a 2.12.0 tree with the switch at 1
run('AC14', (sb) =>
{
    const ON = { ALFRED_CODE_WORKSPACE: '1' };
    sb.mk('.', false); sb.mk('api');
    sb.install('.', ROOT_SEL, [], { src: OLD12, extra: ON });
    sb.setEnv('.', 'settings.json', { ALFRED_CODE_SCORER_LEVEL: '90' });
    const acct = sb.account(); acct.projects = { ...(acct.projects || {}), [fs.realpathSync(sb.at('.'))]: { mcpServers: { shared: { type: 'stdio', command: 'echo', args: [] } } } }; sb.setAccount(acct);
    const c = sb.initChild12('api', CHILD_SEL, [], ON);
    const stamp0 = sb.stamp('api');
    const keys = ['ALFRED_CODE_SCORER_LEVEL', 'ALFRED_CODE_HISTORY', 'ALFRED_CODE_DOCS_VERSIONING'];
    const before = sb.hookEnv('api', keys, ON);
    const acct0 = JSON.stringify(sb.account().projects?.[fs.realpathSync(sb.at('api'))]?.mcpServers || null);
    sb.update('.');
    const u = sb.update('api');
    const after = sb.hookEnv('api', keys);
    const copies = Object.keys(sb.envOf('api')).filter((k) => SEEDED.includes(k));
    const state = fs.existsSync(path.join(sb.at('api'), '.alfred', 'state', 'workspace-mcp.json'));
    check('AC14 the child\'s copies leave its settings, own-env and workspace-mcp lines go, every value reads the same, the account registrations byte-identical, one line names them',
        c.inst.code === 0 && /^own-env:/m.test(stamp0) && u.code === 0 && !copies.length && !/^own-env:/m.test(sb.stamp('api')) && !/^workspace-mcp:/m.test(sb.stamp('api')) && !state
        && JSON.stringify(after) === JSON.stringify(before) && JSON.stringify(sb.account().projects?.[fs.realpathSync(sb.at('api'))]?.mcpServers || null) === acct0,
        `own-env before: ${/^own-env:.*$/m.exec(stamp0)?.[0]}\ncopies left ${copies}\nstamp ${sb.stamp('api').split('\n').filter((l) => /own-env|workspace-mcp/.test(l))}\nstate ${state}\nbefore ${JSON.stringify(before)}\nafter ${JSON.stringify(after)}\nacct ${acct0}\n${u.out.split('\n').filter((l) => /workspace|mcp|copies/i.test(l)).join('\n')}`);
}, { account: true });

// ---------------------------------------------------------------- AC15 - leaving keeps the values
run('AC15', (sb) =>
{
    sb.mk('.', false); sb.mk('api');
    sb.install('.', ROOT_SEL); sb.ws('.', 'role', ['--answer', 'root']); sb.initChild('api');
    sb.vars('.', 'set', ['ALFRED_CODE_SCORER_LEVEL=90', 'ALFRED_CODE_HISTORY=6']);
    const keys = SEEDED;
    const before = sb.hookEnv('api', keys);
    const leave = sb.ws('api', 'role', ['--answer', 'leave:standalone']);
    const after = sb.hookEnv('api', keys);
    const v = sb.varsOf('api');
    check('AC15 configure\'s leave in ws/api: its file holds each inherited value and every value reads the same',
        leave.code === 0 && v.ALFRED_CODE_SCORER_LEVEL === '90' && v.ALFRED_CODE_HISTORY === '6' && JSON.stringify(after) === JSON.stringify(before), `${leave.out}\n${JSON.stringify(v)}\n${changed(before, after)}`);
});
run('AC15-gone', (sb) =>
{
    sb.mk('.', false); sb.mk('api');
    sb.install('.', ROOT_SEL); sb.ws('.', 'role', ['--answer', 'root']); sb.initChild('api');
    fs.rmSync(path.join(sb.at('.'), '.claude'), { recursive: true, force: true }); fs.rmSync(path.join(sb.at('.'), '.alfred'), { recursive: true, force: true });
    const leave = sb.ws('api', 'role', ['--answer', 'leave:standalone']);
    const u = sb.update('api');
    const v = sb.varsOf('api');
    check('AC15 with ws gone: the leave names the keys that went back to the defaults, and the update seeds the child as a standalone',
        leave.code === 0 && /read the stack's defaults here now \(ALFRED_CODE_/.test(leave.out) && u.code === 0 && SEEDED.every((k) => k in v), `${leave.out}\n${u.out.slice(-600)}\n${Object.keys(v)}`);
});

// ---------------------------------------------------------------- AC16 - a tracked .variables and a local-scope answer
run('AC16', (sb) =>
{
    sb.mk('.');
    sb.install('.', ROOT_SEL);
    sb.commit('.', ['.alfred/.variables', '.alfred/.gitignore']);
    const v0 = readOr(sb.varsFile('.'));
    const set = sb.vars('.', 'set', ['--scope', 'local', 'ALFRED_CODE_SCORER_LEVEL=70']);
    check('AC16 a local-scope answer leaves the tracked .variables byte-identical and prints the !! line',
        readOr(sb.varsFile('.')) === v0 && /!! variables:.*tracked/.test(set.out), `${set.code}\n${set.out}`);
});

// ---------------------------------------------------------------- AC17 - the guard key and the secret guard
run('AC17', (sb) =>
{
    sb.mk('.');
    sb.install('.', 'skill javascript\nrule alfred-security\nhook guard-secret-value\nhook file-guards\nhook shell-guards\n');
    fs.writeFileSync(path.join(sb.at('.'), '.alfred', '.secrets'), `API_${'TOKEN'}=${crypto.randomBytes(12).toString('hex')}\n`);
    const pre = (tool, input) => sb.hook('.', tool === 'Read' ? 'file-guards.js' : 'shell-guards.js', { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input });
    const denied = (r) => /"permissionDecision"\s*:\s*"deny"/.test(r.stdout) || r.code === 2;
    const readVars = pre('Read', { file_path: sb.varsFile('.') });
    const catVars = pre('Bash', { command: 'cat .alfred/.variables' });
    const readSecrets = pre('Read', { file_path: path.join(sb.at('.'), '.alfred', '.secrets') });
    check('AC17 a Read and a cat of .variables pass the secret guard; .secrets stays denied', !denied(readVars) && !denied(catVars) && denied(readSecrets),
        `read vars ${readVars.code} ${readVars.stdout.slice(0, 200)}\ncat ${catVars.code} ${catVars.stdout.slice(0, 200)}\nread secrets ${readSecrets.code} ${readSecrets.stdout.slice(0, 200)}`);
    fs.appendFileSync(sb.varsFile('.'), 'ALFRED_CODE_HOOKS_OFF=guard-secret-value\n');
    const still = pre('Read', { file_path: path.join(sb.at('.'), '.alfred', '.secrets') });
    const named = sb.show('.');
    check('AC17 a hand-added HOOKS_OFF=guard-secret-value line in .variables leaves the guard running and is named', denied(still) && /!! variables:.*ALFRED_CODE_HOOKS_OFF/.test(named.out), `${still.stdout.slice(0, 200)}\n${named.out}`);
    const setOff = sb.vars('.', 'set', ['ALFRED_CODE_HOOKS_OFF=x']);
    check('AC17 variables.js set ALFRED_CODE_HOOKS_OFF=x exits 1 naming settings.json', setOff.code === 1 && /settings\.json/.test(setOff.out), setOff.out);
    const secret = `${'gh'}p_${crypto.randomBytes(18).toString('hex')}`; // built at run time: one of the stack's credential shapes
    const setCred = sb.vars('.', 'set', [`ALFRED_CODE_FORGE_WATCH=${secret}`]);
    const anywhere = [setCred.out, readOr(sb.varsFile('.'), ''), sb.stamp('.'), JSON.stringify(sb.settingsOf('.')), JSON.stringify(sb.settingsOf('.', 'settings.local.json'))].some((s) => s.includes(secret));
    check('AC17 a credential-shaped value is refused, naming the key, and no output or file holds it', setCred.code !== 0 && /ALFRED_CODE_FORGE_WATCH/.test(setCred.out) && !anywhere, `${setCred.code}\n${setCred.out.replace(secret, '<value>')}\nheld somewhere: ${anywhere}`);
    const hooksOffAt = { fresh: 'ALFRED_CODE_HOOKS_OFF' in sb.envOf('.'), inVars: 'ALFRED_CODE_HOOKS_OFF' in pairs(readOr(sb.varsFile('.'), '').replace(/^ALFRED_CODE_HOOKS_OFF=guard-secret-value\n/m, '')) };
    check('AC17 HOOKS_OFF sits in .claude/settings.json after a fresh install, never seeded into .variables', hooksOffAt.fresh && !hooksOffAt.inVars, JSON.stringify(hooksOffAt));
});
run('AC17-update', (sb) =>
{
    sb.mk('.');
    sb.install('.', 'skill javascript\nrule alfred-security\nhook guard-secret-value\n', [], { src: OLD12 });
    const off0 = sb.envOf('.').ALFRED_CODE_HOOKS_OFF;
    const u = sb.update('.');
    check('AC17 after an update over 2.12.0, HOOKS_OFF stays in .claude/settings.json and never enters .variables',
        u.code === 0 && off0 !== undefined && sb.envOf('.').ALFRED_CODE_HOOKS_OFF === off0 && !('ALFRED_CODE_HOOKS_OFF' in sb.varsOf('.')), `${off0} -> ${sb.envOf('.').ALFRED_CODE_HOOKS_OFF}; vars ${Object.keys(sb.varsOf('.'))}`);
});

// ---------------------------------------------------------------- AC18 - the MCP hint
run('AC18', (sb) =>
{
    sb.mk('.', false); sb.mk('api'); sb.mk('web');
    sb.install('.', ROOT_SEL); sb.ws('.', 'role', ['--answer', 'root']);
    sb.initChild('api'); sb.initChild('web');
    const inline = `v${crypto.randomBytes(10).toString('hex')}`;
    const acct = sb.account();
    acct.projects = { ...(acct.projects || {}),
        [fs.realpathSync(sb.at('.'))]: { mcpServers: { alpha: { type: 'stdio', command: 'echo', args: ['a'] }, beta: { type: 'stdio', command: 'echo', args: ['b'], env: { BETA_KEY: inline } } } },
        [fs.realpathSync(sb.at('web'))]: { mcpServers: { beta: { type: 'stdio', command: 'echo', args: ['own'] } } } };
    sb.setAccount(acct);
    const calls0 = sb.calls();
    const u = sb.update('api'); const st = sb.ws('api', 'status');
    const uw = sb.update('web');
    const files = [sb.stamp('api'), readOr(path.join(sb.at('api'), '.alfred', 'state', 'workspace-mcp.json'), ''), readOr(sb.varsFile('api'), '')].join('\n');
    const leak = [u.out, st.out, files].some((s) => s.includes(inline) || s.includes('"args"'));
    check('AC18 ws/api\'s update and status name both of ws\'s local servers, and nothing holds an entry\'s JSON or value',
        u.code === 0 && /mcp alpha:/.test(u.out) && /mcp beta:/.test(u.out) && /mcp alpha:/.test(st.out) && /mcp beta:/.test(st.out) && !leak, `${u.out.split('\n').filter((l) => /mcp /.test(l)).join('\n')}\n--\n${st.out}\nleak ${leak}`);
    check('AC18 a server registered in ws/web itself is not named there', uw.code === 0 && /mcp alpha:/.test(uw.out) && !/mcp beta:/.test(uw.out), uw.out.split('\n').filter((l) => /mcp /.test(l)).join('\n'));
    sb.ws('api', 'ignore', ['--add', 'mcp alpha']);
    const u2 = sb.update('api');
    const newCalls = sb.calls().slice(calls0.length).split('\n').filter((l) => /^mcp /.test(l));
    check('AC18 ignore mcp silences one; the claude stub logs no mcp call', !/mcp alpha:/.test(u2.out) && /mcp beta:/.test(u2.out) && !newCalls.length, `${u2.out.split('\n').filter((l) => /mcp /.test(l)).join('\n')}\ncalls ${newCalls}`);
    fs.writeFileSync(path.join(sb.work, 'acct', '.claude.json'), '{ not json');
    const bad = sb.ws('api', 'status');
    check('AC18 an unreadable account file prints its one !! line', (bad.out.match(/^!! .*\.claude\.json could not be read/gm) || []).length === 1 && (bad.out.match(/^!! /gm) || []).length === 1, bad.out);
});

// ---------------------------------------------------------------- AC19 - the switch
run('AC19', (sb) =>
{
    sb.mk('.', false); sb.mk('api');
    sb.install('.', ROOT_SEL); sb.ws('.', 'role', ['--answer', 'root']);
    sb.install('api', ROOT_SEL, [], { extra: { ALFRED_CODE_WORKSPACE: '0' } });
    const OFF = { ALFRED_CODE_WORKSPACE: '0' };
    const onAsk = sb.asks('api'); const offAsk = sb.asks('api', OFF);
    check('AC19 unset is on (an ask), a launch 0 asks nothing', asksLine(onAsk.out) === 'never ..' && !asksLine(offAsk.out), `${onAsk.out}\n${offAsk.out}`);
    sb.ws('api', 'role', ['--answer', 'join:..']);
    sb.vars('.', 'set', ['ALFRED_CODE_SCORER_LEVEL=90']);
    const h0 = treeHash(sb.at('.'), ['api']);
    const frozen = sb.hookEnv('api', ['ALFRED_CODE_SCORER_LEVEL'], OFF).ALFRED_CODE_SCORER_LEVEL;
    const u = sb.update('api', [], { extra: OFF });
    check('AC19 a launch 0 reads a chain of one and its update removes nothing', frozen !== '90' && u.code === 0 && /^parent \.\.$/m.test(sb.wsFile('api')) && /^child api$/m.test(sb.wsFile('.')) && !changed(h0, treeHash(sb.at('.'), ['api'])).length,
        `${frozen}\n${changed(h0, treeHash(sb.at('.'), ['api']))}`);
    sb.vars('api', 'set', ['--scope', 'project', 'ALFRED_CODE_WORKSPACE=0']);
    const fileOff = sb.hookEnv('api', ['ALFRED_CODE_SCORER_LEVEL'], { ALFRED_CODE_WORKSPACE: '1' }).ALFRED_CODE_SCORER_LEVEL;
    const twins = [{}, OFF, { ALFRED_CODE_WORKSPACE: '1' }].map((e) => [layout.workspaceOn({ env: e, projectRoot: sb.at('api') }), require(path.join(EXPORT, 'scripts', 'install', 'workspace.js')).workspaceOn({ env: e, projectRoot: sb.at('api') })]);
    check('AC19 a file 0 beats a launch 1; the two workspaceOn twins agree', fileOff !== '90' && twins.every(([a, b]) => a === b) && twins.every(([a]) => a === false), `${fileOff} ${JSON.stringify(twins)}`);
});
run('AC19-copy', (sb) =>
{
    sb.mk('.');
    const r = sb.install('.', 'skill javascript\nrule alfred-security\nhook instrument-tool-usage\n', [], { extra: { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false' } });
    sb.vars('.', 'set', ['ALFRED_CODE_INSTRUMENT=1']);
    const commands = Object.values(sb.settingsOf('.').hooks || {}).flat().flatMap((m) => m.hooks || []).map((h) => h.command || '').filter((c) => /instrument-tool-usage\.js/.test(c));
    // the wired command as Claude Code runs it, with no stack key in the launch env
    const ran = spawnSync('sh', ['-c', commands[0] || 'false'], { cwd: sb.at('.'), env: { ...sb.env, CLAUDE_PROJECT_DIR: sb.at('.') }, encoding: 'utf8',
        input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 'mx-on', cwd: sb.at('.'), tool_name: 'Read', tool_input: { file_path: 'a.txt' } }) });
    const logged = fs.existsSync(path.join(sb.at('.'), '.alfred', 'statistics', 'tools-usage', 'mx-on.jsonl'));
    check('AC19 the copy route logs with INSTRUMENT=1 in .variables, and its wiring carries no shell gate',
        r.code === 0 && commands.length === 1 && !/ALFRED_CODE_INSTRUMENT/.test(commands[0]) && ran.status === 0 && logged, `${r.code} commands ${JSON.stringify(commands)} ran ${ran.status} logged ${logged}\n${(ran.stderr || '').slice(0, 400)}`);
});

// ---------------------------------------------------------------- AC20 - boundaries and cost
run('AC20', (sb) =>
{
    // a chain of stamped folders d0 > d1 > ... > d9, each the next one's parent; every member holds its own HISTORY
    sb.mk('.', false);
    let rel = '.';
    const chainRels = ['.'];
    for (let n = 1; n <= 9; n++) { rel = rel === '.' ? 'd1' : `${rel}/d${n}`; chainRels.push(rel); }
    for (const [i, r] of chainRels.entries())
    {
        fs.mkdirSync(path.join(sb.at(r), '.claude'), { recursive: true }); fs.mkdirSync(path.join(sb.at(r), '.alfred'), { recursive: true });
        fs.writeFileSync(path.join(sb.at(r), '.claude', 'alfred-code.stamp'), 'sha: x\n');
        const lines = [i > 0 ? 'parent ..' : 'role root', i < chainRels.length - 1 ? `child d${i + 1}` : null].filter(Boolean);
        fs.writeFileSync(path.join(sb.at(r), '.alfred', 'workspace'), `${lines.join('\n')}\n`);
        fs.writeFileSync(path.join(sb.at(r), '.alfred', '.variables'), i === 0 ? 'ALFRED_CODE_SCORER_ROUNDS=9\n' : '');
    }
    // the leaf d9 reads a member n hops up; depth 8 is the walk's limit
    const leaf = chainRels[9];
    const at = (hops) => { fs.writeFileSync(path.join(sb.at(chainRels[9 - hops]), '.alfred', '.variables'), `ALFRED_CODE_HISTORY=${hops}\n`); const v = sb.hookEnv(leaf, ['ALFRED_CODE_HISTORY']).ALFRED_CODE_HISTORY; fs.writeFileSync(path.join(sb.at(chainRels[9 - hops]), '.alfred', '.variables'), ''); return v; };
    const depth = { 7: at(7), 8: at(8), 9: at(9) };
    check('AC20 chain depth 7 and 8 read, the ninth member\'s value is not read', depth[7] === '7' && depth[8] === '8' && depth[9] !== '9', JSON.stringify(depth));
    // ignore env at the nearest member and one hop up
    fs.writeFileSync(path.join(sb.at(chainRels[7]), '.alfred', '.variables'), 'ALFRED_CODE_HISTORY=7\n');
    fs.appendFileSync(path.join(sb.at(chainRels[8]), '.alfred', 'workspace'), 'ignore env ALFRED_CODE_HISTORY\n');
    const near = sb.hookEnv(leaf, ['ALFRED_CODE_HISTORY']).ALFRED_CODE_HISTORY;
    fs.writeFileSync(path.join(sb.at(chainRels[8]), '.alfred', 'workspace'), 'parent ..\nchild d9\n');
    fs.appendFileSync(path.join(sb.at(chainRels[7]), '.alfred', 'workspace'), 'ignore env ALFRED_CODE_HISTORY\n');
    fs.writeFileSync(path.join(sb.at(chainRels[6]), '.alfred', '.variables'), 'ALFRED_CODE_HISTORY=6\n');
    const up = sb.hookEnv(leaf, ['ALFRED_CODE_HISTORY']).ALFRED_CODE_HISTORY;
    check('AC20 ignore env at the nearest member and one hop up stops the key from above it', near !== '7' && up === '7', JSON.stringify({ near, up }));
    const leafVars = path.join(sb.at(leaf), '.alfred', '.variables');
    const sized = {};
    for (const v of ['', '7', '12']) { fs.writeFileSync(leafVars, `ALFRED_CODE_SCORER_LEVEL=${v}\nALFRED_CODE_=x\n`); sized[v.length] = sb.hookEnv(leaf, ['ALFRED_CODE_SCORER_LEVEL', 'ALFRED_CODE_']); }
    check('AC20 values of 0, 1 and 2 characters; a key spelled ALFRED_CODE_ alone is ignored',
        sized[0].ALFRED_CODE_SCORER_LEVEL === null && sized[1].ALFRED_CODE_SCORER_LEVEL === '7' && sized[2].ALFRED_CODE_SCORER_LEVEL === '12' && Object.values(sized).every((s) => s.ALFRED_CODE_ === null), JSON.stringify(sized));
    fs.writeFileSync(leafVars, '');
    // cost: p50 over 21 hook starts - standalone (this release vs v2.12.0's prelude), and a leaf 8 deep
    sb.mk('solo'); fs.mkdirSync(path.join(sb.at('solo'), '.claude'), { recursive: true }); fs.writeFileSync(path.join(sb.at('solo'), '.claude', 'alfred-code.stamp'), 'sha: x\n');
    // the three arms interleaved start by start, so drift on a busy machine lands on all of them alike
    const once = (src, rel) => { const t = process.hrtime.bigint(); sb.node(sb.at(rel), ['-e', `require(${JSON.stringify(path.join(src, 'stack', 'hooks', 'hook-prelude.js'))})`], { CLAUDE_PROJECT_DIR: sb.at(rel) }, ''); return Number(process.hrtime.bigint() - t) / 1e6; };
    const arms = { old: [OLD12, 'solo'], solo: [EXPORT, 'solo'], deep: [EXPORT, chainRels[8]] };
    for (const [src, r] of Object.values(arms)) once(src, r);
    const xs = { old: [], solo: [], deep: [] };
    for (let n = 0; n < 21; n++) for (const [k, [src, r]] of Object.entries(arms)) xs[k].push(once(src, r));
    const cost = Object.fromEntries(Object.entries(xs).map(([k, v]) => [k, p50(v)]));
    check(`AC20 cost p50 over 21 starts: standalone ${cost.solo.toFixed(1)} ms vs 2.12.0 ${cost.old.toFixed(1)} ms (within 1), depth 8 ${cost.deep.toFixed(1)} ms (within 5 of standalone)`,
        cost.solo - cost.old <= 1 && cost.deep - cost.solo <= 5, JSON.stringify(cost));
});

// ---------------------------------------------------------------- AC23 - Claude Code's own settings follow the file
for (const scope of ['project', 'local'])
{
    run(`AC23-${scope}`, (sb) =>
    {
        sb.mk('.');
        const file = scope === 'local' ? 'settings.local.json' : 'settings.json';
        sb.install('.', ROOT_SEL, ['--scope', scope, '--auto-compact', 'on'], { src: OLD12 });
        sb.setEnv('.', file, { ALFRED_CODE_MEMORY: 'custom' });
        sb.update('.', ['--scope', scope], { src: OLD12 });
        const pick = () => { const s = sb.settingsOf('.', file); return JSON.stringify({ ms: s.modelSettings || null, mem: s.autoMemoryEnabled }); };
        const before = pick();
        const u = sb.update('.', ['--scope', scope]); const after = pick();
        const ledger = sb.ledger('.');
        const h1 = treeHash(sb.at('.')); sb.update('.', ['--scope', scope]); const h2 = treeHash(sb.at('.'));
        check(`AC23 ${scope}: modelSettings rows and autoMemoryEnabled false are byte-identical after the update, ledgered; a second update changes no file`,
            u.code === 0 && /autoCompactWindow/.test(before) && /"mem":false/.test(before) && after === before && JSON.stringify(ledger).includes('autoCompactWindow') && !changed(h1, h2).length,
            `before ${before}\nafter ${after}\nsecond changed ${changed(h1, h2)}\n${u.out.slice(-600)}`);
        sb.vars('.', 'set', ['--scope', scope, 'ALFRED_CODE_AUTO_COMPACT=0']);
        const u3 = sb.update('.', ['--scope', scope]);
        check(`AC23 ${scope}: AUTO_COMPACT=0 in the stack's values and one more update removes the rows`, u3.code === 0 && !/autoCompactWindow/.test(pick()), `${pick()}\n${u3.out.slice(-400)}`);
    });
}

// ---------------------------------------------------------------- AC24 - a join inherits
for (const via of ['update', 'configure'])
{
    run(`AC24-${via}`, (sb) =>
    {
        sb.mk('.', false); sb.mk('api');
        sb.install('.', ROOT_SEL, [], { src: OLD12 });
        sb.install('api', ROOT_SEL, [], { src: OLD12 });
        sb.setEnv('api', 'settings.json', { ALFRED_CODE_CORRECTION_NUDGE: 'inject' });
        sb.update('.'); sb.ws('.', 'role', ['--answer', 'root']);
        sb.vars('.', 'set', ['ALFRED_CODE_SCORER_LEVEL=90']);
        let picked;
        if (via === 'update')
        {
            const a = sb.asks('api'); const opts = sb.ws('api', 'role', ['--when', 'update']);
            picked = firstAsk(opts.out);
            if (asksLine(a.out) !== 'never ..' || picked?.label !== 'Join .. (Recommended)') { check(`AC24 ${via}: the ask`, false, `${a.out}\n${opts.out}`); return; }
            sb.ws('api', 'role', ['--answer', picked.answer]);
            sb.update('api');
        }
        else
        {
            sb.update('api');
            const opts = sb.ws('api', 'role', ['--when', 'configure']);
            picked = (/^ask: (Join \.\.)\t(.*)$/m.exec(opts.out) || []).slice(1);
            sb.ws('api', 'role', ['--answer', picked[1]]);
        }
        const show = sb.show('api').map;
        const ownSeeded = Object.entries(show).filter(([k, v]) => v.source === 'own' && !['ALFRED_CODE_CORRECTION_NUDGE', 'ALFRED_CODE_DOCS_VERSIONING'].includes(k)).map(([k]) => k);
        check(`AC24 ${via}: SCORER_LEVEL 90 from .., CORRECTION_NUDGE inject its own, no other stack seed its own, DOCS_VERSIONING its own`,
            show.ALFRED_CODE_SCORER_LEVEL?.value === '90' && show.ALFRED_CODE_SCORER_LEVEL?.source === 'from ..' && show.ALFRED_CODE_CORRECTION_NUDGE?.value === 'inject' && show.ALFRED_CODE_CORRECTION_NUDGE?.source === 'own'
            && show.ALFRED_CODE_DOCS_VERSIONING?.source === 'own' && !ownSeeded.length, `${JSON.stringify(show, null, 1)}\nown seeded ${ownSeeded}`);
        const leave = sb.ws('api', 'role', ['--answer', 'leave:standalone']);
        check(`AC24 ${via}: leaving again writes SCORER_LEVEL=90 into its file`, leave.code === 0 && sb.varsOf('api').ALFRED_CODE_SCORER_LEVEL === '90', `${leave.out}\n${JSON.stringify(sb.varsOf('api'))}`);
    });
}

// ---------------------------------------------------------------- the review's fix pass (I1-I4)
run('FX-I1', (sb) =>
{
    sb.mk('.', false); sb.mk('api');
    sb.install('.', ROOT_SEL, [], { src: OLD12 });
    sb.install('api', ROOT_SEL, ['--auto-compact', 'on'], { src: OLD12 });
    // 2.12.0's register with its switch on for that one call: no 2.12.0 install ran after it, so nothing was pruned
    const reg = sb.ws('api', 'register', [], { ALFRED_CODE_WORKSPACE: '1' }, OLD12);
    sb.update('.'); sb.vars('.', 'set', ['ALFRED_CODE_SCORER_LEVEL=90']);
    const u = sb.update('api');
    const v = sb.varsOf('api'); const show = sb.show('api').map;
    check('FX-I1 a 2.12.0 child registered but never pruned keeps its own SCORER_LEVEL 80 and AUTO_COMPACT 1 through the update',
        reg.code === 0 && u.code === 0 && v.ALFRED_CODE_SCORER_LEVEL === '80' && v.ALFRED_CODE_AUTO_COMPACT === '1' && show.ALFRED_CODE_SCORER_LEVEL?.source === 'own'
        && !/a stack seed, so the workspace's value reaches/.test(u.out) && !/^join-prune:/m.test(sb.stamp('api')),
        `${reg.out.slice(-300)}\n${JSON.stringify(v)}\n${JSON.stringify(show.ALFRED_CODE_SCORER_LEVEL)}\n${u.out.slice(-800)}`);
});
run('FX-I2', (sb) =>
{
    sb.mk('.', false); sb.mk('api');
    sb.install('.', ROOT_SEL); sb.ws('.', 'role', ['--answer', 'root']);
    sb.vars('.', 'set', ['ALFRED_CODE_AUTO_COMPACT=1', 'ALFRED_CODE_MEMORY=custom']);
    const c = sb.initChild('api');
    const pick = () => { const s = sb.settingsOf('api'); return { rows: Object.values(s.modelSettings || {}).filter((e) => e && e.autoCompactWindow !== undefined).length, mem: s.autoMemoryEnabled }; };
    const first = pick(); const u = sb.update('api'); const second = pick();
    const own = sb.varsOf('api');
    check('FX-I2 a child reading AUTO_COMPACT=1 and MEMORY=custom from its root writes the autoCompactWindow rows and autoMemoryEnabled false, and keeps them on update',
        c.inst.code === 0 && u.code === 0 && first.rows > 0 && first.mem === false && JSON.stringify(second) === JSON.stringify(first) && own.ALFRED_CODE_AUTO_COMPACT === undefined && own.ALFRED_CODE_MEMORY === undefined,
        `${JSON.stringify({ first, second, own })}\n${c.inst.out.slice(-600)}`);
});
run('FX-I3', (sb) =>
{
    sb.mk('.');
    sb.install('.', ROOT_SEL, [], { src: OLD12 });
    const before = sb.envOf('.');
    fs.writeFileSync(path.join(sb.at('.'), '.alfred', '.gitignore'), '*\n');
    const u = sb.update('.');
    const after = sb.envOf('.');
    const moved = SEEDED.filter((k) => before[k] !== undefined && after[k] !== before[k]);
    check('FX-I3 a data-root .gitignore the user wrote keeps the stack values in settings.json, kept as written, with the hint naming that file',
        u.code === 0 && !moved.length && Object.keys(before).some((k) => SEEDED.includes(k)) && !Object.keys(sb.varsOf('.')).some((k) => SEEDED.includes(k))
        && readOr(path.join(sb.at('.'), '.alfred', '.gitignore')) === '*\n' && /add !\/\.variables to \.alfred\/\.gitignore/.test(u.out),
        `moved ${moved}\n${JSON.stringify(sb.varsOf('.'))}\n${u.out.slice(-800)}`);
});
run('FX-I4', (sb) =>
{
    sb.mk('.');
    sb.install('.', ROOT_SEL);
    const ign = path.join(sb.at('.'), '.alfred', '.gitignore');
    const team = readOr(ign);
    sb.commit('.', ['.alfred/.gitignore', '.alfred/.variables']);
    const l = sb.install('.', ROOT_SEL, ['--scope', 'local']);
    const st = spawnSync('git', ['-C', sb.at('.'), 'status', '--porcelain', '--', '.alfred/.gitignore'], { encoding: 'utf8' }).stdout.trim();
    check('FX-I4 a local-scope run leaves the committed data-root .gitignore and its !/.variables line as the team wrote them',
        /^!\/\.variables$/m.test(team || '') && readOr(ign) === team && st === '', `${st}\n${readOr(ign)}\n${l.out.slice(-600)}`);
});

console.log(rows.join('\n'));
const failed = rows.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${rows.length - failed}/${rows.length} pass, ${failed} fail`);
process.exitCode = failed ? 1 : 0;
