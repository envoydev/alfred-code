// The 2.1.5 audit Minors, rules package (merged.md M62, M64-M69, M71-M73): each case pins one rule's
// prose fix - a seat told to do what its tools cannot, a hint that arrives too late to help, repo
// trivia shipped to every project, an attach contract that differs rule to rule, a rationale that can
// never reach the run it describes, subset and generic lines in the always-on set, first actions with
// no order, a generated rule restating a baseline, and glob gaps.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { injectedRuleText, frontmatterOf } = require('./always-on-surface.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const squash = (text) => text.replace(/\s+/g, ' ');
const rule = (name) => read(`stack/rules/${name}.md`);
const injected = (name) => squash(injectedRuleText(rule(name)));
const registry = () => JSON.parse(read('meta/shared-rules.json')).rules;
const homes = (entry) => [entry.owner, ...(entry.sites || [])];
const pathsOf = (name) => JSON.parse(/^paths:\s*(\[.*\])\s*$/m.exec(frontmatterOf(rule(name)))[1]);

// ------------------------------------------------------------------ M62

test('M62: both repair routers give a read-only seat its action - report the red, name the resolver', () =>
{
    const line = 'A read-only seat (a verifier, a designer, a reviewer, an analyzer) has no Edit to loop with: it reports the red and names the resolver';
    for (const name of ['dotnet-repair-agents', 'angular-repair-agents'])
        assert.ok(squash(rule(name)).includes(line), `${name}.md`);
    const entry = registry()['repair-router-delegation-protocol'];
    for (const home of homes(entry))
        assert.ok(squash(home.marker).includes('it reports the red and names the resolver'), `the pinned marker covers the new sentence in ${home.file}`);
});

// ------------------------------------------------------------------ M64

test('M64: the C# depth hint lives in the always-on navigation rule, beside the overview call it governs', () =>
{
    const nav = injected('alfred-navigation');
    assert.match(nav, /`get_symbols_overview` takes ONE file, never a directory[^.]*on C# pass `depth: 2`/, 'the overview bullet carries the C# depth');
    assert.match(nav, /nested-type members need 3; a top-level-statements file returns `\{\}` at any depth/, 'the move kept the two edge facts the C# rule carried');
    assert.ok(!injected('csharp-conventions').includes('depth: 2'), 'the path rule no longer carries a hint only a file-tool touch delivers');
    assert.strictEqual(registry()['serena-csharp-overview-depth'].owner.file, 'stack/rules/alfred-navigation.md');
});

// ------------------------------------------------------------------ M65

test('M65: skill-authoring.md ships no restated description cap and no repo trivia', () =>
{
    const text = squash(rule('skill-authoring'));
    assert.ok(!text.includes('160 characters'), 'the skill it loads owns the cap');
    assert.ok(!text.includes('lint check 15c'), 'a consuming project has no lint check 15c');
    assert.ok(!text.includes('Alfred Code repo'), 'no repo trivia');
});

// ------------------------------------------------------------------ M66

test('M66: every FIRST-action rule carries the whole attach contract, and both halves are pinned in the same files', () =>
{
    const reg = registry();
    const first = homes(reg['convention-rule-first-action']).map((h) => h.file).sort();
    const receipt = homes(reg['convention-rule-load-receipt']).map((h) => h.file).sort();
    assert.deepStrictEqual(receipt, first, 'the load receipt is pinned wherever the first action is');
    assert.strictEqual(first.length, 11, 'nine convention rules, markdown-docs and skill-authoring');
    for (const file of first)
    {
        const text = squash(read(file));
        assert.ok(text.includes('the FIRST action after this rule attaches is'), `${file}: the pinned first action`);
        assert.ok(/(?:before the NEXT (?:edit|write|touch)[^.]*lands)/.test(text), `${file}: before the next edit`);
        assert.ok(text.includes('a path-scoped rule attaches ON the touch'), `${file}: why the load is owed after the attach`);
        assert.ok(/already in context/.test(text), `${file}: the in-context exemption`);
        assert.ok(text.includes('the receipt is what makes the load happen'), `${file}: the receipt`);
    }
});

// ------------------------------------------------------------------ M67

test('M67: the shell-no-attach rationale is a maintainer comment in the path rules, and stays live only where a shell run reads it', () =>
{
    for (const name of ['csharp-conventions', 'markdown-docs', 'skill-authoring'])
    {
        const live = injected(name);
        assert.ok(!/through the shell|first shell write/.test(live), `${name}.md: the injected text still explains the shell route: ${live}`);
        assert.match(squash(rule(name)), /<!--[^>]*shell[^>]*guard-read-whole-file\.js[^>]*-->/, `${name}.md keeps the rationale as a comment`);
    }
    assert.ok(injected('alfred-navigation').includes('path-scoped rules do not attach on the shell route'), 'the always-on copy reaches the shell run and stays');
});

// ------------------------------------------------------------------ M68

test('M68: the browser-only screenshot line leaves the always-on navigation rule, the browser row keeps the discipline', () =>
{
    const nav = injected('alfred-navigation');
    assert.ok(!/screenshot/i.test(nav), 'the browser row owns screenshot readback');
    const row = read('stack/skills/capture-agent-awareness/references/generated-rule-template.md').split('\n').find((l) => l.startsWith('- `browser` - '));
    assert.ok(row && row.includes('never the iteration loop'), 'the browser row carries the mid-loop rule');
    assert.ok(nav.includes('Git Bash'), 'the Windows line stays: a per-OS rule copy would differ between teammates');
});

// ------------------------------------------------------------------ M69

test('M69: the quality gates drop the generic simplicity line and name Monitor as the wait tool', () =>
{
    const gates = injected('alfred-quality-gates');
    assert.ok(!gates.includes('Keep it simple') && !gates.includes('speculative'), 'a generic line with no measured miss');
    assert.ok(gates.includes('Comments: none by default; a why only when the code cannot say it'), 'the implementer bar cites this comments line by name');
    assert.ok(!gates.includes('the wait tool is deferred'), 'the tool is named');
    assert.ok(gates.includes('`ToolSearch select:Monitor`'), 'the load line names Monitor');
});

// ------------------------------------------------------------------ M71

test('M71: several FIRST actions due at once load together', () =>
{
    const text = injected('alfred-interaction');
    assert.match(text, /Several FIRST actions due at once[^.]*load in the same call/);
});

// ------------------------------------------------------------------ M72

test('M72: the generated architecture rule carries only its trigger - where the docs live is the baselines\'', () =>
{
    const shapes = read('stack/skills/capture-architecture/references/doc-shapes.md');
    const at = shapes.indexOf('## .claude/rules/alfred-architecture.md');
    const block = /```markdown\n([\s\S]*?)```/.exec(shapes.slice(at))[1];
    const body = squash(injectedRuleText(block)).trim();
    assert.ok(!body.includes('<docs-path>'), `the body restates the root the navigation baseline names: ${body}`);
    assert.ok(body.includes('before a structural change'), body);
    assert.ok(!squash(read('stack/skills/capture-architecture/SKILL.md')).includes('with `<docs-path>` baked to the LITERAL resolved root'), 'step 6 no longer bakes a path');
});

// ------------------------------------------------------------------ M73

test('M73: the devops rule attaches on every delivery surface its skill claims', () =>
{
    const paths = pathsOf('devops-conventions');
    for (const glob of ['**/.github/actions/**/action.yml', '**/.github/actions/**/action.yaml', '**/azure-pipelines*.yml',
        '**/azure-pipelines*.yaml', '**/.gitlab-ci.yml', '**/.env.example', '**/.env.template', '**/*.env.example', '**/*.env.template'])
        assert.ok(paths.includes(glob), `devops-conventions.md paths: ${glob}`);
    const graph = JSON.parse(read('meta/stack-graph.json'));
    assert.ok(JSON.stringify(graph).includes('**/azure-pipelines*.yml'), 'the graph was regenerated');
});

// 2.1.6 review A1: the repair routers dispatch the resolvers from the main session, so they route a capped
// resolver's status-less return too (the sentence is pinned as seat-statusless-return).
test('the repair routers route a status-less resolver return as a seat death', () =>
{
    for (const name of ['dotnet-repair-agents', 'angular-repair-agents'])
    {
        const text = squash(rule(name));
        assert.match(text, /A return with no closing status line - a seat stopped at its `maxTurns` \(Claude Code marks the output partial from 2\.1\.246\) or killed mid-task - is never DONE and never resumed as-is/, name);
        assert.ok(homes(registry()['seat-statusless-return'] || { owner: {} }).some((h) => h.file === `stack/rules/${name}.md`), `${name}: a pinned home`);
    }
});

// ------------------------------------------------------------------ 2026-10-08 audit (rules.md F3-F16, hooks.md #14)
// Each case names the report row it holds, so a regression reads as the audit line it reopens.

test('rules F3: the AGENTS template restates none of the seven always-on rules - each loads itself every session', () =>
{
    const text = read('stack/AGENTS.template.md');
    const rulesSection = text.slice(text.indexOf('\n## Rules'));
    for (const name of ['interaction', 'quality-gates', 'security', 'git', 'navigation', 'docs-root', 'memory'])
        assert.ok(!rulesSection.includes(`| \`.claude/rules/alfred-${name}.md\` |`), `alfred-${name}.md has a template row`);
    for (const generated of ['alfred-agent-awareness', 'alfred-architecture', 'alfred-related-context', 'alfred-project-awareness', 'project-code-style'])
        assert.ok(rulesSection.includes(`| \`.claude/rules/${generated}.md\` (GENERATED`), `${generated}.md keeps its GENERATED row`);
});

test('hooks #14: an ask with no options to name still goes through the tool - the stop contract blocks a prose question', () =>
{
    const text = injected('alfred-interaction');
    assert.ok(!text.includes('free-form prose only when no options can be named'), 'the prose carve-out the hook blocks');
    assert.ok(text.includes('with no options to name, the tool still carries it - the likeliest answers as options, the rest via Other'));
});

test('rules F4: background output is polled from one home, the quality gates', () =>
{
    assert.ok(!/Monitor/.test(injected('alfred-navigation')), 'the navigation copy is folded away');
    assert.match(injected('alfred-quality-gates'), /Poll it through `Monitor` or its new lines, never a whole-log re-read\./);
});

test('rules F5 + F16: the navigation rule says one thing per line, in plain words', () =>
{
    const nav = injected('alfred-navigation');
    assert.ok(!nav.includes("A language serena's"), 'the ungrammatical fused line');
    assert.match(nav, /- A language the navigation server's `project\.yml` \(`<data root>\/serena\/`\) does not list takes the fallback from its first call\. -/);
    assert.match(nav, /- A large JSON \/ YAML \/ lock \/ fixture file is queried/);
    assert.ok(!nav.includes('check the tool list before an edit call'), 'F16');
    // F16's edit-tool line named the server's memory edit tools; they are off since the user's 2026-10-13 ruling.
    assert.ok(nav.includes('- The navigation server is navigation only: its memory tools are off'), 'F16 superseded');
});

test('rules F6: the compaction section carries the name the docs give it', () =>
{
    assert.match(rule('alfred-navigation'), /^## Compact Instructions$/m);
    assert.doesNotMatch(rule('alfred-navigation'), /^## Compaction$/m);
});

test('rules F7 + skills habits-code-comments: the inline-comment floor admits the upstream-issue link and is pinned to the comments skill', () =>
{
    const gates = injected('alfred-quality-gates');
    assert.ok(gates.includes('Never a ticket id (a public upstream issue on a workaround excepted), change narration, commented-out code or an unasked `TODO`'));
    const entry = registry()['inline-comment-never-list'];
    assert.ok(entry, 'registered');
    assert.strictEqual(entry.owner.file, 'stack/skills/habits-code-comments/SKILL.md');
    assert.ok(homes(entry).some((h) => h.file === 'stack/rules/alfred-quality-gates.md'));
});

test('rules F8: the execution-strategy trigger list is pinned in the rule and the skill it routes to', () =>
{
    const entry = registry()['execution-strategy-trigger-list'];
    assert.ok(entry, 'registered');
    assert.strictEqual(entry.owner.file, 'stack/rules/alfred-interaction.md');
    assert.ok(homes(entry).some((h) => h.file === 'stack/skills/habits-execution-strategy/SKILL.md'));
});

test('rules F9: the simplification-ceiling line sits with the comment rules and is pinned with the implementers\' copies', () =>
{
    assert.ok(!injected('alfred-interaction').includes('deliberate simplification'), 'moved out of Formatting and privacy');
    const gates = injected('alfred-quality-gates');
    const comments = gates.indexOf('Comments: none by default');
    const ceiling = gates.indexOf('No code comment flagging a deliberate simplification');
    assert.ok(comments >= 0 && ceiling > comments, 'right after the comments line');
    assert.ok(homes(registry()['implementer-ceilings-row']).some((h) => h.file === 'stack/rules/alfred-quality-gates.md'));
});

test('rules F10: an in-session pick on a broken build starts at the root-cause habit, in both routers', () =>
{
    for (const name of ['dotnet-repair-agents', 'angular-repair-agents'])
    {
        const text = squash(rule(name));
        assert.ok(text.includes('resolver recommended; an in-session pick starts at the `habits-root-cause` Skill call)'), name);
        assert.ok(text.includes('offer the resolver through AskUserQuestion'), `${name}: the pinned ask stays`);
    }
    const graph = JSON.parse(read('meta/stack-graph.json'));
    for (const name of ['dotnet-repair-agents', 'angular-repair-agents'])
        assert.ok((graph.rules[name].skills || []).includes('habits-root-cause'), `${name}: the graph pulls the named skill`);
});

test('rules F11: the docs root exempts instruction files and drops capture-internal trivia', () =>
{
    const line = read('stack/rules/alfred-docs-root.md').split('\n').find((l) => /EVERY doc the assistant creates/.test(l)) || '';
    assert.ok(line.includes('EVERY doc the assistant creates - an instruction file (AGENTS.md, a rule, a skill) excepted - lives under ONE root'));
    assert.ok(!line.includes('watch.json'));
});

test('rules F12 + F13: the commit header and the memory verify clause are each stated once', () =>
{
    const vcs = injected('alfred-git');
    assert.strictEqual((vcs.match(/Conventional[- ]Commits/g) || []).length, 1, vcs);
    assert.match(vcs, /\*\*Header\*\* - one line, one of two shapes: the ticket id \(`PROJ-142`\) or a Conventional-Commits subject/);
    const memory = injected('alfred-memory');
    assert.strictEqual((memory.match(/verified before use/g) || []).length, 1, memory);
});

test('agents F03: a seat whose tools: list names a locked server\'s tools calls them directly - live probe 2026-10-09', () =>
{
    const clause = 'A seat whose `tools:` list names them has them loaded already - it calls them directly, with no ToolSearch.';
    for (const name of ['alfred-navigation', 'alfred-memory'])
        assert.ok(injected(name).includes(clause), name);
    assert.ok(injected('alfred-quality-gates').includes('then the query (a seat whose `tools:` list names them calls them directly)'));
});

// ------------------------------------------------------------------ audit 2026-10-10 C14

// The Bash tool runs zsh on macOS: `${PIPESTATUS[0]}` reads empty there, so a shipped instruction that prescribes it
// loses every exit status it was meant to read (measured in 9 sessions, 22 of 22 reads blank).
test('C14: no shipped instruction prescribes the bash-only PIPESTATUS read; the navigation rule teaches the zsh-safe forms', () =>
{
    const hits = [];
    const walk = (dir) =>
    {
        for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }))
        {
            const rel = `${dir}/${e.name}`;
            if (e.isDirectory()) walk(rel);
            else if (/\.md$/.test(e.name) && /PIPESTATUS/.test(read(rel).split('`${PIPESTATUS[0]}` reads empty').join(''))) hits.push(rel);
        }
    };
    for (const dir of ['stack', 'setup-plugin']) walk(dir);
    assert.deepStrictEqual(hits, [], 'a shipped text tells the model to read ${PIPESTATUS[0]}');
    const nav = injected('alfred-navigation');
    assert.match(nav, /Read `\$\?` on the very next line, with `set -o pipefail` before a pipe/);
    assert.match(nav, /a bare word opening with `=`[^.]*quote it, `echo '====='`/);
    assert.match(nav, /never word-splits `\$VAR`/);
    assert.match(nav, /a path glob that may match nothing with `find <dir> -name '<pat>'`/);
});

// ------------------------------------------------------------------ audit 2026-10-10 C22

test('C22: Angular specs route to angular-testing, EF migrations attach the SQL rule, and the markdown carve-out leads', () =>
{
    const ng = injected('angular-conventions');
    assert.match(ng, /Writing or changing a spec file \(`\*\.spec\.ts`\) loads `angular-testing` in the same action/);
    const graph = JSON.parse(read('meta/stack-graph.json'));
    assert.ok(graph.rules['angular-conventions'].skills.includes('angular-testing'), 'the rule pulls the skill it names');
    assert.deepStrictEqual(pathsOf('sql-conventions'), ['**/*.sql', '**/Migrations/*.cs']);
    assert.match(injected('sql-conventions'), /An EF migration \(`Migrations\/\*\.cs`\) is schema work: the same first action adds the migration-safety skill/);
    const md = injected('markdown-docs');
    const carve = md.indexOf('The generated docs root is NOT governed here');
    assert.ok(carve >= 0 && carve < md.indexOf('the FIRST action after this rule attaches'), 'the carve-out comes before the first action');
    assert.match(md, /A plan, flow note or capture under `<docs-path>`[^:]*a `\.md` you only READ take no load/);
});

// ------------------------------------------------------------------ audit 2026-10-10 C23

// The Bash tool's `grep` is a shell function running ugrep with `--ignore-files`; a `local` docs root's own
// .gitignore is `*`, so a recursive grep over it printed nothing (bba03dad, three dead calls, ~0.92M).
test('C23: the docs-root rule names the ignore-honouring grep and the two searches that see the root', () =>
{
    assert.match(injected('alfred-docs-root'), /Search the root with `docs\.js` or `\/usr\/bin\/grep -r`, never a bare `grep -r`: the Bash tool's `grep` honours `\.gitignore`/);
});

// ------------------------------------------------------------------ audit 2026-10-10 C29

// 229e2715: the restart verdict needs the release the session loaded; its step 6 ran the AGENTS.md compare as a
// `## ` heading diff, never the check. 0cdb0c1d: 'a fresh session' beside a separate restart row let /clear satisfy it.
test('C29: update passes the running plugin root, runs the AGENTS.md check itself, and folds the capture into the restart', () =>
{
    const update = squash(read('setup-plugin/commands/update.md'));
    assert.match(update, /update-preflight\.js" --log "\$TMP\/install\.log" --hooks <step 2's changed: hooks=N> --running "\$\{CLAUDE_PLUGIN_ROOT\}"/);
    const six = update.slice(update.indexOf('## 6. Reconcile'), update.indexOf('## 7. Post-check'));
    const check = six.indexOf('agents-md-check.js" --root .');
    assert.ok(check >= 0 && check < six.indexOf('habits-adjust-agents-md/SKILL.md'), 'the check runs before the skill read');
    assert.match(update, /When step 3's `--log` call printed `restart: yes`, the RESTART is row one/);
    assert.match(update, /Under a restart row the note reads 'run it in the session the restart opens' instead/);
});

// ------------------------------------------------------------------ audit 2026-10-10 C26 / C13

// 390aebcb: a recommended option the session could not carry out ('Open a new gated cycle' - a command only the user
// runs) was picked and handed back, a stop block and two messages later. f450ea64: a two-option ask marked neither.
test('C26: a blocking ask marks one option (Recommended), lists it first, and labels the user\'s own action', () =>
{
    assert.match(injected('alfred-interaction'), /concrete options, the recommended one marked \(Recommended\) and listed first, and an option only the user can carry out \(a manual-only command, `\/clear`, an input only they hold\) names their action in its label/);
});

// 9a4ef375 / 0498718d: implementer seats made 85% and 96% of their source edits as shell writes, which the Write|Edit
// hooks never see; the navigation rule sanctioned any anchor-counted splice beside 'every other edit goes through Edit / Write'.
test('C13: a splice is for a mechanical rename, and every implementer routes source edits through Edit / Write', () =>
{
    assert.match(injected('alfred-navigation'), /A splice \(`sed -i`, an in-place python or perl replace\) is for a mechanical rename across many sites, never an edit Edit \/ Write can make/);
    const entry = registry()['implementer-edit-route'];
    assert.ok(entry, 'the bullet is pinned');
    const seats = fs.readdirSync(path.join(ROOT, 'stack', 'agents')).filter((f) => f.endsWith('-implementer.md')).map((f) => `stack/agents/${f}`);
    assert.deepStrictEqual(homes(entry).map((h) => h.file).sort(), seats.sort(), 'every implementer seat, and only those, carries it');
    for (const seat of seats)
    {
        const lines = read(seat).split('\n');
        const at = lines.findIndex((l) => l.includes(entry.owner.marker));
        assert.ok(at > 0 && lines[at - 1].startsWith('- You usually share ONE working tree'), `${seat}: the bullet follows the shared-tree bullet`);
    }
});

// ------------------------------------------------------------------ audit 2026-10-10 C17

// f24eb967: the scope survey `git add -N . && git diff HEAD --stat; git reset -q` unstaged the session's own `git rm`
// deletions, so the commit took 1 of 3 files. The survey the rule names is RUN here, over a staged deletion, a staged
// edit and an untracked file: the index must come out as it went in, and the untracked file must be listed.
test('C17: the commit-ask scope survey lists untracked files and leaves the index as it found it', { skip: process.platform === 'win32' && 'runs the survey through sh' }, () =>
{
    const { execFileSync } = require('node:child_process');
    const os = require('node:os');
    const survey = (/derived FRESH - `([^`]+)`/.exec(injected('alfred-git')) || [])[1];
    assert.ok(survey, 'the rule names its survey command');
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'c17-survey-'));
    try
    {
        const git = (...a) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...a], { cwd: repo, encoding: 'utf8' });
        git('init', '-q');
        for (const f of ['a.md', 'b.md', 'c.md']) fs.writeFileSync(path.join(repo, f), `${f}\n`);
        git('add', '.');
        git('commit', '-qm', 'base');
        git('rm', '-q', 'a.md', 'b.md');
        fs.writeFileSync(path.join(repo, 'c.md'), 'changed\n');
        git('add', 'c.md');
        fs.writeFileSync(path.join(repo, 'new.md'), 'new\n');
        const staged = git('diff', '--cached', '--name-status');
        const out = execFileSync('sh', ['-c', survey], { cwd: repo, encoding: 'utf8' });
        assert.strictEqual(git('diff', '--cached', '--name-status'), staged, 'the survey moved the index');
        assert.match(out, /^new\.md$/m, 'the untracked file is listed');
        assert.match(out, /a\.md/, 'the staged deletion is in the survey');
    }
    finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------ audit 2026-10-10 C12

// 4f1c2ebb: 'a pasted one may still do the job asked' beside 'Never ... pass a pasted secret to a tool' - the session
// took the first, dug the value out of its own transcript after compaction and wrote it to a file. 84eedb4b: a seed
// password from the project's docs was echoed unprompted, and a password the run created was echoed again.
test('C12: a pasted secret serves its one call only, and a documented seed is cited, never echoed', () =>
{
    const sec = injected('alfred-security');
    assert.match(sec, /a pasted one may do the job it was pasted for, inline in that one call, and is never written to a file or recovered from the transcript later/);
    assert.ok(!sec.includes('pass a pasted secret to a tool'), 'the contradicting clause is gone');
    assert.match(sec, /A documented dev seed is cited by file:line and key, never echoed; an account the run creates at the user's ask is reported once, when made\./);
});

// ------------------------------------------------------------------ audit 2026-10-10 C25 / C07 / C31

// a3d497f8: Monitor loaded for a single background suite whose exit re-invoked the model anyway (~168k cache read).
// 3b53e0e8: a foreground `until ... sleep` loop on a sentinel that never matched ran its full 600 s.
// 68da4b6b: one red spec run took six calls to read - three re-runs and empty greps (~886k cache read).
// fbfc2de4: a parity question answered 'Yes' from three ledger greps; the user re-asked, and the check found a regression.
test('C25 / C31 / C07: one background command needs no Monitor, a red run is logged once, a completeness verdict scopes itself', () =>
{
    const gates = injected('alfred-quality-gates');
    assert.match(gates, /One `run_in_background` command whose end is all that matters needs nothing more - its exit re-invokes you; .*a condition inside a run or across several arms the `Monitor` tool when you start it/);
    assert.match(gates, /never a foreground `until` \/ `while` sleep loop/);
    assert.match(gates, /A red test or build run is captured once to a scratch log \(`<cmd> > <scratch>\/run\.log 2>&1; tail -n 60 <scratch>\/run\.log`\); every later look greps that log, never a re-run\./);
    assert.match(gates, /A verdict that something is complete against a reference \(parity with another app, everything a spec lists\) leads with what its evidence covers/);
});

// ------------------------------------------------------------------ audit 2026-10-10, T4 cross-track (seats)

// e499fc94: 0 docs reads in 18 of 18 seat transcripts under an unconditional START clause; the brief now carries the
// card's docs anchors. a6a24815: 'lint + typecheck green' over 2 prettier-dirty specs the project's CI fails on.
test('T4 cross-track: every seat\'s START reads the brief\'s docs anchors first, and every verifier runs the format check', () =>
{
    const agents = fs.readdirSync(path.join(ROOT, 'stack', 'agents')).filter((f) => f.endsWith('.md')).map((f) => `stack/agents/${f}`);
    const start = registry()['seat-start-docs-anchors'];
    const orienting = agents.filter((f) => read(f).includes('Orient from the project docs at START'));
    assert.strictEqual(orienting.length, 24);
    assert.deepStrictEqual(homes(start).map((h) => h.file).sort(), orienting.sort(), 'every orienting seat reads the anchors first');
    assert.ok(!orienting.some((f) => read(f).includes('Orient from the project docs at START - `<docs-path>')), 'no unconditional clause is left');
    const format = registry()['verifier-format-check'];
    assert.deepStrictEqual(homes(format).map((h) => h.file).sort(), agents.filter((f) => f.endsWith('-verifier.md')).sort());
    for (const f of agents.filter((a) => a.endsWith('-verifier.md')))
        assert.ok(read(f).split('\n').some((l) => /^1\. /.test(l) && l.includes(format.owner.marker)), `${f}: the format check rides check 1`);
});
