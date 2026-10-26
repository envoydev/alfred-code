'use strict';
// Workspace layering release 1 on Windows: AC7 (a child at each scope, init's child flow) with .cmd stubs for the
// installer's claude calls, then AC2 + the keyed count of AC30 with the REAL claude.exe, from a lowercase-typed and an
// all-caps cwd. The root folder is 'my ws (team)': a space and glob metacharacters, case-folded classes on top.
//   node ws-win.js <export> <claude.exe>
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const EXPORT = path.resolve(process.argv[2]);
const REAL = process.argv[3];
const { scrubStackEnv } = require(path.join(EXPORT, 'scripts', 'seed-sandbox.js'));
const ws = require(path.join(EXPORT, 'scripts', 'install', 'workspace.js'));
const runtime = require(path.join(EXPORT, 'scripts', 'install', 'runtime.js'));
const ROOT_SEL = 'skill javascript\nrule alfred-security\nrule alfred-navigation\n';
const NAME = 'my ws (team)';
const rows = [];
const check = (id, ok, detail = '') => rows.push(`${ok ? 'PASS' : 'FAIL'} ${id}${ok ? '' : `\n     ${String(detail).replace(/\n/g, '\n     ').slice(0, 2000)}`}`);
const json = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const plainOf = (g) => g.replace(/\[([^\]])[^\]]?\]/g, '$1').toLowerCase();

function sandbox()
{
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wsw-'));
    const bin = path.join(work, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(work, 'plugins.json'), JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true, scope: 'user' }]));
    // an npm-style shim: the .cmd hands %* to node, the way the runtime's caret escaping expects
    fs.writeFileSync(path.join(bin, 'claude-stub.js'), "const a = process.argv.slice(2);\nif (a[0] === 'plugin' && a[1] === 'list') process.stdout.write(require('node:fs').readFileSync(process.env.CLAUDE_STUB_PLUGINS, 'utf8'));\n");
    fs.writeFileSync(path.join(bin, 'claude.cmd'), `@"${process.execPath}" "${path.join(bin, 'claude-stub.js')}" %*\r\n`);
    for (const t of ['uvx', 'npx', 'npm', 'curl']) fs.writeFileSync(path.join(bin, `${t}.cmd`), '@exit /b 1\r\n');
    const env = { ...process.env, HOME: work, USERPROFILE: work, CLAUDE_CONFIG_DIR: path.join(work, 'acct'), PATH: `${bin};${process.env.PATH}`,
        CLAUDE_STUB_PLUGINS: path.join(work, 'plugins.json'), ALFRED_CODE_MEMORY_WARM: '0' };
    for (const k of ['SENTRY_SLUG', 'SENTRY_ACCESS_TOKEN', 'CONTEXT7_API_KEY', 'UV_EXCLUDE_NEWER', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'JAVA_HOME']) delete env[k];
    scrubStackEnv(env);
    const at = (rel = '.') => path.join(work, NAME, ...(rel === '.' ? [] : rel.split('/')));
    const node = (cwd, argv) => { const r = spawnSync(process.execPath, argv, { cwd, env, encoding: 'utf8', timeout: 600000 }); return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }; };
    let n = 0;
    const sel = (text) => { const f = path.join(work, `sel-${n += 1}.txt`); fs.writeFileSync(f, text); return f; };
    const seed = path.join(EXPORT, 'scripts', 'install', 'alfred-code.js');
    return {
        work, env, at,
        mk: (rel, git = true) => { fs.mkdirSync(at(rel), { recursive: true }); if (git) spawnSync('git', ['init', '-q', at(rel)]); },
        install: (rel, selection, args = []) => node(at(rel), [seed, 'install', '--source', EXPORT, '--selection', sel(selection), ...args]),
        initChild: (rel, selection, args = []) =>
        {
            const parentDir = path.dirname(at(rel));
            const plan = path.join(work, `parent-${n += 1}.json`);
            const scope = node(parentDir, [path.join(EXPORT, 'scripts', 'install', 'stamp.js'), 'scope', '.']).out.trim();
            const rb = node(parentDir, [seed, 'update', '--source', EXPORT, '--scope', scope, '--installed-only', '--print-plan', '--plan-out', plan]);
            const reg = node(at(rel), [path.join(EXPORT, 'scripts', 'workspace.js'), 'register', '--root', '.']);
            const inst = sb_install(rel, selection, [...(reg.code === 0 ? ['--parent-plan', plan] : []), '--instructions-file', 'agents', '--instructions-at', 'claude', ...args]);
            return { rb, reg, inst };
        },
        done: () => fs.rmSync(work, { recursive: true, force: true }),
    };
    function sb_install(rel, selection, args) { return node(at(rel), [seed, 'install', '--source', EXPORT, '--selection', sel(selection), ...args]); }
}

// AC7 on Windows: root at project scope, a child at each scope
for (const C of ['local', 'project', 'user'])
{
    const sb = sandbox();
    try
    {
        sb.mk('.', false); sb.mk('api');
        const r1 = sb.install('.', ROOT_SEL);
        const c = sb.initChild('api', `${ROOT_SEL}skill npm\n`, ['--scope', C]);
        const ex = ((json(path.join(sb.at('api'), '.claude', 'settings.local.json')) || {}).claudeMdExcludes) || [];
        const plain = ex.map(plainOf);
        const realRoot = fs.realpathSync.native(sb.at('.')).replace(/\\/g, '/').toLowerCase();
        const want = [...fs.readdirSync(path.join(sb.at('.'), '.claude', 'rules')).map((f) => `${realRoot}/.claude/rules/${f.toLowerCase()}`), `${realRoot}/.claude/agents.md`];
        const has = (s) => fs.existsSync(path.join(sb.at('api'), '.claude', 'skills', s, 'SKILL.md'));
        const scope = ((/^scope: (.*)$/m.exec(fs.readFileSync(path.join(sb.at('api'), '.claude', 'alfred-code.stamp'), 'utf8')) || [])[1] || '').trim();
        const folded = ex.length > 0 && ex.every((g) => /\[cC\]/.test(g)) && ex.some((g) => g.includes('[(]'));
        check(`AC7 win root project / child ${C} under '${NAME}': register 0, every root rule and the seed excluded as a case-folded class glob, the root's skill inherited, the child's own kept, scope ${C}`,
            r1.code === 0 && c.rb.code === 0 && c.reg.code === 0 && c.inst.code === 0 && want.every((w) => plain.includes(w)) && folded && has('javascript') && has('npm') && scope === C,
            `root=${r1.code} rb=${c.rb.code} reg=${c.reg.code} ${c.reg.out}\ninst=${c.inst.code}\nwant=${JSON.stringify(want)}\nexcludes=${JSON.stringify(ex)}\nscope=${scope} js=${has('javascript')} npm=${has('npm')}\n${c.inst.out.split('\n').filter((l) => /!!|error|Error/.test(l)).join('\n').slice(0, 1500)}\n${r1.out.split('\n').filter((l) => /!!|error|Error/.test(l)).join('\n').slice(0, 600)}`);
    }
    finally { sb.done(); }
}

// AC2 on Windows with the real claude.exe, the child at local scope
{
    const sb = sandbox();
    try
    {
        sb.mk('.', false); sb.mk('api');
        sb.install('.', ROOT_SEL);
        sb.initChild('api', `${ROOT_SEL}skill npm\n`, ['--scope', 'local']);
        const child = sb.at('api');
        const acct = path.join(sb.work, 'acct');
        const local = path.join(child, '.claude', 'settings.local.json');
        const original = fs.readFileSync(local, 'utf8');
        const real = fs.realpathSync.native(child);
        const probe = (spell) =>
        {
            const seen = {};
            const rt = { ...runtime, spawnCommand: (cmd, args, opts) =>
            {
                const out = runtime.spawnCommand(cmd, args, { ...opts, cwd: spell(real) });
                seen.cwd = spell(real);
                const i = args.indexOf('--debug-file');
                try { seen.log = fs.readFileSync(args[i + 1], 'utf8'); } catch { seen.log = ''; }
                return out;
            } };
            return { result: ws.checkLoads({ projectRoot: child, env: sb.env, configDir: acct, claudeBin: REAL, rt }), ...seen };
        };
        const lower = (p) => p.toLowerCase();
        const caps = (p) => p.toUpperCase();
        const agentsLines = (log) => (log || '').split('\n').filter((l) => /AGENTS\.md|Skipped: no usable/.test(l)).map((l) => l.slice(0, 300)).join('\n');
        for (const [label, spell] of [['lowercase-typed', lower], ['all-caps', caps]])
        {
            const p = probe(spell);
            check(`AC2 win ${label} cwd: check-loads is clean with every exclude`, p.result.state === 'clean', `${JSON.stringify(p.result)} cwd=${p.cwd}\n${agentsLines(p.log)}`);
        }
        const data = JSON.parse(original);
        const dropped = data.claudeMdExcludes.find((g) => /alfred-security\.md$/.test(plainOf(g)));
        data.claudeMdExcludes = data.claudeMdExcludes.filter((g) => g !== dropped);
        fs.writeFileSync(local, JSON.stringify(data, null, 2));
        for (const [label, spell] of [['lowercase-typed', lower], ['all-caps', caps]])
        {
            const p = probe(spell);
            check(`AC2 win ${label} cwd: one exclude row deleted by hand names that miss alone`, p.result.state === 'misses' && p.result.misses.length === 1 && /alfred-security\.md$/i.test(p.result.misses[0]), `${JSON.stringify(p.result)}\n${agentsLines(p.log)}`);
        }
        fs.writeFileSync(local, original);
        // the keyed count (AC30): the account key set, then the seed's row taken out
        const ap = spawnSync(process.execPath, [path.join(EXPORT, 'scripts', 'workspace.js'), 'account-instructions', '--root', child, '--apply'], { env: sb.env, encoding: 'utf8' });
        const keyed = probe(lower);
        const d2 = JSON.parse(original);
        d2.claudeMdExcludes = d2.claudeMdExcludes.filter((g) => !/\/\.claude\/agents\.md$/.test(plainOf(g)));
        fs.writeFileSync(local, JSON.stringify(d2, null, 2));
        const keyedOut = probe(lower);
        fs.writeFileSync(local, original);
        check('AC30 win with the instructionFiles key: clean with the excludes, the seed .claude/AGENTS.md the miss without its row',
            ap.status === 0 && keyed.result.state === 'clean' && keyedOut.result.state === 'misses' && keyedOut.result.misses.some((m) => /\.claude[\\/]AGENTS\.md$/i.test(m)),
            `${ap.stdout}${ap.stderr}\nkeyed=${JSON.stringify(keyed.result)}\n${agentsLines(keyed.log)}\nout=${JSON.stringify(keyedOut.result)}\n${agentsLines(keyedOut.log)}`);
    }
    finally { sb.done(); }
}
console.log(rows.join('\n'));
const failed = rows.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${rows.length - failed}/${rows.length} pass`);
process.exitCode = failed ? 1 : 0;
