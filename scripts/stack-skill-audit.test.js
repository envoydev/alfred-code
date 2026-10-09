// Content assertions for the stack-skill rows of the 2026-10-08 skill audit (skills.md, 'Proposed fixes, ranked').
// Each case pins the wrong teaching absent and the corrected one present, so a later edit that restores it goes red
// here instead of shipping to every seat that preloads the skill. Moves to references/ are pinned the M106 way: the
// phrase lives in the reference, not the body, and the body cites the reference.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'stack', 'skills');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const skill = (name, file = 'SKILL.md') => read(`stack/skills/${name}/${file}`);
const squash = (s) => s.replace(/\s+/g, ' ');

// Every .md file of one skill, as [relative path, text].
function skillDocs(name)
{
    const out = [];
    const walk = (dir) =>
    {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }))
        {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith('.md')) out.push([path.relative(ROOT, p), fs.readFileSync(p, 'utf8')]);
        }
    };
    walk(path.join(SKILLS, name));
    return out;
}

// The text of one heading's section, up to the next heading of the same or higher level.
function section(text, heading)
{
    const lines = text.split('\n');
    const start = lines.findIndex((l) => /^#+ /.test(l) && l.replace(/^#+\s*/, '') === heading);
    assert.ok(start >= 0, `section '${heading}' not found`);
    const level = /^#+/.exec(lines[start])[0].length;
    let end = lines.findIndex((l, i) => i > start && /^#+ /.test(l) && /^#+/.exec(l)[0].length <= level);
    if (end < 0) end = lines.length;
    return lines.slice(start, end).join('\n');
}

const description = (name) => (/^description:\s*"(.*)"\s*$/m.exec(skill(name)) || [])[1] || '';

// BLOCKER 4: the pre-commit checkpoint runs its own scoped review of the diff; `/security-review` is the unbounded
// route it reaches for only when the whole branch is the scope. No stack skill may say the checkpoint runs it.
// S9, the user's ruling 2026-10-09: dotnet-security stays seeded in the desktop and service stacks and is made
// desktop-aware, since it is the only security skill those stacks carry.
// https://learn.microsoft.com/en-us/dotnet/standard/serialization/binaryformatter-security-guide
// https://learn.microsoft.com/en-us/dotnet/api/system.windows.markup.xamlreader.load (restrictive mode is defense in depth only)
test('S9: dotnet-security triggers on desktop, console and service apps and maps their boundaries', () =>
{
    const body = skill('dotnet-security');
    const desc = (body.match(/^description:\s*"(.*)"$/m) || [])[1] || '';
    assert.match(desc, /WPF, WinForms, console, services/, 'the description names the desktop and service apps');
    assert.ok(desc.length <= 160, `description ${desc.length} chars`);
    assert.match(squash(body), /A desktop, console or Windows-service app: read `references\/desktop-and-service-apps\.md` first/, 'When to use routes desktop work to its map');
    const ref = squash(skill('dotnet-security', 'references/desktop-and-service-apps.md'));
    for (const t of ['BinaryFormatter', 'SoapFormatter', 'NetDataContractSerializer', 'LosFormatter', 'ObjectStateFormatter'])
        assert.ok(ref.includes(t), `the unsafe formatter ${t} is named`);
    assert.match(ref, /XamlReader\.Load/, 'runtime XAML is treated as code');
    assert.match(ref, /DataProtectionScope\.CurrentUser/, 'per-user secrets go to DPAPI');
    assert.match(ref, /ProcessStartInfo\.ArgumentList/, 'process starts take an argument list');
    assert.match(ref, /the web-only controls drop out: CORS, antiforgery, HSTS/, 'the browser-only controls are marked out');
    const seeds = require(path.join(ROOT, 'meta', 'recommendations.json')).stacks;
    for (const s of ['wpf', 'winforms', 'console', 'windows-service'])
        assert.ok(seeds[s].skills.includes('dotnet-security'), `${s} keeps dotnet-security seeded`);
});

test('B4: no stack skill says the pre-commit checkpoint runs /security-review', () =>
{
    // directories only - a checkout carries OS litter (.DS_Store) beside the skills
    for (const dir of fs.readdirSync(SKILLS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name))
    {
        for (const [rel, text] of skillDocs(dir))
            assert.doesNotMatch(squash(text), /`\/security-review`, which the pre-commit checkpoint runs/, `${rel} says the checkpoint runs /security-review`);
    }
    assert.match(squash(skill('dotnet-security')), /pairs with the pre-commit security review of the live diff/);
    assert.match(squash(skill('angular-security')), /This is the client-side map\./);
});

// BLOCKER 7: .NET 10 obsoletes Form.OnClosing / OnClosed and their events (WFDEV004); under warnings-as-errors the
// old advice is a build break. https://learn.microsoft.com/en-us/dotnet/desktop/winforms/wfdev-diagnostics/wfdev004
test('B7: dotnet-winforms detaches in OnFormClosed, never the obsolete OnClosed', () =>
{
    let named = 0;
    for (const [rel, text] of skillDocs('dotnet-winforms'))
    {
        const flat = squash(text);
        for (const m of flat.matchAll(/`OnClosed`[^.]*\./g))
            assert.match(m[0], /obsolete|WFDEV004/, `${rel} names OnClosed outside its obsolete note: ${m[0]}`);
        if (/detach in `OnFormClosed` \(a Form\) or `Dispose`/.test(flat)) named++;
    }
    assert.strictEqual(named, 2, 'the body and the disposal reference both detach in OnFormClosed');
});

// BLOCKER 8: the reward-hacking table told every Angular change to use fakeAsync, which the Vitest runner (the CLI
// default) cannot run without the zone patch; angular-testing owns runner routing.
// https://angular.dev/guide/testing/migrating-to-vitest
test('B8: Angular fake time follows the runner - fakeAsync under Karma/Jest, vi.useFakeTimers() under Vitest', () =>
{
    const table = squash(skill('angular-conventions', 'references/reward-hacking.md'));
    assert.doesNotMatch(table, /`fakeAsync` with an honest `tick`/);
    assert.match(table, /honest fake time for the runner \(`fakeAsync` \+ `tick` under Karma\/Jest, `vi\.useFakeTimers\(\)` under Vitest\)/);
    const timing = squash(section(skill('angular-testing'), 'Timing and async'));
    assert.match(timing, /`zone\.js\/plugins\/vitest-patch`/);
    assert.match(timing, /`vi\.useFakeTimers\(\)` \+ `vi\.advanceTimersByTime\(\)`/);
});

// BLOCKER 9 (conflict C4): the SQLite rebuild sample retyped an order total to REAL against the hub's money rule; the
// lesson now rides an integer quantity (STRICT tables allow no NUMERIC - https://www.sqlite.org/stricttables.html).
test('B9: no data-skill sample stores money in a binary float', () =>
{
    for (const name of ['sqlite', 'postgres', 'database-conventions', 'database-security', 'dotnet-data-access'])
    {
        for (const [rel, text] of skillDocs(name))
            assert.doesNotMatch(text, /\b(total|price|amount|cost|balance)\s+(REAL|FLOAT|DOUBLE)\b|CAST\((total|price|amount) AS REAL\)/i, `${rel} types money as a binary float`);
    }
    const sqlite = skill('sqlite');
    assert.match(sqlite, /^\s*qty\s+INTEGER NOT NULL,\s+-- was TEXT$/m);
    assert.match(sqlite, /SELECT id, CAST\(qty AS INTEGER\), placed FROM orders;/);
});

// MATERIAL csharp:116 - the async baseline is stated in the preloaded body, not two reference hops away.
test('M csharp: the body states the never-block / no-async-void rule itself', () =>
{
    const text = squash(section(skill('csharp'), 'Async, disposal, and JSON'));
    assert.match(text, /Never block on async code \(`\.Result`, `\.Wait\(\)`, `\.GetAwaiter\(\)\.GetResult\(\)`\)/);
    assert.match(text, /no `async void` outside event handlers/);
});

// MATERIAL dotnet-architecture:3 - the listing separates choosing an architecture from documenting or judging one.
test('M dotnet-architecture: the description names its near-miss boundary', () =>
{
    assert.match(description('dotnet-architecture'), /Not for documenting or judging one\./);
});

// MATERIAL dotnet-code-quality:88-94 - the reward-hack scan is a numbered step of the gate's proof.
test('M dotnet-code-quality: the gate proof includes the reward-hack scan', () =>
{
    const gate = squash(section(skill('dotnet-code-quality'), 'The gate is `dotnet build`'));
    assert.match(gate, /4\. Check the diff against `references\/reward-hacking\.md` row by row - report `Reward-hack scan: clean` or the rows hit\./);
});

// MATERIAL dotnet-diagnostics microbenchmarking.md:90-94 - a void benchmark is dead-code-eliminable (the file's own
// table says return a value); the comparison example returns its result.
test('M dotnet-diagnostics: the comparison benchmark returns its result', () =>
{
    const ref = skill('dotnet-diagnostics', 'references/microbenchmarking.md');
    const compare = section(ref, 'Comparing two implementations');
    assert.doesNotMatch(compare, /\[Benchmark[^\]]*\]\s*\n\s*public void /, 'a void [Benchmark] in the comparison sample');
    assert.match(compare, /public int\[\] Bubble\(\)/);
    assert.match(compare, /Ratio understates the gap/);
});

// MATERIAL dotnet-project-setup:43 - the CPM add/remove rule lives in the body, not only behind a pointer.
test('M dotnet-project-setup: adding a package under CPM goes through the CLI, stated in the body', () =>
{
    const text = squash(skill('dotnet-project-setup'));
    assert.match(text, /Add or remove a package with `dotnet add package <name>` \/ `dotnet remove package <name>`/);
    assert.match(text, /under central management it writes both files in sync/);
});

// MATERIAL dotnet-testing:71 - the done word carries the run's summary line, and a fix's red run first.
test('M dotnet-testing: the done word quotes dotnet test and the red run', () =>
{
    assert.match(squash(skill('dotnet-testing')), /Before any done word: run `dotnet test -v minimal` and quote its summary line; for a fix, quote the red run on the unfixed code first\./);
    const notTest = squash(section(skill('dotnet-testing'), 'What NOT to test'));
    assert.match(notTest, /Everything in §Standard exclusions/);
});

// MATERIAL dotnet-winforms:17 and :154-155 - the designer-file rule is in the body the *.Designer.cs glob loads, and
// the leak check is a numbered proof with a fallback when no desktop session can run it.
test('M dotnet-winforms: designer rule in the body, numbered leak proof with a user fallback', () =>
{
    const text = squash(skill('dotnet-winforms'));
    assert.match(text, /A `\*\.Designer\.cs` belongs to the designer/);
    assert.match(text, /initialization that touches controls goes after `InitializeComponent\(\)`/);
    assert.match(text, /1\. `dotnet build` - quote the summary line\. 2\. Open and close the affected form twenty times/);
    assert.match(text, /put the twenty-cycle check to the user through AskUserQuestion and mark it UNVERIFIED until answered/);
});

// MATERIAL dotnet-hosted-services:8 - the preamble names the boundary once and leaves the routes to When to use.
test('M dotnet-hosted-services: one-line ownership preamble, lifecycle hooks in the reference', () =>
{
    const intro = squash(skill('dotnet-hosted-services').split('## When to use')[0]);
    assert.doesNotMatch(intro, /broker-messaging skill's/);
    assert.match(intro, /stops at the host boundary \(what lies past it: When to use\)/);
});

// MATERIAL angular-conventions:76 - the forms reference is reachable from the body, not only through another reference;
// :3 the change-detection reference keeps only what the body lacks.
test('M angular-conventions: forms-validation is cited by the body, the signal rule lives once', () =>
{
    assert.match(squash(skill('angular-conventions')), /Before building any non-trivial form, Read `references\/forms-validation\.md`/);
    const cd = squash(skill('angular-conventions', 'references/change-detection-and-signals.md'));
    assert.doesNotMatch(cd, /Any state a `computed` or an `effect` reads must itself be a `signal`/);
    assert.match(cd, /readonly filter = signal\(''\);/);
    assert.match(cd, /must call `event\.animationComplete\(\)`/);
});

// MATERIAL ionic navigation-and-lifecycle.md:59-62 - a plain field set from a subscription never repaints an OnPush page.
test('M ionic: the per-visit subscription writes a signal, and the seam reference stops restating the body', () =>
{
    const nav = skill('ionic', 'references/navigation-and-lifecycle.md');
    assert.doesNotMatch(nav, /this\.data = d\)/);
    assert.match(nav, /readonly data = signal<FeedData \| undefined>\(undefined\);/);
    assert.match(nav, /subscribe\(\(d\) => this\.data\.set\(d\)\)/);
    const seam = squash(skill('ionic', 'references/native-seam.md'));
    assert.doesNotMatch(seam, /Call a plugin only through a typed Angular service/);
    assert.doesNotMatch(seam, /Every native call needs a defined web path/);
});

// MATERIAL ionic-security:3 - the listing names the near-miss boundary; MINOR :30 - a custom-scheme link puts its first
// segment in the host, so the allowlist reads host + pathname for any scheme but https (checked with Node's WHATWG URL).
test('M ionic-security: boundary in the description, custom-scheme links parse to a routable path', () =>
{
    assert.match(description('ionic-security'), /Not for web-only Angular\.$/);
    const text = skill('ionic-security');
    assert.doesNotMatch(text, /const path = new URL\(url\)\.pathname;/);
    assert.match(text, /const path = u\.protocol === 'https:' \? u\.pathname : `\/\$\{u\.host\}\$\{u\.pathname\}`;/);
});

// MATERIAL npm:38 - the baseline is gated whether or not an .npmrc exists, and lands as numbered steps.
test('M npm: the baseline is its own asked change, landed in seven numbered steps', () =>
{
    const text = squash(section(skill('npm'), 'Non-negotiables (any repo that has a package.json)'));
    assert.doesNotMatch(text, /A repo that already has an `\.npmrc` gets the baseline lines/);
    assert.match(text, /3\. Adding the baseline is its own change: when the task did not ask for it, propose it through ONE AskUserQuestion/);
    assert.match(text, /7\. Close on the project's build and test run with their result lines quoted/);
});

// MATERIAL nx:81 (conflict C16) - configure-ai-agents rewrites the instruction files this stack seeds.
test('M nx: configure-ai-agents is the user\'s to run, and affected follows defaultBase', () =>
{
    const text = squash(skill('nx'));
    assert.match(text, /Never run `npx nx configure-ai-agents` yourself/);
    assert.doesNotMatch(text, /against a base with `--base=main`/);
    assert.match(text, /against the workspace's `defaultBase` \(nx\.json\)/);
    assert.match(text, /`nx g <generator> <name> --dry-run`/);
});

// MATERIAL typescript-style.md:122-147 - the reference maps the body's rules to lint rules instead of restating them.
test('M typescript: the style reference maps rules to lint, the body owns the principle', () =>
{
    const ref = squash(skill('typescript', 'references/typescript-style.md'));
    assert.doesNotMatch(ref, /Use `unknown` for values of genuinely unknown type/);
    assert.doesNotMatch(ref, /Prefer `undefined` for 'absent' in TS code/);
    assert.match(ref, /no-explicit-any - 'error' in `recommended` and `strict`/);
    assert.match(ref, /unless the framework layer prescribes its own injection function, which wins/);
    assert.match(squash(skill('typescript')), /`interface` for object shapes \(the typescript-eslint consistent-type-definitions default\)/);
});

// MINOR webpack:32-33 - one ESM default. Currency: experiments.outputModule is removed from 5.111 and output.module works
// alone. https://webpack.js.org/configuration/experiments/ , https://webpack.js.org/configuration/output/
test('m webpack: modern-module is the default ESM library type, and output.module carries it', () =>
{
    const text = squash(skill('webpack'));
    assert.doesNotMatch(text, /and it is still experimental/);
    assert.match(text, /Default to `output\.library\.type: 'modern-module'`/);
    assert.match(text, /from 5\.111 the experiment is removed and `output\.module` works alone/);
    const ref = skill('webpack', 'references/library-config.md');
    assert.doesNotMatch(ref, /^\s*experiments: \{ outputModule: true \},/m);
    assert.match(ref, /library: \{ type: 'modern-module' \}/);
    assert.match(ref, /^\s*module: true,/m);
});

// MINOR capacitor-release:70 - fastlane's gradle action runs in project_dir, default '.', and a Capacitor Gradle project
// lives in android/. https://docs.fastlane.tools/actions/gradle/
test('m capacitor-release: the Android lane names project_dir, and no unnamed official OTA path', () =>
{
    const text = skill('capacitor-release');
    assert.match(text, /gradle\(task: 'bundle', build_type: 'Release', project_dir: 'android\/'\)/);
    assert.doesNotMatch(text, /the official live-update mechanism as the alternative/);
});

// MINOR (D2 gap) ts-js-testing - the defect-named spec and self-review rules ride with the plain TS/JS hub too.
test('m ts-js-testing: carries the defect-named spec rule, the self-review rule and a templated close', () =>
{
    const text = squash(skill('ts-js-testing'));
    assert.match(text, /fails on the unfixed code before it passes/);
    assert.match(text, /A self-review is never the check/);
    assert.match(text, /Close with `specs: <command> -> <result line>`/);
    assert.doesNotMatch(text, /verified against the Vitest docs/);
    assert.doesNotMatch(text, /The default-runner rule is the `javascript` skill's/);
});

// MINOR javascript async-patterns.md:15/:21 - no .NET aside, and no reliance on a lint a plain-JS project lacks.
test('m javascript: the async reference is generic and names where the floating-promise lint exists', () =>
{
    const ref = squash(skill('javascript', 'references/async-patterns.md'));
    assert.doesNotMatch(ref, /CancellationToken/);
    assert.match(ref, /`no-floating-promises` where the project type-checks, otherwise review every un-awaited call/);
});

// MATERIAL database-conventions:53-63 (conflict C14) - the body's keyset rule wins, and the style reference no longer
// offers OFFSET as the one pagination form; :82-88 naming has one home.
test('M database-conventions: keyset pagination lives in sql-style \u00a710 with no OFFSET contradiction, naming in \u00a72', () =>
{
    const body = squash(skill('database-conventions'));
    assert.match(body, /\*\*Deep pagination is keyset \(seek\), never `OFFSET`\*\* - `OFFSET 20000` still scans and discards 20000 rows; the seek shape and its SQL Server spelling are `references\/sql-style\.md` \u00a710\./);
    assert.doesNotMatch(body, /WHERE \(created_at, id\) </);
    assert.match(body, /Naming style - keyword casing, singular\/plural, FK and index names - is `references\/sql-style\.md` \u00a72\./);
    const style = squash(skill('database-conventions', 'references/sql-style.md'));
    assert.match(style, /\| Pagination \(shallow pages\) \|/);
    assert.match(style, /\| Deep pagination \| keyset seek/);
    assert.match(style, /WHERE \(created_at, id\) < \(:last_created_at, :last_id\)/);
    assert.match(squash(section(skill('database-conventions'), 'Migrations')), /3\. Report the three exit lines - `rerun: <exit line>`, `down: <exit line>`, `reapply: <exit line>`/);
});

// MINOR database-security:58 - each probe is given per engine, verified against the catalogs:
// https://www.postgresql.org/docs/current/infoschema-role-table-grants.html , https://www.postgresql.org/docs/current/catalog-pg-policy.html ,
// https://learn.microsoft.com/en-us/sql/relational-databases/system-functions/sys-fn-my-permissions-transact-sql ,
// https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-security-policies-transact-sql
test('m database-security: the two probes are spelled per engine, and the description names its boundary', () =>
{
    const probe = section(skill('database-security'), 'Probe before you report');
    assert.match(probe, /FROM information_schema\.role_table_grants WHERE grantee = '<runtime login>';/);
    assert.match(probe, /LEFT JOIN pg_policy p ON p\.polrelid = c\.oid/);
    assert.match(probe, /SELECT \* FROM fn_my_permissions\(NULL, 'DATABASE'\);/);
    assert.match(probe, /SELECT name, is_enabled FROM sys\.security_policies;/);
    assert.match(description('database-security'), /Not for schema design\.$/);
});

// MINOR postgres:122 - PgBouncer's own pool_mode default is session (https://www.pgbouncer.org/config.html).
test('m postgres: transaction pooling is set explicitly, not assumed', () =>
{
    assert.match(squash(skill('postgres')), /set it explicitly \(`pool_mode = transaction` on PgBouncer, whose own default is `session`\)/);
});

// MINOR devops:72-74 - the proof is three numbered, named tools; actionlint per https://github.com/rhysd/actionlint
test('m devops: the pipeline proof is three numbered checks with named tools', () =>
{
    const prove = squash(section(skill('devops'), 'Prove the pipeline change'));
    assert.match(prove, /1\. `docker build` on the Dockerfile you touched/);
    assert.match(prove, /2\. `actionlint` on the workflow you touched\./);
    assert.match(prove, /3\. `gitleaks` over the diff\./);
    assert.match(prove, /report that leg UNVERIFIED/);
    assert.match(skill('devops', 'references/github-actions.md'), /\(packages\.lock\.json, package-lock\.json, yarn\.lock\)/);
});

// MATERIAL desktop-automation:61-63, :87 - a stop puts its question through the ask tool with a marked recommendation.
test('M desktop-automation: the two stops ask through AskUserQuestion, and the listing names its boundary', () =>
{
    const text = squash(skill('desktop-automation'));
    assert.doesNotMatch(text, /report what it says, and hand it to the user/);
    assert.doesNotMatch(text, /Say so and stop: only the user can grant either/);
    assert.match(text, /ONE AskUserQuestion - 'I have dealt with it - continue' \(Recommended\) \/ 'Stop the task'/);
    assert.match(text, /ONE AskUserQuestion - 'Granted and reconnected - continue' \(Recommended\) \/ 'Stop here'/);
    assert.match(description('desktop-automation'), /Not for web pages or the app code\.$/);
});

// Situational detail moved out of a preloaded or rule-forced body into a reference the body cites.
const MOVED = [
    ['dotnet-code-quality', 'references/legacy-backlog.md', 'Never `CS8019`, a hidden diagnostic'],
    ['dotnet-hosted-services', 'references/deployment-and-observability.md', 'StartingAsync -> StartAsync -> StartedAsync'],
    ['dotnet-mvc-controllers', 'references/api-behavior-options.md', 'Leave it off; the mapping is what gives every 4xx/5xx'],
    ['dotnet-mvc-controllers', 'references/filter-pipeline.md', 'a lower `Order` runs its before-code earlier'],
    ['dotnet-testing', 'references/coverage-collection.md', 'ReportGenerator'],
    ['dotnet-web-backend', 'references/resilience.md', 'new ResiliencePipelineBuilder()'],
    ['dotnet-minimal-api', 'references/file-uploads.md', 'MultipartBodyLengthLimit'],
    ['dotnet-openapi', 'references/consumer-codegen.md', 'OpenApiGenerateDocumentsOnBuild'],
    ['dotnet-authentication', 'references/oidc-and-api-keys.md', 'AddOpenIdConnect'],
    ['csharp', 'references/csharp-style.md', 'dotnet_style_allow_multiple_blank_lines_experimental'],
    ['csharp', 'references/dependency-injection.md', '`appsettings.{Environment}.json`'],
    ['angular-conventions', 'references/rxjs.md', 'shareReplay({ bufferSize: 1, refCount: true })'],
    ['angular-styling', 'references/ionic-shadow-dom.md', 'ion-palette-dark'],
    ['capacitor-release', 'references/versioning-and-symbols.md', 'capacitor-set-version'],
    ['ionic', 'references/native-seam.md', "'Which OS?' -> `Capacitor.getPlatform()`"],
    ['typescript', 'references/typescript-style.md', 'Hold on TS 6 if you depend on the programmatic compiler API'],
    ['devops', 'references/github-actions.md', 'cancel-in-progress: true'],
    ['devops', 'references/deploy.md', 'expand-then-contract'],
];
test('moves: each moved block lives in its reference, not the body, and the body cites the reference', () =>
{
    for (const [name, ref, phrase] of MOVED)
    {
        const body = skill(name);
        assert.ok(skill(name, ref).includes(phrase), `${name}/${ref} lacks '${phrase}'`);
        assert.ok(!body.includes(phrase), `${name}/SKILL.md still carries '${phrase}' - one home`);
        assert.ok(body.includes(`\`${ref}\``), `${name}/SKILL.md never cites ${ref}`);
    }
});
