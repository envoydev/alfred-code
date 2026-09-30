'use strict';
// The flow and capture skills' prose facts - each block names the audit finding (2.1.5 Minors, M77-M104) it holds,
// so a later edit that brings the wrong claim back goes red here.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { lintAskTemplates } = require('./lint-skills.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const flat = (s) => String(s).replace(/\s+/g, ' ');
const body = (text) => String(text).replace(/^---\n[\s\S]*?\n---\n/, '');
const skill = (name) => read(`stack/skills/${name}/SKILL.md`);
const description = (name) => (skill(name).match(/^description:\s*"(.*)"\s*$/m) || [])[1] || '';
// A `## <title>` section of a markdown text, up to the next H2.
const section = (text, title) => {
    const at = text.indexOf(`\n## ${title}`);
    if (at < 0) return '';
    const next = text.indexOf('\n## ', at + 4);
    return text.slice(at, next < 0 ? undefined : next);
};
const asks = (text) => [...String(text).matchAll(/^[ \t]*```ask[ \t]*\n([\s\S]*?)^[ \t]*```/gm)].map((m) => {
    const lines = m[1].split('\n').map((l) => l.trim()).filter(Boolean);
    return { question: lines[0], options: lines.filter((l) => /^- '/.test(l)).map((l) => (l.match(/^- '(.*)' - /) || l.match(/^- '(.*)'\s*$/))[1]) };
});
const shared = () => JSON.parse(read('meta/shared-rules.json')).rules;
const copiesOf = (entry) => [entry.owner, ...(entry.sites || [])].map((c) => c.file);

// ---- M77: the CI signatures skill counts the gatherer triggers its reference lists ------------------------------
test('M77: signatures-ci names four dispatch triggers, the count its fan-out reference lists', () => {
    const text = flat(skill('alfred-issue-signatures-ci'));
    assert.doesNotMatch(text, /the three dispatch triggers/);
    assert.match(text, /the four dispatch triggers/);
    const ref = flat(read('stack/skills/alfred-issue-signatures-ci/references/gatherer-fan-out.md'));
    for (const trigger of [/two or more independent sources/, /log is huge/, /the triage is a matrix/, /a local repro run/])
        assert.match(ref, trigger, `the reference still lists ${trigger}`);
});

// ---- M78 + M79: the code-style capture's seat mention and the generated rules' survival -------------------------
test('M78: code-style names its plugin seat the way a typed mention resolves it', () => {
    const text = skill('alfred-capture-code-style');
    assert.doesNotMatch(text, /@agent-code-style-analyzer/, 'a bare @-mention of a plugin seat resolves nothing');
    assert.match(flat(text), /the code-style-analyzer seat alone, picked from the @ typeahead/);
});

test('M79: a generated rule survives update because no ledger records it, not because nothing prunes rules', () => {
    for (const name of ['alfred-capture-code-style', 'alfred-capture-related-projects']) {
        const text = flat(skill(name));
        assert.doesNotMatch(text, /stack update/, `${name}: the 1.x command name is gone`);
        assert.doesNotMatch(text, /never prunes `\.claude\/rules\/`|nothing prunes the rules directory/, `${name}: library rules ARE pruned`);
        assert.match(text, /no installer ledger records/, `${name}: names the real reason`);
        assert.match(text, /`\/alfred-code:update`/, `${name}: names the current command`);
    }
});

// ---- M80: the plugin cache can be newer than the library copy -------------------------------------------------
test('M80: the newest cache entry is not claimed to be the release these copies came from', () => {
    for (const name of ['alfred-capture-first-look', 'alfred-habits-adjust-agents-md', 'alfred-capture-agent-capabilities']) {
        const text = flat(skill(name));
        assert.doesNotMatch(text, /(NEWEST|newest plugin-cache entry) is the one this skill came from/i, `${name}: the skew window makes it false`);
        assert.match(text, /after a core update it can be newer/, `${name}: says when it differs`);
    }
});

// ---- M81: agent-capabilities' rename note and its plugin-route sentence ---------------------------------------
test('M81: agent-capabilities names its 1.x name apart from the run-book capture, and the current plugin route', () => {
    const text = flat(skill('alfred-capture-agent-capabilities'));
    assert.doesNotMatch(text, /This skill was renamed from project-capabilities/);
    assert.match(text, /the 1\.x project-capabilities skill \(this one's old name, not the run-book capture\)/i);
    assert.doesNotMatch(text, /which on that route is only the items no plugin holds/, 'every skill is a copy since 2.1.0');
    assert.match(text, /the core carries the seats/);
});

// ---- M82: a manual-only capture is the user's to type ---------------------------------------------------------
test('M82: code-quality hands the manual-only style capture to the user by its slash', () => {
    const text = flat(skill('alfred-capture-code-quality'));
    assert.doesNotMatch(text, /record the code style with `alfred-capture-code-style`/);
    assert.match(text, /`\/alfred-capture-code-style`/);
    assert.match(text, /both the user's to run/);
});

// ---- M83: coverlet's MSBuild form writes json unless told otherwise -------------------------------------------
test('M83: the coverage capture names the cobertura format flag on the MSBuild form', () => {
    assert.match(skill('alfred-capture-test-coverage'), /\/p:CollectCoverage=true \/p:CoverletOutputFormat=cobertura/);
});

// ---- M84: the transcript folder follows the config dir and the real slug rule ----------------------------------
test('M84: stack-usage finds the transcript folder under the config dir, by listing it', () => {
    const text = flat(skill('alfred-capture-stack-usage'));
    assert.doesNotMatch(text, /under `~\/\.claude\/projects\//, 'a configured CLAUDE_CONFIG_DIR moves it');
    assert.doesNotMatch(text, /slashes replaced by dashes/, 'dots map to dashes too');
    assert.match(text, /`\$\{CLAUDE_CONFIG_DIR:-\$HOME\/\.claude\}\/projects\/<encoded-project-path>\/`/);
    assert.match(text, /every non-alphanumeric character replaced by a dash/);
    assert.match(text, /List `\$\{CLAUDE_CONFIG_DIR:-\$HOME\/\.claude\}\/projects\/`/);
    // The rule the prose states is the one the stack's own importer computes.
    const { slugify } = require('./memory-import.js');
    assert.strictEqual(slugify('/Users/x/my.repo/.claude/worktrees/a_b'), '-Users-x-my-repo--claude-worktrees-a-b');
});

// ---- M86: the coverage loop keeps a declined set like its two siblings ----------------------------------------
test('M86: loop-test-coverage keeps an in-run declined set, pinned with the other loops', () => {
    const text = flat(skill('alfred-loop-test-coverage'));
    assert.match(text, /\*\*decline or defer adds the gap to this run's declined set\*\* - an in-context list only, never written to a file/);
    assert.ok(copiesOf(shared()['loop-declined-set']).includes('stack/skills/alfred-loop-test-coverage/SKILL.md'), 'registered as a site');
});

// ---- M87: no trigger text in a body, no When-to-use repeating the description ---------------------------------
test('M87: bodies carry no dead trigger lines and no When-to-use copy of the description', () => {
    for (const name of ['alfred-task-design', 'alfred-task-solve', 'alfred-issue-diagnoser'])
        assert.doesNotMatch(body(skill(name)), /Triggers also on/, `${name}: a body loads only after the trigger`);
    const ticket = section(body(skill('alfred-habits-create-ticket')), 'When to use');
    for (const phrase of ["'create a bug/story/epic/task ticket'", "'create jira ticket'", "'file a bug'"])
        assert.ok(!ticket.includes(phrase), `alfred-habits-create-ticket: When to use repeats ${phrase}`);
    const ci = section(body(skill('alfred-issue-signatures-ci')), 'When to use');
    assert.ok(ci, 'signatures-ci keeps a When to use section');
    for (const phrase of ['NU1301', 'ERESOLVE', 'exit 137', 'passes locally but fails in CI', 'Trigger on'])
        assert.ok(!ci.includes(phrase), `signatures-ci: When to use repeats ${phrase}`);
});

// ---- M88 + M89: project jargon and inline anecdotes leave the run-time bodies ----------------------------------
test('M88: no project-internal jargon in the implement and checkpoint bodies', () => {
    const impl = body(skill('alfred-task-implement'));
    assert.doesNotMatch(impl, /pilot 3|data-02/);
    assert.match(read('stack/skills/alfred-task-implement/references/evidence.md'), /data-02/, 'the story is kept in the appendix');
    const cp = body(skill('alfred-habits-commit-checkpoint'));
    assert.doesNotMatch(cp, /develop's old tip|pilot 3/);
    assert.match(flat(cp), /never the pre-merge tip - a receipt minted before the merge still reads the pre-merge tip/);
});

test('M89: the coverage capture, the coverage loop and the checkpoint keep their anecdotes in an evidence appendix', () => {
    const cases = {
        'alfred-capture-test-coverage': {
            run: ['SKILL.md', 'references/doc-shape.md'],
            stories: [/half its cost idling/, /Docker-handling/, /41GB/, /951 lines/, /24 serial edits/],
        },
        'alfred-loop-test-coverage': {
            run: ['SKILL.md'],
            stories: [/1 in 20/, /79\.3M/, /0 purges/, /16 -> 23/, /15-16k/, /convention-copying/, /dominates session cost/],
        },
        'alfred-habits-commit-checkpoint': {
            run: ['SKILL.md'],
            stories: [/6\.4M/, /471k/, /~150/],
        },
    };
    for (const [name, { run, stories }] of Object.entries(cases)) {
        for (const f of run) {
            const text = flat(body(read(`stack/skills/${name}/${f}`)));
            assert.doesNotMatch(text, /\(measured|\bmeasured[:,]|rounds measured|6\.4M tokens|471k|41GB|79\.3M/, `${name}/${f}: an anecdote is left in a run-time file`);
        }
        const evidence = `stack/skills/${name}/references/evidence.md`;
        assert.ok(exists(evidence), `${name}: has its evidence appendix`);
        const e = read(evidence);
        assert.match(e, /An audit appendix, not a run-time load/, `${name}: the appendix says it is never a run-time load`);
        for (const s of stories) assert.match(flat(e), s, `${name}: ${s} kept in the appendix`);
        assert.match(flat(skill(name)), /`references\/evidence\.md` - an audit appendix, not a run-time load/, `${name}: SKILL.md points at it`);
    }
});

// ---- M90: the publish step is an ask, and the receipt's extra lines are not both 'the sixth' --------------------
test('M90: the checkpoint publish step asks through a template, and names its extra receipt lines as extra', () => {
    const text = skill('alfred-habits-commit-checkpoint');
    assert.doesNotMatch(flat(text), /and get the answer\./, 'the publish stop is a prose stop');
    const publish = asks(text).find((a) => /^Publish /.test(a.question));
    assert.ok(publish, 'the publish confirmation is an ask template');
    assert.deepStrictEqual(lintAskTemplates([{ file: 'commit-checkpoint', text }]), []);
    assert.match(publish.options[0], /\(Recommended\)$/);
    assert.doesNotMatch(text, /sixth line/);
    assert.strictEqual((flat(text).match(/adds an extra line/g) || []).length, 2, 'security: and scope: are each an extra line');
});

// ---- M91: headings ----------------------------------------------------------------------------------------------
test('M91: adjust-agents-md is titled as the habit it is, and explain-code opens with an H1', () => {
    const adjust = body(skill('alfred-habits-adjust-agents-md')).trimStart();
    assert.doesNotMatch(adjust, /^# CLAUDE\.md capture/);
    assert.match(adjust, /^# Adjust AGENTS\.md - /);
    assert.match(body(skill('alfred-habits-explain-code')).trimStart(), /^# Explain code - /);
});

// ---- M92: the greenfield close names every missing capture in the template's order -------------------------------
test('M92: build-from-scratch Next run names the run book and the capabilities capture, the latter last', () => {
    const line = (skill('alfred-task-build-from-scratch').match(/^Next run: .*$/m) || [''])[0];
    const order = ['/alfred-capture-architecture', '/alfred-capture-code-style', '/alfred-capture-project-capabilities', '/alfred-capture-agent-capabilities'];
    const at = order.map((c) => line.indexOf(c));
    assert.ok(at.every((i) => i > 0), `every capture named: ${line}`);
    assert.deepStrictEqual([...at].sort((a, b) => a - b), at, 'in the template\'s post-install order, agent-capabilities last');
    assert.match(line, /PROJECT-CAPABILITIES\.md/);
    assert.match(line, /alfred-project-agent-capabilities\.md/);
});

// ---- M93: the over-build tags are this capture's own ---------------------------------------------------------
test('M93: architecture-quality names the five over-build tags as its own', () => {
    const text = flat(skill('alfred-capture-architecture-quality'));
    assert.doesNotMatch(text, /the verifier's five tags/);
    assert.match(text, /the five over-build tags \(delete \/ stdlib \/ native \/ yagni \/ shrink\)/);
});

// ---- M94: the preloaded design skill carries only what a seat runs ---------------------------------------------
test('M94: task-design keeps the seat method in SKILL.md and the orchestrator half plus the example in a reference', () => {
    const text = skill('alfred-task-design');
    const b = body(text);
    assert.doesNotMatch(b, /^## Example/m, 'the worked example is a reference');
    assert.doesNotMatch(b, /wc -l` the plan file/, 'the write verification is the orchestrator\'s');
    assert.match(flat(b), /A DISPATCHED designer seat has no Write tool/, 'the seat\'s own handoff rule stays');
    assert.match(flat(b), /a design flow writes it as its handoff/, 'the pinned carve-out stays');
    assert.match(flat(b), /Read `references\/write-and-hand-off\.md`/);
    const ref = read('stack/skills/alfred-task-design/references/write-and-hand-off.md');
    for (const piece of [/wc -l/, /Brief: 'Add data export to the records list\.'/, /alfred-task-verify-plan/, /alfred-task-implement/])
        assert.match(ref, piece);
    assert.ok(b.length < 12000, `the preloaded body is ${b.length} chars`);
    // Every designer seat still preloads it by the bare name of a skill that exists.
    const seats = fs.readdirSync(path.join(ROOT, 'stack/agents')).filter((f) => f.endsWith('-solution-designer.md'));
    assert.strictEqual(seats.length, 10);
    for (const f of seats) assert.match(read(`stack/agents/${f}`), /^\s*-\s*alfred-task-design$/m, `${f} preloads it`);
});

// ---- M95: explain-code's language rule states the Russian fallback --------------------------------------------
test('M95: explain-code says which language answers a request written in Russian', () => {
    const lang = flat(section(body(skill('alfred-habits-explain-code')), 'Language'));
    assert.match(lang, /A request written in Russian is answered in English/);
    assert.match(lang, /Never use Russian under any circumstances/, 'the author\'s constraint stands');
});

// ---- M96: task-design and verify-plan agree on a missing header ------------------------------------------------
test('M96: task-design states verify-plan\'s own grades for a missing Oriented: and Asked:', () => {
    const design = flat(body(skill('alfred-task-design')));
    assert.doesNotMatch(design, /fails a plan without/);
    assert.match(design, /a missing `Oriented:` is a MAJOR finding, a missing `Asked:` a MINOR one/);
    const plan = flat(skill('alfred-task-verify-plan'));
    assert.match(plan, /a plan missing the line[^.]*is itself a MAJOR finding/);
    assert.match(plan, /the missing line is a MINOR finding/);
});

// ---- M97: the docs-root rule lists every capture domain folder ------------------------------------------------
test('M97: alfred-docs-root names diagnoses/ and project-capabilities/', () => {
    const line = read('stack/rules/alfred-docs-root.md').split('\n').find((l) => /EVERY doc the assistant creates/.test(l)) || '';
    assert.match(line, /`diagnoses\/`/);
    assert.match(line, /`project-capabilities\/PROJECT-CAPABILITIES\.md`/);
    assert.match(flat(skill('alfred-issue-diagnoser')), /diagnoses\//, 'the folder the diagnoser writes');
    assert.match(flat(skill('alfred-capture-project-capabilities')), /project-capabilities\/PROJECT-CAPABILITIES\.md/);
});

// ---- M98: the vendored trio protocol's pointers into the owner's folder are the pinned exception ----------------
test('M98: every pointer a vendored trio protocol makes into the orchestrator\'s references carries its fallback', () => {
    const entry = shared()['domain-trio-protocol-vendored'];
    assert.match(entry._note, /pointers into the owner's references\/ are a sanctioned cross-folder read, like every sibling pointer check 34 resolves/);
    for (const file of copiesOf(entry).filter((f) => !f.includes('alfred-task-solve-cross/'))) {
        const text = read(file);
        const pointers = [...text.matchAll(/`alfred-task-solve-cross`'s `references\/[a-z-]+\.md`/g)];
        assert.ok(pointers.length > 0, `${file}: the check reads something`);
        for (const p of pointers) {
            const after = text.slice(p.index + p[0].length, p.index + p[0].length + 40);
            assert.match(after, /where installed|absent it/, `${file}: '${p[0]}' names no fallback`);
        }
    }
});

// ---- M99: the cross-task orchestrator fits the compaction re-attach window ---------------------------------------
test('M99: alfred-task-solve-cross\'s body is under 18,000 chars with its stops, ledger and rules still in SKILL.md', () => {
    const b = body(skill('alfred-task-solve-cross'));
    assert.ok(b.length < 18000, `body is ${b.length} chars`);
    for (const h of ['## Progress ledger', '## Rules', '## The seam is law'])
        assert.ok(b.includes(h), `${h} stays in the body`);
    assert.match(flat(b), /The main session is the only orchestrator/);
    assert.match(flat(b), /A causal claim about a dispatched seat's actions/);
    assert.doesNotMatch(b, /pilot 3/, 'the anecdotes left the run-time body');
    assert.match(read('stack/skills/alfred-task-solve-cross/references/evidence.md'), /18 of 40/);
    // Nothing was deleted: the close-out detail and the lookup moved to references the body names at their step.
    assert.match(flat(b), /Before the close report, Read `references\/close-out\.md`/);
    const close = flat(read('stack/skills/alfred-task-solve-cross/references/close-out.md'));
    for (const piece of [/## Doc-drift/, /`\/alfred-capture-architecture` named in the close report/, /docs\.js set architecture\/ARCHITECTURE\.md#known-ceilings/, /memories purged: <names\|none>/])
        assert.match(close, piece);
    assert.match(read('stack/skills/alfred-task-solve-cross/references/full-spec.md'), /node "\$SPEC" <<'REQUEST'/);
});

// ---- M100: the orchestrator runs its own copy of the full-spec script ----------------------------------------
test('M100: solve-cross reads spec-check.js from its own folder, never alfred-task-solve\'s', () => {
    const cross = 'stack/skills/alfred-task-solve-cross';
    const own = [`${cross}/SKILL.md`, ...fs.readdirSync(path.join(ROOT, cross, 'references')).map((f) => `${cross}/references/${f}`)];
    for (const f of own) assert.doesNotMatch(read(f), /alfred-task-solve\/scripts\/spec-check\.js/, `${f} reads into a sibling's folder`);
    assert.match(read(`${cross}/SKILL.md`), /alfred-task-solve-cross\/scripts\/spec-check\.js/);
});

// ---- M101 + M102: the two descriptions ------------------------------------------------------------------------
test('M101: verify-code\'s description is the plan-bound review, clear of /code-review and the done gate', () => {
    const d = description('alfred-task-verify-code');
    assert.match(d, /against its plan/);
    assert.match(d, /\/code-review/);
    assert.match(d, /done gate/);
    assert.doesNotMatch(d, /'check the code'/, 'the phrase /code-review owns');
    assert.ok(d.length <= 160, `${d.length} chars`);
});

test('M102: version-upgrade\'s description spends nothing on its manual-only flag', () => {
    const d = description('alfred-task-version-upgrade');
    assert.doesNotMatch(d, /Manual, \/-only\./);
    assert.match(skill('alfred-task-version-upgrade'), /^disable-model-invocation: true$/m, 'the frontmatter still carries it');
});

// ---- M103: the upgrade approval gate is templated, one mark per state ------------------------------------------
test('M103: version-upgrade\'s approval gate is two ask templates, the mark fixed in each', () => {
    const text = skill('alfred-task-version-upgrade');
    assert.doesNotMatch(flat(text), /\(recommended when no user-level question is open\)/, 'a conditional mark leaves one state unmarked');
    const all = asks(text);
    const approve = all.find((a) => a.options[0] === 'Approve - execute the stages (Recommended)');
    const plan = all.find((a) => a.options[0] === 'Just the plan (Recommended)');
    assert.ok(approve, 'no open question: approve is recommended');
    assert.ok(plan, 'a user-level question open: just the plan is recommended');
    assert.match(plan.question, /user-level/);
    assert.deepStrictEqual(lintAskTemplates([{ file: 'version-upgrade', text }]), []);
});

// ---- M104: one load line for the Angular conventions ---------------------------------------------------------
test('M104: the Angular playbook says to load the Angular conventions skill once', () => {
    const text = read('stack/skills/alfred-task-version-upgrade/references/upgrade-playbooks.md');
    assert.strictEqual((text.match(/Load the Angular conventions skill/g) || []).length, 1);
});

// ---- review-215-flow MINOR 1: a lookup that finds no script never runs the request as code --------------------
// `node ""` reads its program from stdin, so an empty $SPEC executed the user's request text as JavaScript.
test('the full-spec lookup with no script in either home prints the gated line and runs nothing', { skip: process.platform === 'win32' }, () => {
    const { spawnSync } = require('node:child_process');
    const os = require('node:os');
    for (const f of ['stack/skills/alfred-task-solve/SKILL.md', 'stack/skills/alfred-task-solve-cross/references/full-spec.md']) {
        const block = (read(f).match(/```bash\n(SPEC=[\s\S]*?)```/) || [])[1];
        assert.ok(block, `${f} carries the lookup block`);
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-lookup-'));
        try {
            const script = block.replace("<the user's request, verbatim>", "process.stdout.write('REQUEST-EXECUTED')");
            const r = spawnSync('bash', ['-c', script], { cwd: empty, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: empty, CLAUDE_CONFIG_DIR: empty } });
            assert.doesNotMatch(r.stdout, /REQUEST-EXECUTED/, `${f}: the request ran as code`);
            assert.match(r.stdout, /path: gated - spec-check not found/, `${f}: the gated line`);
        } finally {
            fs.rmSync(empty, { recursive: true, force: true });
        }
    }
});

// ---- review-215-flow MINOR 3: the diagnose flow and the plan-bound review keep their stories in an appendix ----
test('the diagnoser and verify-code bodies carry no pilot anecdote, and each story is kept in its evidence appendix', () => {
    for (const [name, story] of [['alfred-issue-diagnoser', /both diagnose runs/], ['alfred-task-verify-code', /\$6\.64/]]) {
        const b = body(skill(name));
        assert.doesNotMatch(b, /pilot 3/, `${name}: the anecdote left the run-time body`);
        assert.match(b, /`references\/evidence\.md` - an audit appendix, not a run-time load/, `${name}: the body names the appendix`);
        assert.match(read(`stack/skills/${name}/references/evidence.md`), story, `${name}: the story is kept`);
    }
});

// 2.1.6 review A1: a seat stopped at its maxTurns cap (or killed) returns cut-off output with no closing status
// line, and the CLI offers to message it on - a resume hands a runaway a fresh budget, so the cap is only a pause.
// Every orchestrator that routes a seat's return treats a status-less return as a seat death: one scoped
// re-dispatch, then BLOCKED to the user.
test('a status-less seat return is a seat death in every orchestrator that routes a return', () =>
{
    const entry = shared()['seat-statusless-return'];
    assert.ok(entry, 'pinned in meta/shared-rules.json');
    const homes = copiesOf(entry);
    for (const f of ['stack/skills/alfred-task-solve-cross/references/domain-trio-protocol.md', 'stack/skills/alfred-loop-quality/references/delegated-mode.md',
        'stack/skills/alfred-task-solve/references/step-mechanics.md', 'stack/rules/dotnet-repair-agents.md', 'stack/rules/angular-repair-agents.md'])
    {
        assert.ok(homes.includes(f), `${f} is a pinned home`);
        const text = flat(read(f));
        assert.match(text, /A return with no closing status line - a seat stopped at its `maxTurns` \(Claude Code marks the output partial from 2\.1\.246\) or killed mid-task - is never DONE and never resumed as-is/, f);
        assert.match(text, /a second status-less return from that task goes to the user as BLOCKED/, f);
    }
    const routing = flat(read('stack/skills/alfred-task-solve-cross/references/domain-trio-protocol.md')).split('- **Status routing.**')[1].split('- **Seat death.**')[0];
    assert.match(routing, /route it as a seat death/, 'the routing bullet itself carries the route');
});

// 2.1.6 review B3: a solve run lists its own feature's folder at resume, never the whole store, and its close
// purges the whole feature - a pre-2.1.6 run's flat notes included - and counts what is left with the trio
// protocol's own line, kept in the step mechanics (read at step 3) since the body sits at its 18,000-char cap.
test('solve resumes by the feature topic and closes on the counted purge', () =>
{
    const solve = flat(skill('alfred-task-solve'));
    assert.match(solve, /\*\*On invocation, resume before starting:\*\* `list_memories` with `topic: '<feature>'`/);
    assert.doesNotMatch(solve, /Delete or archive the cycle note/);
    assert.match(solve, /`mcp__plugin_navigation_navigation__delete_memory` each note under `topic: '<feature>'` \(cycle and seat notes\) plus a pre-2\.1\.6 run's flat `<feature>__\*`/);
    assert.match(solve, /in the close report, then the purge count \(`references\/step-mechanics\.md`\)/);
    const line = (text) => (/The purge is counted, not claimed\.\*\* At close, from the project root: `([^`]+)`/.exec(text) || [])[1];
    const own = line(flat(read('stack/skills/alfred-task-solve/references/step-mechanics.md')));
    assert.ok(own, 'the step mechanics carry the purge count line');
    assert.strictEqual(own, line(flat(read('stack/skills/alfred-task-solve-cross/references/domain-trio-protocol.md'))), 'the same line as the trio protocol');
});
