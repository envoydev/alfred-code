'use strict';
// The six-track audit of 2026-10-21 - the rows with no other test home. Each block names its track and row id, so a
// later edit that brings the defect back goes red here.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    .flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.md') ? [path.join(dir, e.name)] : []);

// rules T1-1: repo-audit-claude-md ran `scripts/claude-md-check.js`, removed when the seed became AGENTS.md
test('rules T1-1: every repo script a repo skill runs exists', () => {
    for (const rel of walk('.claude/skills')) {
        for (const m of read(rel).matchAll(/\bscripts\/([\w./-]+\.js)\b/g)) {
            assert.ok(fs.existsSync(path.join(ROOT, 'scripts', m[1])), `${rel} names scripts/${m[1]}, which is gone`);
        }
    }
});

test('rules T1-1: repo-audit-claude-md names the AGENTS.md seed and the always-on cap lint holds', () => {
    const t = walk('.claude/skills/repo-audit-claude-md').map(read).join('\n');
    assert.doesNotMatch(t, /seeded as `\.claude\/CLAUDE\.md`/);
    assert.match(t, /seeded as `\.claude\/AGENTS\.md`/);
    const cap = read('scripts/lint-skills.js').match(/const ALWAYS_ON_MAX = (\d+);/)[1];
    assert.match(t, new RegExp(`at ${Number(cap).toLocaleString('en-US')} chars`), 'the principles quote the cap lint check 33 holds');
});

// mcps T2-1: windows-control runs on Python 3.14 since the 2026-10-14 ruling, yet its marketplace description, its
// retired alias's and the HTML row said 'pins the Python (3.13)'. Every description that names the Python names the one
// uv-python.js launches that server on.
test('mcps T2-1: each server description names the Python its launcher runs it on', () => {
    const { pythonFor } = require('../stack/mcp/uv-python.js');
    const renamed = JSON.parse(read('meta/stack-manifest.json')).renamed.mcps;
    const said = [];
    for (const p of JSON.parse(read('.claude-plugin/marketplace.json')).plugins) {
        const m = /pins the Python[^(]*\((\d+\.\d+)/.exec(p.description || '');
        if (m) said.push([`marketplace ${p.name}`, renamed[p.name] || p.name, m[1]]);
    }
    for (const m of read('docs/alfred-code.html').matchAll(/^\s*\["([\w-]+)", "MCP server",[^\n]*?pins the Python \((\d+\.\d+)/gm)) said.push([`HTML ${m[1]}`, m[1], m[2]]);
    assert.ok(said.some(([, n]) => n === 'windows-control'), 'the windows-control rows are read');
    for (const [where, server, py] of said) assert.strictEqual(py, pythonFor(server), `${where} says Python ${py}`);
});

// agents T2-9: a forced user choice went 'to the report' (7 designers) or back as NEEDS_CONTEXT (data), while the report
// carries a literal `user_decisions:` line the orchestrator puts to the user before the build.
test('agents T2-9: every designer puts a user-level decision on the user_decisions: line', () => {
    for (const f of fs.readdirSync(path.join(ROOT, 'stack/agents')).filter((n) => n.endsWith('-solution-designer.md'))) {
        const t = read(`stack/agents/${f}`).replace(/\s+/g, ' ');
        assert.doesNotMatch(t, /(?:user-level decision|genuinely the user's)[^.]*go(?:es)? to the report/, `${f}: a user decision goes to the report`);
        assert.doesNotMatch(t, /user-level decision[^.]*is returned as NEEDS_CONTEXT/, `${f}: a user decision bounces as NEEDS_CONTEXT`);
        assert.match(t, /(?:user-level decision|genuinely the user's)[^.]*on the `user_decisions:` line/, `${f}: names the line`);
    }
    assert.match(read('stack/agents/ionic-angular-solution-designer.md').replace(/\s+/g, ' '), /native-config prerequisites.{0,300}as ops\/user decisions on the `user_decisions:` line/);
});

const flat = (rel) => read(rel).replace(/\s+/g, ' ');
const seats = (suffix) => fs.readdirSync(path.join(ROOT, 'stack/agents')).filter((n) => n.endsWith(suffix)).map((n) => `stack/agents/${n}`);

// agents T2-10 / T2-13: a seat that starts a container, an app or a server stops it before its report and says what is
// still up on a literal `left_running:` line, as the verifiers do.
test('agents T2-10 / T2-13: the devops implementer and the gatherer stop what they start and report left_running:', () => {
    const devops = flat('stack/agents/devops-implementer.md');
    assert.match(devops, /docker compose up -d <service>` then `docker compose ps`[^.]*then `docker compose stop <service>`/);
    assert.match(devops, /a literal `left_running:` line/);
    const gatherer = flat('stack/agents/evidence-gatherer.md');
    assert.match(gatherer, /wall-clock timeout/);
    assert.match(gatherer, /a literal `left_running:` line/);
});

// agents T2-11: the protocol's implementer block carries `ceilings:`, which every implementer's report list left out
test('agents T2-11: every implementer report lists the ceilings: rows after decisions:', () => {
    for (const f of seats('-implementer.md')) assert.match(flat(f), /the `decisions:` lines \([^)]*\), the `ceilings:` rows \([^)]*\)/, f);
});

// agents T2-12: the reviewer was told to 'End with' three keys and then to list three more items after them
test('agents T2-12: integration-reviewer reports its items first and ends on the three routing keys', () => {
    const t = flat('stack/agents/integration-reviewer.md');
    assert.match(t, /then END with literal `status:`, `contract_version:` and `commit_allowed:` lines, the last three lines of the report/);
    assert.doesNotMatch(t, /End with literal `status:`, `contract_version:`, and `commit_allowed:` lines/);
});

// agents T2-14: the devops designer preloads task-design, whose no-docs fallback outlines a file - the LSP's documentSymbol
// since the stack left its navigation server (2026-10-24)
test('agents T2-14: the devops designer is granted the outline task-design prescribes', () => {
    assert.ok(JSON.parse(read('meta/seat-tools.json')).seats['devops-solution-designer'].includes('LSP'));
});

// agents T2-15: the turn build check reads git status at Stop, so no edit-route line names it among the edit hooks
test('agents T2-15: no implementer names the turn build check as an edit hook', () => {
    for (const f of seats('-implementer.md')) assert.doesNotMatch(flat(f), /the tools the edit hooks watch \([^)]*turn build check/, f);
});

// agents T2-16: web-angular-verifier's scope line lost the cross-domain clause its nine siblings carry
test('agents T2-16: every verifier routes cross-domain review to integration-reviewer', () => {
    for (const f of seats('-verifier.md').filter((n) => !/agent-sdk/.test(n))) assert.match(flat(f), /Never fixes[^.]*cross-domain review is integration-reviewer\./, f);
});

// agents T2-17: the protocol's verifier block had no `checked prior notes:` opener, and the auditor's status set no block
test('agents T2-17: the protocol carries the verifier opener and a security audit block', () => {
    const p = read('stack/skills/task-solve-cross/references/agent-output-protocol.md');
    const verifier = p.slice(p.indexOf('## Verifier output'), p.indexOf('## Integration gate output'));
    assert.match(verifier, /```text\nchecked prior notes: <names \| none>\n/);
    assert.match(p, /## Security audit output[\s\S]*status: CLEAN \| FINDINGS \| BLOCKED_BY_ACCESS/);
});

// skills S-02 to S-09 (ruling S-Q2): the layered-architecture reference contradicted six house skills and its own
// sibling, recommended a mapping generator the C# conventions rule out, and pinned versions that drift.
test('skills S-02..S-09: the layered reference defers to the owning skills and carries one layout', () => {
    const layered = flat('stack/skills/dotnet-architecture/references/layered-architecture.md');
    const clean = flat('stack/skills/dotnet-architecture/references/clean-architecture.md');
    assert.doesNotMatch(layered, /Mapperly/, 'S-02 / S-Q2: hand-written mapping only');
    assert.doesNotMatch(layered, /AddValidation\(\)|built-in validation or/, 'S-03: the web hub picks the validator');
    assert.doesNotMatch(layered, /prefer domain exceptions|Result types against domain exceptions/, 'S-04: a Result for the expected');
    assert.doesNotMatch(layered, /handler tests with fakes only where/, 'S-05: the testing skill owns the strategy');
    assert.doesNotMatch(layered, /STAThread/, 'S-06: the WPF skill owns the host startup');
    assert.doesNotMatch(layered + clean, /IAppDbContext/, 'S-07: the data-access skill owns where a query lives');
    assert.doesNotMatch(clean, /```\s*Domain\/\s+Entities\//, 'S-08: one reference layout');
    assert.match(clean, /reference layout in `layered-architecture\.md`/);
    assert.doesNotMatch(layered, /\(late 2026\)|8\.4\.2|dormant since|11\.1\.1|10\.8\.0|RC2/, 'S-09: no drifting pins');
    assert.match(layered, /16\.0\.0 to 16\.1\.0 \(fixed in 15\.1\.1 and 16\.1\.1\)/, 'S-09: the advisory range reads exclusive');
});

// skills S-10 / S-11 / S-14 / S-19 / S-25: an unconsented commit, a stale ESLint floor, the wrong security pass, a stale
// act count, a stale command list.
test('skills S-10 / S-11 / S-14 / S-19 / S-25: the flow and convention lines say today\'s contract', () => {
    const migrate = flat('stack/skills/dotnet-migrate/SKILL.md');
    assert.doesNotMatch(migrate, /Back out a bad update with `git revert` of that step's commit\./, 'S-10: a revert is a commit');
    assert.match(migrate, /`git revert <sha>` once the user says to commit \(a revert is a commit\)/);
    const eslint = flat('stack/skills/angular-conventions/references/angular-style.md');
    assert.doesNotMatch(eslint, /ESLint v9\+\)/, 'S-11: the floor defineConfig needs');
    assert.match(eslint, /ESLint 9\.22\+/);
    assert.match(flat('stack/skills/task-verify-code/references/commit-gate-receipt.md'), /written only after the commit checkpoint's security half ran \(alfred-security\.md\)/, 'S-14');
    const coverage = flat('stack/skills/loop-test-coverage/SKILL.md');
    const acts = coverage.slice(coverage.indexOf('Each substantial item runs'));
    assert.match(acts, /^Each substantial item runs five acts in order:/, 'S-19');
    assert.match(flat('stack/skills/capture-usage-report/SKILL.md'), /\(init, update, configure, validate, status, uninstall; `setup` before 2026-10-17\)/, 'S-25');
});

// commands T2-09: status's Environment table was a hand-copied list of 10 catalog rows that had drifted (14 in the
// catalog); it reads the catalog the way configure's step 8 does, keeping only the two rows the catalog cannot carry.
test('commands T2-09: status prints the Environment rows from meta/environment.json, never a copied list', () => {
    const t = read('setup-plugin/commands/status.md');
    const env = t.slice(t.indexOf('**Environment**'), t.indexOf('Mark `(default)`'));
    assert.match(env, /`\$\{CLAUDE_PLUGIN_ROOT\}\/meta\/environment\.json`/);
    for (const row of JSON.parse(read('meta/environment.json')).env) assert.doesNotMatch(env, new RegExp(`^\\| ${row.key} \\|`, 'm'), `${row.key} is copied`);
    assert.match(env, /^\| autoMemoryEnabled \|/m);
    assert.match(env, /^\| CONTEXT7_API_KEY \(account env\) \|/m);
});

// commands T2-13: validate's step 2 carried a near-verbatim copy of init's stack-marker list, a second home that drifts.
test('commands T2-13: the stack-marker list has one home, read by init and validate', () => {
    const list = read('setup-plugin/references/stack-detection.md');
    assert.match(list, /`\*\.csproj` \/ `\*\.sln` -> \.NET/);
    for (const rel of ['setup-plugin/references/init-install.md', 'setup-plugin/commands/validate.md']) {
        const t = read(rel);
        assert.doesNotMatch(t, /^- `\*\.csproj` \/ `\*\.sln` -> \.NET/m, `${rel} still copies the list`);
        assert.match(t, /references\/stack-detection\.md/, `${rel} reads the list`);
    }
    assert.match(read('setup-plugin/commands/init.md'), /init-install\.md` and `\$\{CLAUDE_PLUGIN_ROOT\}\/setup-plugin\/references\/stack-detection\.md` in ONE Bash `cat`/);
});
