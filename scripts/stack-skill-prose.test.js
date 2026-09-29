// Content assertions for the stack-skill Minors of the 2026-09-29 audit (merged.md M105-M128).
// Each case pins the wrong claim absent and the verified claim present, so a later edit that
// restores the old teaching goes red here instead of shipping to every seat that loads the skill.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { lintAskTemplates, lintSharedRules } = require('./lint-skills.js');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'stack', 'skills');
const AGENTS = path.join(ROOT, 'stack', 'agents');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const skill = (name, file = 'SKILL.md') => read(`stack/skills/${name}/${file}`);
const squash = (s) => s.replace(/\s+/g, ' ');

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

const askCount = (text) => [...text.matchAll(/^[ \t]*```ask[ \t]*$/gm)].length;

test('M105: a central package version moves through the dotnet CLI in the upgrade playbook too', () =>
{
    const playbook = squash(skill('alfred-task-version-upgrade', 'references/upgrade-playbooks.md'));
    assert.doesNotMatch(playbook, /that is one edit in `Directory\.Packages\.props`/);
    assert.match(playbook, /one `<PackageVersion>` change in `Directory\.Packages\.props`, made through the dotnet CLI/);
    assert.match(squash(skill('csharp')), /never hand-edit `Directory\.Packages\.props`/);
});

// The preloaded hubs ride into every seat that lists them; situational detail waits in references/.
const HUB_CAPS = { csharp: 16500, 'angular-conventions': 15000, 'database-conventions': 15500 };
const MOVED = [
    ['csharp', 'references/csharp-style.md', 'case A:'],
    ['angular-conventions', 'references/http-routing-forms.md', 'withComponentInputBinding()'],
    ['angular-conventions', 'references/performance-budgets.md', '500 KB gzipped'],
    ['database-conventions', 'references/stores-procedures-views.md', 'Keep business logic out of triggers'],
    ['database-conventions', 'references/stores-procedures-views.md', '16 MB document limit'],
];
test('M106: the three preloaded hubs keep their rules and move situational detail to cited references', () =>
{
    for (const [name, cap] of Object.entries(HUB_CAPS))
    {
        const len = skill(name).length;
        assert.ok(len <= cap, `${name}/SKILL.md is ${len} chars, over its ${cap} cap - move situational detail to a cited reference, never raise the cap`);
    }
    for (const [name, ref, phrase] of MOVED)
    {
        const body = skill(name);
        assert.ok(skill(name, ref).includes(phrase), `${name}/${ref} lacks '${phrase}'`);
        assert.ok(!body.includes(phrase), `${name}/SKILL.md still carries '${phrase}' - one home`);
        assert.ok(body.includes(`\`${ref}\``), `${name}/SKILL.md never cites ${ref}`);
    }
    // review-215-stack: a verifier preloads these hubs too, so each moved-section pointer names the review
    for (const [name, ref] of [['angular-conventions', 'references/http-routing-forms.md'], ['angular-conventions', 'references/performance-budgets.md'], ['database-conventions', 'references/stores-procedures-views.md']])
    {
        const line = skill(name).split('\n').find((l) => /\bread \`/i.test(l) && l.includes(`\`${ref}\``)) || '';
        assert.match(line, /or reviewing/, `${name}: the ${ref} pointer reaches a reviewer`);
    }
    assert.match(squash(skill('csharp')), /follow one order, the same in all three/, 'fields, parameters and assignments match one to one');
    // the rule the csharp example illustrates stays in the preloaded body
    assert.match(skill('csharp'), /Every `switch` case body wrapped in its own `\{ \}` block/);
    // every seat that preloads a hub still resolves it
    for (const f of fs.readdirSync(AGENTS).filter((n) => n.endsWith('.md')))
    {
        const fm = fs.readFileSync(path.join(AGENTS, f), 'utf8').split('\n---')[0];
        for (const m of fm.matchAll(/^\s+- ([a-z0-9-]+)\s*$/gm))
            if (m[1] in HUB_CAPS) assert.ok(fs.existsSync(path.join(SKILLS, m[1], 'SKILL.md')), `${f} preloads a missing ${m[1]}`);
    }
});

test('M107: angular-conventions names no dangling cite and lists its co-loads one per line', () =>
{
    const text = skill('angular-conventions');
    assert.doesNotMatch(text, /broader web index/);
    const head = text.slice(0, text.indexOf('## When to use'));
    assert.match(head, /^- .*TypeScript skill/m, 'the TypeScript co-load is its own bullet');
    assert.match(head, /^- .*`documentation` MCP/m, 'the documentation-server directive is its own bullet');
});

test('M108: the reward-hacking tables point at a named SKILL.md section, never at "above"', () =>
{
    for (const name of ['angular-conventions', 'dotnet-code-quality'])
    {
        const ref = skill(name, 'references/reward-hacking.md');
        assert.doesNotMatch(ref, /\babove\)/, `${name}/references/reward-hacking.md still points 'above' from a reference file`);
    }
    assert.match(skill('angular-conventions', 'references/reward-hacking.md'), /SKILL\.md's Testing section/);
    assert.match(skill('dotnet-code-quality', 'references/reward-hacking.md'), /SKILL\.md's 'Warnings as errors' section/);
});

test('M109: angular-testing tags the v20 signal-test APIs and gives the v17-19 fallback', () =>
{
    const text = squash(skill('angular-testing'));
    assert.match(text, /`TestBed\.tick\(\)` \(v20\+/);
    assert.match(text, /`TestBed\.flushEffects\(\)` on v17-19/);
    assert.match(text, /`inputBinding\(\)` \/ `outputBinding\(\)` \/ `twoWayBinding\(\)` on `createComponent` \(v20\+/);
});

test('M110: angular-styling quotes the ::ng-deep status instead of predicting its removal', () =>
{
    const text = squash(skill('angular-styling'));
    assert.doesNotMatch(text, /slated to go/);
    assert.match(text, /These APIs remain exclusively for backwards compatibility/);
});

test('M111: capacitor-release attributes no audit to the Ionic security skill', () =>
{
    assert.doesNotMatch(skill('capacitor-release'), /the control `ionic-security` audits/);
});

test('M112: csharp-design-patterns asks through the tool and builds the sample it calls compilable', () =>
{
    const workflow = squash(section(skill('csharp-design-patterns'), 'Workflow'));
    assert.match(workflow, /ONE AskUserQuestion/);
    assert.match(workflow, /`dotnet build`/);
    assert.match(workflow, /quote its summary line/);
});

test('M113: migration idempotence is proven on the guarded script and the down path, not a no-op rerun', () =>
{
    const text = squash(section(skill('database-conventions'), 'Migrations'));
    assert.doesNotMatch(text, /Run the migration, run it a second time against the same database/);
    assert.match(text, /a second run through a history-tracked tool .* is a no-op and proves nothing/);
    assert.match(text, /`migrations script --idempotent`/);
    assert.match(text, /roll back through the down path, then apply again/);
});

test('M114: database-conventions states the database-security boundary once and carries no maintainer note', () =>
{
    const text = skill('database-conventions');
    assert.strictEqual((text.match(/`database-security`/g) || []).length, 1, 'one boundary line names the security skill');
    assert.doesNotMatch(text, /Placement decision/);
});

test('M115: devops shows how a shell-less image is health-checked', () =>
{
    const text = skill('devops');
    const rules = squash(section(text, 'Docker - reproducible, minimal, non-root'));
    assert.match(rules, /no shell and no `curl`/);
    assert.match(rules, /the orchestrator's HTTP probe/);
    assert.match(text, /^HEALTHCHECK .*CMD \["dotnet", "\/probe\/HealthProbe\.dll", "http:\/\/localhost:8080\/healthz"\]$/m);
    assert.match(text, /^COPY --from=build \/probe \/probe$/m);
});

test('M116: the dotnet router sends cross-cutting flow to the baseline rules', () =>
{
    const text = squash(skill('dotnet'));
    assert.doesNotMatch(text, /git - lives in the project's `CLAUDE\.md`/);
    assert.match(text, /git - lives in the always-on baseline rules/);
});

test('M117: the projection example returns a read-only list, as the C# baseline asks', () =>
{
    const text = skill('dotnet-data-access');
    assert.doesNotMatch(text, /Task<List<OrderSummary>>/);
    assert.match(text, /public async Task<IReadOnlyList<OrderSummary>> RecentAsync/);
    assert.match(text, /=>\s*\n\s*await _db\.Orders/);
});

test('M118: the auth, crypto and arch-test samples say what the APIs actually do', () =>
{
    const auth = squash(skill('dotnet-authentication'));
    assert.doesNotMatch(auth, /DateOnly\.Parse\(/);
    assert.match(auth, /DateOnly\.TryParseExact\(dob, "yyyy-MM-dd", CultureInfo\.InvariantCulture/);
    assert.match(auth, /builder\.Services\.AddSingleton<IAuthorizationHandler, MinimumAgeHandler>\(\);/);
    assert.match(auth, /builder\.Services\.TryAddSingleton\(TimeProvider\.System\);/);
    assert.doesNotMatch(auth, /AuthorizeAsync\(user, resource, policy\)` inside the handler/);
    assert.match(auth, /in the endpoint or action, once the resource is loaded/);

    const crypto = squash(skill('dotnet-cryptography'));
    assert.doesNotMatch(crypto, /static helpers \(`SHA256\.HashData`, `AesGcm`, `RSA\.Encrypt`\)/);
    assert.match(crypto, /`AesGcm` and `RSA` have no one-shot/);

    const arch = squash(skill('dotnet-architecture-tests'));
    assert.doesNotMatch(arch, /Fail the build when a production assembly depends on `Console\.WriteLine`/);
    assert.match(arch, /a console app's own entry assembly is exempt/);
    assert.match(arch, /`ShouldNot\(\)\.HaveDependencyOnAny\("System\.Console", "System\.Diagnostics\.Debug", "System\.Diagnostics\.Debugger"\)`/);
});

test('M119: the gRPC client sample says what the standard resilience handler does to a call', () =>
{
    const client = squash(section(skill('dotnet-grpc'), 'Client'));
    assert.match(client, /times and retries the HTTP request, not the gRPC call/);
    assert.match(client, /until response headers arrive/);
    assert.match(client, /never sees a gRPC status such as `Unavailable`/);
    assert.match(client, /`\.ConfigureChannel\(o => o\.ServiceConfig = /);
    assert.match(client, /`RetryPolicy`/);
    assert.match(client, /committed/);
});

test('M120: the npm baseline check expects key-prefixed output and names the too-old signal', () =>
{
    const text = squash(skill('npm'));
    assert.doesNotMatch(text, /must echo `true 7 none true`/);
    assert.match(text, /`ignore-scripts=true`, `min-release-age=7`, `allow-git=none`, `engine-strict=true`/);
    assert.match(text, /`npm warn Unknown project config`/);
});

test('M121: webpack tilde-pins the minor verified at use, not an aged hard pin', () =>
{
    const text = squash(skill('webpack'));
    assert.doesNotMatch(text, /Pin `webpack@~5\.108`/);
    assert.match(text, /tilde-pin the webpack minor you verified at use/);
});

test('M122: the SQLite DROP COLUMN blockers match the documented list', () =>
{
    const line = skill('sqlite').split('\n').find((l) => l.includes('`DROP COLUMN` (3.35+'));
    assert.ok(line, 'the ALTER TABLE bullet is present');
    for (const blocker of ['partial index', 'trigger or view', 'generated-column expression', 'CHECK'])
        assert.ok(line.includes(blocker), `the DROP COLUMN blockers omit '${blocker}'`);
});

// A skill never points into a sibling skill's folder: the sibling may be absent, and a described
// cite still finds it where it is installed. The .NET router is an index of sibling paths by design,
// and the domain-trio protocol copies are a registered shared rule owned by the flow skills.
test('M123: no stack skill file names another skill\'s `references/` or `scripts/` in the backticked-name form', () =>
{
    const exempt = (dir, file) => dir === 'dotnet' || file === 'domain-trio-protocol.md';
    for (const dir of fs.readdirSync(SKILLS))
    {
        const files = [['SKILL.md', path.join(SKILLS, dir, 'SKILL.md')]];
        const refs = path.join(SKILLS, dir, 'references');
        if (fs.existsSync(refs)) for (const f of fs.readdirSync(refs)) if (f.endsWith('.md')) files.push([f, path.join(refs, f)]);
        for (const [name, file] of files)
        {
            if (!fs.existsSync(file) || exempt(dir, name)) continue;
            const text = squash(fs.readFileSync(file, 'utf8'));
            for (const m of text.matchAll(/`([a-z0-9-]+)`(?:'s| skill's)(?: own)? `(?:references|scripts)\//g))
                assert.strictEqual(m[1], dir, `${path.relative(ROOT, file)} names a path inside ${m[1]}/`);
        }
    }
});

test('M124: the Windows Service floors and the WinForms / WPF project-config clause are registered', () =>
{
    const rules = JSON.parse(read('meta/shared-rules.json')).rules;
    const floors = rules['windows-service-floors'];
    assert.ok(floors, 'windows-service-floors is registered');
    assert.strictEqual(floors.owner.file, 'stack/skills/dotnet-windows-service/SKILL.md');
    assert.deepStrictEqual(floors.sites.map((s) => s.file), ['stack/skills/dotnet-hosted-services/SKILL.md']);
    const outranks = rules['project-config-outranks-conventions'].sites.map((s) => s.file);
    for (const f of ['stack/skills/dotnet-winforms/SKILL.md', 'stack/skills/dotnet-wpf/SKILL.md'])
        assert.ok(outranks.includes(f), `${f} is not a project-config-outranks site`);
    const registry = { rules: { floors, outranks: rules['project-config-outranks-conventions'] } };
    assert.deepStrictEqual(lintSharedRules(registry, read), [], 'every registered copy carries its marker');
});

test('M125: the migrate, project-setup and ilspy stops are ask templates the lint can hold', () =>
{
    const pinned = { 'dotnet-migrate': 2, 'dotnet-project-setup': 1, 'ilspy-decompile': 1 };
    for (const [name, n] of Object.entries(pinned))
    {
        const text = skill(name);
        assert.strictEqual(askCount(text), n, `${name} carries ${askCount(text)} ask template(s), expected ${n}`);
        assert.deepStrictEqual(lintAskTemplates([{ file: `${name}/SKILL.md`, text }]), []);
    }
});

test('M126: ilspy pins the dnx run and leaves its download confirmation to the user', () =>
{
    const text = squash(skill('ilspy-decompile'));
    assert.doesNotMatch(skill('ilspy-decompile'), /^dnx ilspycmd -h/m);
    assert.match(text, /dnx ilspycmd@<version> --yes -- -h/);
    assert.match(text, /Tool package download needs confirmation/);
    assert.match(text, /`--yes` answers it for the user/);
});

test('M127: OpenAPI attribution, the testing When-to-use, and the Nx framing are corrected', () =>
{
    const minimal = squash(skill('dotnet-minimal-api'));
    assert.doesNotMatch(minimal, /pipeline-wide concerns - OpenAPI document generation,/);
    assert.match(minimal, /OpenAPI document generation and the docs UI to the OpenAPI skill/);
    const mvc = squash(skill('dotnet-mvc-controllers'));
    assert.doesNotMatch(mvc, /pipeline-wide concerns - validation library, OpenAPI document,/);
    assert.match(mvc, /the OpenAPI document and its docs UI to the OpenAPI skill/);
    assert.doesNotMatch(section(skill('dotnet-testing'), 'When to use'), /Do not rely on recall/);
    const nx = squash(skill('nx'));
    assert.doesNotMatch(nx, /over an Angular \(or mixed\) monorepo/);
    assert.match(nx, /task layer over a JavaScript \/ TypeScript monorepo/);
    assert.match(nx, /the plugin for the project's own framework/);
});

test('M128: typescript, ionic and dotnet-performance close on a quoted check; openapi does not assert .NET 11', () =>
{
    assert.match(squash(section(skill('typescript'), 'Prove it')), /`tsc --noEmit`.*quote/);
    const ionic = squash(section(skill('ionic'), 'Prove it'));
    assert.match(ionic, /`npx cap sync`/);
    assert.match(ionic, /UNVERIFIED/);
    assert.match(squash(section(skill('dotnet-performance'), 'Prove it')), /before and after/);
    assert.match(squash(section(skill('dotnet-performance'), 'Prove it')), /Allocated columns \(with `\[MemoryDiagnoser\]`\)/, 'the column the memory diagnoser adds');
    const openapi = squash(skill('dotnet-openapi'));
    assert.doesNotMatch(openapi, /3\.x on \.NET 11\)/);
    assert.match(openapi, /\.NET 11's major is fetched at use/);
});

// M128 part 3 (2.1.6, measured live - fix-216-ab-report.md): four of the convention layers the audit named (SC M13), each
// loaded by a path-scoped rule as its FIRST action, record their invocation choice as model-only. With `user-invocable: false` the model's skill listing
// was byte-identical and the layer loaded before the first edit 4 of 4 times, as without it; only the `/` entry went.
// `markdown-style` stays typeable: its description advertises a user action ('lint / style-check / fix this markdown'),
// and it rides every install (review-216-ab MINOR 3).
test('M128: the rule-forced convention layers are model-only, and no other skill is', () =>
{
    const flagged = fs.readdirSync(SKILLS).filter((d) => fs.existsSync(path.join(SKILLS, d, 'SKILL.md')))
        .filter((d) => /^user-invocable:\s*false\s*$/m.test((/^---\n([\s\S]*?)\n---/.exec(skill(d)) || [])[1] || '')).sort();
    const FORCED = ['dotnet-winforms', 'dotnet-wpf', 'javascript', 'typescript'];
    assert.doesNotMatch(skill('markdown-style'), /^user-invocable:/m, 'markdown-style keeps its / entry');
    assert.deepStrictEqual(flagged, FORCED);
    const pathRules = fs.readdirSync(path.join(ROOT, 'stack', 'rules')).map((f) => read(`stack/rules/${f}`)).filter((t) => /^---\n(?:(?!---\n)[^\n]*\n)*?paths:/.test(t));
    for (const name of FORCED)
    {
        assert.ok(pathRules.some((t) => new RegExp(`load \`${name}\`|\`${name}\` Skill call|load \`[a-z-]+\` and the \`${name}\``).test(squash(t))), `a path rule's first action loads ${name}`);
        assert.doesNotMatch(skill(name), /^disable-model-invocation:/m, `${name} stays model-invocable`);
    }
});
