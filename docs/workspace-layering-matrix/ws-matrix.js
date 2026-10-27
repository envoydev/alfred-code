'use strict';
// Workspace layering release 1 - the matrix cases no suite covers, run from a CLEAN EXPORT of the working tree (and of
// v2.10.0 for AC28) in throwaway trees with a throwaway account and a stub `claude`. Every case reads the files.
//   node ws-matrix.js <export> <export-2.10.0> [case ...]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, spawn } = require('node:child_process');
const EXPORT = path.resolve(process.argv[2]);
const OLD = path.resolve(process.argv[3]);
const ONLY = process.argv.slice(4);
const { scrubStackEnv } = require(path.join(EXPORT, 'scripts', 'seed-sandbox.js'));
const PLUGINS = JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true, scope: 'user' }]);
const ROOT_SEL = 'skill javascript\nrule alfred-security\nrule alfred-navigation\n';
const rows = [];
const check = (id, ok, detail = '') => rows.push(`${ok ? 'PASS' : 'FAIL'} ${id}${ok ? '' : `\n     ${String(detail).replace(/\n/g, '\n     ').slice(0, 1500)}`}`);
const readOr = (f, d = null) => { try { return fs.readFileSync(f, 'utf8'); } catch { return d; } };
const json = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const lineOf = (text, key) => { const m = new RegExp(`^${key}: ?(.*)$`, 'm').exec(text || ''); return m ? m[1] : null; };

function sandbox(rootName = 'ws')
{
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wsm-'));
    const bin = path.join(work, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(work, 'plugins.json'), PLUGINS);
    fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$CLAUDE_STUB_LOG"\nif [ "$1" = "plugin" ] && [ "$2" = "list" ]; then cat "$CLAUDE_STUB_PLUGINS"; exit 0; fi\nexit 0\n', { mode: 0o755 });
    for (const t of ['uvx', 'npx', 'npm', 'curl']) fs.writeFileSync(path.join(bin, t), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const env = { ...process.env, HOME: work, CLAUDE_CONFIG_DIR: path.join(work, 'acct'), PATH: bin + path.delimiter + process.env.PATH,
        CLAUDE_STUB_LOG: path.join(work, 'claude-calls.log'), CLAUDE_STUB_PLUGINS: path.join(work, 'plugins.json'), ALFRED_CODE_MEMORY_WARM: '0' };
    for (const k of ['SENTRY_SLUG', 'SENTRY_ACCESS_TOKEN', 'CONTEXT7_API_KEY', 'UV_EXCLUDE_NEWER', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'JAVA_HOME']) delete env[k];
    scrubStackEnv(env);
    const at = (rel = '.') => path.join(work, rootName, ...(rel === '.' ? [] : rel.split('/')));
    const node = (cwd, argv, extra = {}) =>
    {
        const r = spawnSync(process.execPath, argv, { cwd, env: { ...env, ...extra }, encoding: 'utf8', timeout: 600000 });
        return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
    };
    const sel = (text) => { const f = path.join(work, `sel-${crypto.randomBytes(4).toString('hex')}.txt`); fs.writeFileSync(f, text); return f; };
    const sb = {
        work, env, at,
        mk: (rel, git = true) => { fs.mkdirSync(at(rel), { recursive: true }); if (git) spawnSync('git', ['init', '-q', at(rel)]); },
        install: (rel, selection, args = [], { src = EXPORT, extra = {} } = {}) => node(at(rel), [path.join(src, 'scripts', 'install', 'alfred-code.js'), 'install', '--source', src, '--selection', sel(selection), ...args], extra),
        update: (rel, args = [], { src = EXPORT, extra = {} } = {}) => node(at(rel), [path.join(src, 'scripts', 'install', 'alfred-code.js'), 'update', '--source', src, '--installed-only', ...args], extra),
        ws: (rel, verb, args = [], extra = {}) => node(at(rel), [path.join(EXPORT, 'scripts', 'workspace.js'), verb, '--root', '.', ...args], extra),
        preflightAsks: (rel) => node(at(rel), [path.join(EXPORT, 'scripts', 'update-preflight.js'), '--asks', '--root', '.']),
        // init's child flow, as init-child.md runs it: the parent read-back, register, then the install with --parent-plan
        initChild: (rel, selection, args = []) =>
        {
            const parentRel = path.relative(at(rel), path.dirname(at(rel))) || '..';
            const parentDir = path.resolve(at(rel), parentRel);
            const plan = path.join(work, `parent-${crypto.randomBytes(4).toString('hex')}.json`);
            const scope = node(parentDir, [path.join(EXPORT, 'scripts', 'install', 'stamp.js'), 'scope', '.']).out.trim();
            const rb = node(parentDir, [path.join(EXPORT, 'scripts', 'install', 'alfred-code.js'), 'update', '--source', EXPORT, '--scope', scope, '--installed-only', '--print-plan', '--plan-out', plan]);
            const reg = sb.ws(rel, 'register');
            const inst = sb.install(rel, selection, [...(reg.code === 0 ? ['--parent-plan', plan] : []), '--instructions-file', 'agents', '--instructions-at', 'claude', ...args]);
            return { rb, reg, inst, plan };
        },
        stamp: (rel) => readOr(path.join(at(rel), '.claude', 'alfred-code.stamp'), ''),
        wsFile: (rel) => readOr(path.join(at(rel), '.alfred', 'workspace'), ''),
        has: (rel, skill) => fs.existsSync(path.join(at(rel), '.claude', 'skills', skill, 'SKILL.md')),
        excludes: (rel) => (json(path.join(at(rel), '.claude', 'settings.local.json')) || {}).claudeMdExcludes || [],
        envOf: (rel, file = 'settings.json') => ((json(path.join(at(rel), '.claude', file)) || {}).env || {}),
        setEnv: (rel, file, values) =>
        {
            const f = path.join(at(rel), '.claude', file);
            const data = json(f) || {};
            data.env = { ...(data.env || {}), ...values };
            fs.mkdirSync(path.dirname(f), { recursive: true });
            fs.writeFileSync(f, `${JSON.stringify(data, null, 2)}\n`);
        },
        done: () => fs.rmSync(work, { recursive: true, force: true }),
    };
    return sb;
}

// path, size and sha256 of every file under dir, minus the given sub-folders and the stamp's two run times
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
const want = (id) => !ONLY.length || ONLY.includes(id);

// AC7 - every root scope by every child scope; the child's excludes in settings.local.json and the root's set inherited
if (want('AC7'))
{
    for (const [R, C, NAME] of [...['project', 'local', 'user'].flatMap((r) => ['local', 'project', 'user'].map((c) => [r, c, 'ws'])), ['project', 'local', 'my ws (team)']])
    {
        {
            const sb = sandbox(NAME);
            try
            {
                sb.mk('.', false); sb.mk('api');
                const r1 = sb.install('.', ROOT_SEL, ['--scope', R]);
                const c = sb.initChild('api', `${ROOT_SEL}skill npm\n`, ['--scope', C]);
                const ex = sb.excludes('api');
                const plain = ex.map((g) => g.replace(/\[([^\]])[^\]]?\]/g, '$1').toLowerCase());
                const rootFiles = fs.readdirSync(path.join(sb.at('.'), '.claude', 'rules')).map((f) => `/${NAME.toLowerCase()}/.claude/rules/${f.toLowerCase()}`);
                const rootRules = rootFiles.filter((f) => plain.some((g) => g.endsWith(f))).length === rootFiles.length && plain.some((g) => g.endsWith(`/${NAME.toLowerCase()}/.claude/agents.md`)) ? 2 : 0;
                const scopeLine = lineOf(sb.stamp('api'), 'scope') || 'project';
                check(`AC7 root ${R} / child ${C}${NAME === 'ws' ? '' : ` under '${NAME}'`}: register 0, excludes in settings.local.json, the root's skill inherited, the child's own kept, scope ${C}`,
                    r1.code === 0 && c.reg.code === 0 && c.inst.code === 0 && rootRules >= 2 && sb.has('api', 'javascript') && sb.has('api', 'npm') && scopeLine === C,
                    `reg=${c.reg.code} ${c.reg.out}\ninst=${c.inst.code}\nexcludes=${JSON.stringify(plain)}\nroot rules=${JSON.stringify(rootFiles)}\nscope=${scopeLine} js=${sb.has('api', 'javascript')} npm=${sb.has('api', 'npm')}\n${c.inst.out.split('\n').filter((l) => /!!|workspace/.test(l)).join('\n')}`);
            }
            finally { sb.done(); }
        }
    }
}

// AC8 - a local-scope child with a team-tracked settings.json, a tracked .eslintignore and Prettier in package.json
if (want('AC8'))
{
    const sb = sandbox();
    try
    {
        sb.mk('.', false); sb.mk('api');
        sb.install('.', ROOT_SEL);
        const api = sb.at('api');
        fs.mkdirSync(path.join(api, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(api, '.claude', 'settings.json'), '{\n  "permissions": { "allow": ["Bash(ls)"] }\n}\n');
        fs.writeFileSync(path.join(api, '.eslintignore'), 'dist/\n');
        fs.writeFileSync(path.join(api, 'package.json'), '{ "name": "api", "devDependencies": { "prettier": "3.0.0" } }\n');
        spawnSync('git', ['-C', api, 'add', '-A']);
        spawnSync('git', ['-C', api, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'team']);
        const before = { s: readOr(path.join(api, '.claude', 'settings.json')), e: readOr(path.join(api, '.eslintignore')) };
        const c = sb.initChild('api', `${ROOT_SEL}skill npm\n`, ['--scope', 'local']);
        const same = readOr(path.join(api, '.claude', 'settings.json')) === before.s && readOr(path.join(api, '.eslintignore')) === before.e;
        // the exclude answer, as init-child.md's local-scope template writes it: `.claude/*` by hand, then the offered lines in one --apply
        const hyg = (...a) => spawnSync(process.execPath, [path.join(EXPORT, 'scripts', 'git-hygiene.js'), '--root', '.', '--local-child', ...a], { cwd: api, env: sb.env, encoding: 'utf8' });
        const offers = hyg().stdout;
        fs.appendFileSync(path.join(api, '.git', 'info', 'exclude'), '.claude/*\n');
        const hy = hyg('--apply', 'exclude');
        check('AC8 git-hygiene --local-child offers the data root and the created .prettierignore', /^git-hygiene: offer \.alfred\/\t/m.test(offers) && /^git-hygiene: offer \.prettierignore\t/m.test(offers), offers);
        const status = spawnSync('git', ['-C', api, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }).stdout;
        check('AC8 tracked settings.json and .eslintignore byte-identical after a local child install', c.inst.code === 0 && same, c.inst.out.split('\n').filter((l) => /tool ignores|!!/.test(l)).join('\n'));
        check('AC8 after the exclude answer git status lists nothing Alfred wrote', status === '' && hy.status === 0, `${status}\nprettierignore made: ${fs.existsSync(path.join(api, '.prettierignore'))}\nhygiene: ${hy.stdout}${hy.stderr}`);
        const project = spawnSync(process.execPath, [path.join(EXPORT, 'scripts', 'git-hygiene.js'), '--root', '.'], { cwd: api, env: sb.env, encoding: 'utf8' }).stdout;
        check('AC8 without the flag (update, configure) the answer stays as today', !/offer \.prettierignore/.test(project), project);
    }
    finally { sb.done(); }
}

// AC13 - a project installed before its root joins, keeps its items and env; Stay standalone; --rescan lists one
if (want('AC13'))
{
    const sb = sandbox();
    try
    {
        sb.mk('.', false); sb.mk('web'); sb.mk('web2'); sb.mk('web3');
        sb.install('web', 'skill npm\nskill javascript\n');
        sb.setEnv('web', 'settings.json', { ALFRED_CODE_SCORER: '1' });
        sb.install('web2', 'skill npm\n');
        sb.install('web3', 'skill npm\n');
        sb.install('.', ROOT_SEL);
        const settingsBefore = readOr(path.join(sb.at('web'), '.claude', 'settings.json'));
        const stBefore = sb.stamp('web');
        const scopeBefore = lineOf(sb.stamp('web'), 'scope');
        const asks = sb.preflightAsks('web').out;
        check('AC13 the next update of a project installed before its root asks to join', /^workspace: join \.\.$/m.test(asks), asks);
        const j = sb.ws('web', 'join', ['--answer', 'join']);
        const u = sb.update('web');
        const st = sb.stamp('web');
        check('AC13 Join writes both lines and keeps every item; own-picks is what the root lacks',
            j.code === 0 && /^parent \.\.$/m.test(sb.wsFile('web')) && /^child web$/m.test(sb.wsFile('.')) && sb.has('web', 'npm') && sb.has('web', 'javascript')
            && /skill\/npm/.test(lineOf(st, 'own-picks') || '') && !/skill\/javascript/.test(lineOf(st, 'own-picks') || ''),
            `${j.out}\nown-picks: ${lineOf(st, 'own-picks')}\nmd=${sb.has('web', 'markdown-style')} js=${sb.has('web', 'javascript')} skills=${fs.readdirSync(path.join(sb.at('web'), '.claude', 'skills')).join(' ')}\nstamp-before=${stBefore.split('\n').filter((l) => /^(own|skills|library)/.test(l)).join(' | ')}\nstamp-after=${st.split('\n').filter((l) => /^(own|skills|library)/.test(l)).join(' | ')}\n${u.out.split('\n').filter((l) => /!!|workspace|skill/.test(l)).join('\n')}`);
        check('AC13 Join keeps ALFRED_CODE_SCORER=1 as own-env, the scope, and settings.json byte-identical; excludes in settings.local.json',
            sb.envOf('web').ALFRED_CODE_SCORER === '1' && /ALFRED_CODE_SCORER/.test(lineOf(st, 'own-env') || '') && lineOf(st, 'scope') === scopeBefore
            && readOr(path.join(sb.at('web'), '.claude', 'settings.json')) === settingsBefore && sb.excludes('web').length > 0,
            `scorer=${sb.envOf('web').ALFRED_CODE_SCORER} own-env=${lineOf(st, 'own-env')} scope=${lineOf(st, 'scope')} same=${readOr(path.join(sb.at('web'), '.claude', 'settings.json')) === settingsBefore} excludes=${sb.excludes('web').length}`);
        sb.ws('.', 'cascade', ['--source', EXPORT]);
        const c2 = sb.ws('.', 'cascade', ['--source', EXPORT]);
        check('AC13 ALFRED_CODE_SCORER still 1 after a second cascade', sb.envOf('web').ALFRED_CODE_SCORER === '1' && /cascade: web\t/.test(c2.out), c2.out);
        const n = sb.ws('web2', 'join', ['--answer', 'none']);
        const asks2 = sb.preflightAsks('web2').out;
        check('AC13 Stay standalone writes parent none and the next update asks nothing', n.code === 0 && /^parent none$/m.test(sb.wsFile('web2')) && !/workspace: join/.test(asks2), `${sb.wsFile('web2')}\n${asks2}`);
        const plan = sb.ws('.', 'plan', ['--source', EXPORT, '--rescan']).out;
        check('AC13 --rescan at ws lists the unjoined project as join as children', /^rescan: web3$/m.test(plan) && !/^rescan: web2$/m.test(plan) && !/^rescan: web$/m.test(plan), plan);
    }
    finally { sb.done(); }
}

// AC15 - configure in a child: dropping an inherited skill writes the ignore, a cascade leaves it out, adding it back removes the line
if (want('AC15'))
{
    const sb = sandbox();
    try
    {
        sb.mk('.', false); sb.mk('api');
        sb.install('.', ROOT_SEL);
        sb.initChild('api', `${ROOT_SEL}skill npm\n`);
        const i1 = sb.ws('api', 'ignore', ['--add', 'skill javascript']);
        const d = sb.update('api', ['--drop', 'skill javascript']);
        const c = sb.ws('.', 'cascade', ['--source', EXPORT]);
        check('AC15 a dropped inherited skill is an ignore line, and the next cascade leaves it out',
            i1.code === 0 && /^ignore skill javascript$/m.test(sb.wsFile('api')) && !sb.has('api', 'javascript') && /cascade: api\t/.test(c.out) && sb.has('api', 'npm'),
            `${i1.out}${d.out.split('\n').filter((l) => /!!|javascript/.test(l)).join('\n')}\n${c.out}\njs=${sb.has('api', 'javascript')}`);
        const i2 = sb.ws('api', 'ignore', ['--remove', 'skill javascript']);
        sb.update('api', ['--add', 'skill javascript']);
        check('AC15 adding it back removes the line and brings the skill back, not as an own pick',
            i2.code === 0 && !/ignore skill javascript/.test(sb.wsFile('api')) && sb.has('api', 'javascript') && !/skill\/javascript/.test(lineOf(sb.stamp('api'), 'own-picks') || ''),
            `${i2.out}\n${sb.wsFile('api')}\nown-picks=${lineOf(sb.stamp('api'), 'own-picks')}`);
    }
    finally { sb.done(); }
}

// AC17 - removing the account key by hand makes the next update of a child with a CLAUDE.md above it ask again
if (want('AC17'))
{
    const sb = sandbox();
    try
    {
        sb.mk('.', false); sb.mk('api');
        sb.install('.', ROOT_SEL);
        fs.writeFileSync(path.join(sb.at('.'), 'CLAUDE.md'), '# The team root\n');
        sb.initChild('api', `${ROOT_SEL}skill npm\n`);
        const a0 = sb.preflightAsks('api').out;
        const ap = sb.ws('api', 'account-instructions', ['--apply']);
        const a1 = sb.preflightAsks('api').out;
        const acctFile = path.join(sb.work, 'acct', 'settings.json');
        const data = json(acctFile);
        delete data.pluginConfigs;
        fs.writeFileSync(acctFile, `${JSON.stringify(data, null, 2)}\n`);
        const a2 = sb.preflightAsks('api').out;
        check('AC17 asked before, not after --apply, asked again once the key is removed by hand',
            /^instructions-both: ask$/m.test(a0) && ap.code === 0 && !/instructions-both: ask/.test(a1) && /^instructions-both: ask$/m.test(a2), `${a0}\n${ap.out}\n${a1}\n${a2}`);
    }
    finally { sb.done(); }
}

// AC18 - two joins at once in sibling children both leave their child line (the lock)
if (want('AC18'))
{
    const sb = sandbox();
    try
    {
        sb.mk('.', false);
        sb.install('.', ROOT_SEL);
        const runs = [];
        for (let round = 0; round < 5; round++)
        {
            const a = `a${round}`; const b = `b${round}`;
            sb.mk(a); sb.mk(b);
            sb.install(a, 'skill npm\n'); sb.install(b, 'skill npm\n');
            const go = (rel) => new Promise((resolve) => { const p = spawn(process.execPath, [path.join(EXPORT, 'scripts', 'workspace.js'), 'register', '--root', '.'], { cwd: sb.at(rel), env: sb.env }); p.on('close', resolve); });
            runs.push(Promise.all([go(a), go(b)]).then((codes) => ({ a, b, codes })));
        }
        Promise.all(runs).then((all) =>
        {
            const file = sb.wsFile('.');
            const missing = all.flatMap(({ a, b }) => [a, b]).filter((r) => !new RegExp(`^child ${r}$`, 'm').test(file));
            check('AC18 two registers at once in sibling children, five rounds: every child line written, every exit 0', !missing.length && all.every((x) => x.codes.every((c) => c === 0)), `missing=${missing} codes=${JSON.stringify(all.map((x) => x.codes))}\n${file}`);
            sb.done();
            next();
        });
    }
    catch (e) { sb.done(); throw e; }
}
else next();

function next()
{
    // AC28 - a tree installed from v2.10.0 updates to this release; each child joins and keeps every item and env value
    if (want('AC28'))
    {
        const sb = sandbox();
        try
        {
            sb.mk('.', false); sb.mk('api'); sb.mk('web');
            const o1 = sb.install('.', ROOT_SEL, [], { src: OLD });
            sb.install('api', 'skill npm\nrule alfred-security\n', [], { src: OLD });
            sb.install('web', 'skill markdown-style\n', [], { src: OLD });
            sb.setEnv('web', 'settings.json', { ALFRED_CODE_SCORER: '1' });
            const envBefore = { api: sb.envOf('api'), web: sb.envOf('web') };
            const u0 = sb.update('.');
            const res = {};
            for (const rel of ['api', 'web'])
            {
                const asks = sb.preflightAsks(rel).out;
                const j = sb.ws(rel, 'join', ['--answer', 'join']);
                const u = sb.update(rel);
                res[rel] = { asks, j, u };
            }
            const envKept = (rel) => Object.entries(envBefore[rel]).every(([k, v]) => sb.envOf(rel)[k] === v || sb.envOf(rel, 'settings.local.json')[k] === v);
            check('AC28 the v2.10.0 install updates, and each child gets the join ask', o1.code === 0 && u0.code === 0 && /workspace: join \.\./.test(res.api.asks) && /workspace: join \.\./.test(res.web.asks), `${res.api.asks}\n${res.web.asks}\n${u0.out.split('\n').filter((l) => /!!/.test(l)).join('\n')}`);
            check('AC28 each child joins and ends with every item it had plus the root\'s',
                res.api.j.code === 0 && res.web.j.code === 0 && sb.has('api', 'npm') && sb.has('api', 'javascript') && sb.has('web', 'markdown-style') && sb.has('web', 'javascript'),
                `api npm=${sb.has('api', 'npm')} js=${sb.has('api', 'javascript')}; web md=${sb.has('web', 'markdown-style')} js=${sb.has('web', 'javascript')}\n${res.web.u.out.split('\n').filter((l) => /!!|workspace/.test(l)).join('\n')}`);
            check('AC28 each child keeps every env value it had', envKept('api') && envKept('web') && sb.envOf('web').ALFRED_CODE_SCORER === '1', `api=${JSON.stringify(sb.envOf('api'))}\nweb=${JSON.stringify(sb.envOf('web'))}`);
        }
        finally { sb.done(); }
    }

    // AC32 - R2's 'only' halves, by path, size and sha256
    if (want('AC32'))
    {
        const sb = sandbox();
        try
        {
            sb.mk('.', false); sb.mk('web'); sb.mk('api'); sb.mk('api/tool');
            fs.writeFileSync(path.join(sb.at('api/tool'), 'README.md'), '# tool\n');
            sb.install('.', ROOT_SEL);
            sb.initChild('web', `${ROOT_SEL}skill npm\n`);
            const ws0 = treeHash(sb.at('.'), ['api', 'web']); const web0 = treeHash(sb.at('web')); const tool0 = treeHash(sb.at('api/tool'));
            const wsFile0 = sb.wsFile('.');
            const c = sb.initChild('api', `${ROOT_SEL}skill npm\n`);
            const ws1 = treeHash(sb.at('.'), ['api', 'web']);
            const added = sb.wsFile('.').split('\n').filter((l) => !wsFile0.split('\n').includes(l));
            check('AC32 init in ws/api: ws changes by exactly its one child api line, ws/web and ws/api/tool byte-identical',
                c.inst.code === 0 && JSON.stringify(changed(ws0, ws1)) === '[".alfred/workspace"]' && JSON.stringify(added) === '["child api"]'
                && !changed(web0, treeHash(sb.at('web'))).length && !changed(tool0, treeHash(sb.at('api/tool'))).length,
                `ws changed: ${changed(ws0, ws1)}; added: ${JSON.stringify(added)}; web: ${changed(web0, treeHash(sb.at('web')))}; tool: ${changed(tool0, treeHash(sb.at('api/tool')))}`);
            sb.initChild('api/tool', `${ROOT_SEL}skill npm\n`);
            const ws2 = treeHash(sb.at('.'), ['api', 'web']); const web2 = treeHash(sb.at('web')); const tool2 = treeHash(sb.at('api/tool'));
            // update in ws/api, as update runs it: its own installer call (one change, so the child has something to take), then the cascade below it
            const u = sb.update('api', ['--add', 'skill sqlite']);
            const cas = sb.ws('api', 'cascade', ['--source', EXPORT]);
            check('AC32 update in ws/api: ws/api/tool is updated, ws and ws/web byte-identical',
                u.code === 0 && /^cascade: tool\tupdated$/m.test(cas.out) && sb.has('api/tool', 'sqlite') && changed(tool2, treeHash(sb.at('api/tool'))).length > 0
                && !changed(ws2, treeHash(sb.at('.'), ['api', 'web'])).length && !changed(web2, treeHash(sb.at('web'))).length,
                `${cas.out}\nws: ${changed(ws2, treeHash(sb.at('.'), ['api', 'web']))}; web: ${changed(web2, treeHash(sb.at('web')))}`);
        }
        finally { sb.done(); }
    }
    console.log(rows.join('\n'));
    const failed = rows.filter((r) => r.startsWith('FAIL')).length;
    console.log(`\n${rows.length - failed}/${rows.length} pass`);
    process.exitCode = failed ? 1 : 0;
}
