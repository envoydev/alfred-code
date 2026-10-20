// Content assertions for the 2.1.4 audit's stack-skill findings (merged.md C2-C4, I30, I36-I44).
// Each case pins one wrong claim absent and the verified claim present, so a later edit that
// restores the old teaching goes red here instead of shipping to every .NET, npm or docs seat.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const squash = (s) => s.replace(/\s+/g, ' ');
const SKILLS = path.join(ROOT, 'stack', 'skills');

function skillFiles(filter)
{
    const out = [];
    const walk = (dir) =>
    {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }))
        {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (filter(e.name)) out.push(p);
        }
    };
    walk(SKILLS);
    return out;
}

// The text of one `## Heading` section, up to the next heading of the same or higher level.
function section(text, heading)
{
    const lines = text.split('\n');
    const start = lines.findIndex((l) => l.replace(/^#+\s*/, '') === heading && /^#+ /.test(l));
    assert.ok(start >= 0, `section '${heading}' not found`);
    const level = /^#+/.exec(lines[start])[0].length;
    let end = lines.findIndex((l, i) => i > start && /^#+ /.test(l) && /^#+/.exec(l)[0].length <= level);
    if (end < 0) end = lines.length;
    return lines.slice(start, end).join('\n');
}

const shared = () => JSON.parse(read('meta/shared-rules.json')).rules;
function assertPinned(files, owner)
{
    const rules = shared();
    const hit = Object.entries(rules).find(([, r]) =>
        r.owner && r.owner.file === owner && files.every((f) => f === owner || (r.sites || []).some((s) => s.file === f)));
    assert.ok(hit, `no shared-rules entry owned by ${owner} pins ${files.join(', ')}`);
    return hit[0];
}

// C2 - no SDK rule orders class members; a clean build proves nothing about the order.
test('C2: no shipped skill credits .editorconfig with a rule that has no analyzer id', () =>
{
    for (const file of skillFiles((n) => n.endsWith('.md')))
    {
        read(path.relative(ROOT, file)).split('\n').forEach((line, i) =>
        {
            if (!/Enforced by `?\.editorconfig/i.test(line)) return;
            assert.match(line, /\b(IDE|CA|SA)\d{4}\b/, `${path.relative(ROOT, file)}:${i + 1} says 'Enforced by .editorconfig' with no IDE/CA/SA rule id`);
        });
    }
});

test('C2: csharp member ordering is a review rule, and the build is not its proof', () =>
{
    const text = read('stack/skills/csharp/SKILL.md');
    const ordering = squash(section(text, 'Class member ordering'));
    assert.doesNotMatch(ordering, /Enforced by/);
    assert.match(ordering, /No SDK analyzer or `\.editorconfig` rule enforces/);
    assert.match(ordering, /SA1201/, 'names that StyleCop orders differently, so the pack is no stand-in');
    const prove = squash(section(text, 'Prove it'));
    assert.match(prove, /analyzer-backed rules held/);
    assert.match(prove, /member ordering and the file, method and parameter caps .* diff/);
});

// C3 - CS8019 is a hidden diagnostic: WarningsAsErrors cannot promote it.
test('C3: the hygiene wave promotes IDE0005 with its three prerequisites, never CS8019', () =>
{
    // 2026-10-08 audit: the waves moved to a reference the body section cites (a verifier preloads the body).
    const body = section(read('stack/skills/dotnet-code-quality/SKILL.md'), 'Legacy backlog: promote in batches, never all at once');
    assert.ok(body.includes('`references/legacy-backlog.md`'), 'the body section cites the waves reference');
    const wave = squash(read('stack/skills/dotnet-code-quality/references/legacy-backlog.md'));
    assert.doesNotMatch(wave, /Add `CS8019/);
    assert.match(wave, /Add `IDE0005;CS0219;CS0168` to `WarningsAsErrors`/);
    for (const prereq of ['`EnforceCodeStyleInBuild=true`', '`GenerateDocumentationFile=true`', '`dotnet_diagnostic.IDE0005.severity = warning`'])
        assert.ok(wave.includes(prereq), `missing prerequisite ${prereq}`);
    assert.match(wave, /`CS8019`, a hidden diagnostic/);
    assert.match(wave, /`GenerateDocumentationFile` is also what makes `CS1591` fire/);
});

// C4 - `dotnet list package --vulnerable` exits 0 on a finding; the gate is restore-time NuGet Audit.
test('C4: the vulnerable-package gate is NuGet Audit, the listing only a report', () =>
{
    const sites = [
        'stack/skills/dotnet-security/SKILL.md',
        'stack/skills/dotnet-security/references/owasp-a06-a10.md',
        'stack/skills/dotnet-web-backend/SKILL.md',
        'stack/skills/dotnet-project-setup/references/central-package-management.md',
    ];
    for (const rel of sites)
    {
        const text = squash(read(rel));
        assert.doesNotMatch(text, /--vulnerable[^.]*fails the build/, `${rel} still says the listing fails the build`);
        assert.match(text, /exits 0 on a finding/, `${rel} does not say the listing exits 0`);
        assert.match(text, /NU1903;NU1904/, `${rel} does not name the audit codes raised to errors`);
    }
    for (const rel of sites.slice(0, 2))
        assert.match(squash(read(rel)), /`NuGetAuditMode` `all` below net10\.0/, `${rel} does not set the transitive audit mode for pre-net10 targets`);
    assertPinned(sites, 'stack/skills/dotnet-security/SKILL.md');
});

// I30 - a bare `scripts/...` path resolves against the session cwd, not the skill.
test('I30: no SKILL.md runs a bundled script by a cwd-relative path', () =>
{
    for (const file of skillFiles((n) => n === 'SKILL.md'))
    {
        const text = fs.readFileSync(file, 'utf8');
        assert.doesNotMatch(text, /node\s+["'`]?scripts\//, `${path.relative(ROOT, file)} runs node scripts/... - resolve it through \${CLAUDE_SKILL_DIR} or the project copy`);
    }
    const devlog = read('stack/skills/dev-log-convert/SKILL.md');
    assert.ok(devlog.includes('${CLAUDE_SKILL_DIR}/scripts/total-time.js'));
    assert.ok(devlog.includes('.claude/skills/dev-log-convert/scripts/total-time.js'), 'the platform-neutral fallback is the project copy');
});

// I36 - Aspire ships `aspire publish` / `aspire deploy`; the house stance is a policy, not a product limit.
test('I36: Aspire deploy stance is stated as house policy in both skills', () =>
{
    const aspire = squash(read('stack/skills/dotnet-aspire/SKILL.md'));
    const devops = squash(read('stack/skills/devops/SKILL.md'));
    assert.doesNotMatch(aspire, /never a deployment system/);
    assert.doesNotMatch(devops, /composition root for the local run and the deployment manifest/);
    for (const text of [aspire, devops])
    {
        assert.match(text, /`aspire publish` and `aspire deploy` exist/);
        assert.match(text, /adopting them is a deliberate pipeline decision, never a default/);
    }
    assertPinned(['stack/skills/devops/SKILL.md', 'stack/skills/dotnet-aspire/SKILL.md'], 'stack/skills/devops/SKILL.md');
});

// I37 - a Capacitor 8 default iOS project is SPM: no CocoaPods workspace to archive.
test('I37: the Fastfile archives the Xcode project, naming the CocoaPods variant', () =>
{
    const text = read('stack/skills/capacitor-release/SKILL.md');
    assert.match(text, /^\s*build_app\(project: 'ios\/App\/App\.xcodeproj', scheme: 'App'\)/m);
    for (const line of text.split('\n').filter((l) => /build_app\(workspace:/.test(l)))
        assert.match(line, /^\s*#.*CocoaPods/, `a live workspace archive line remains: ${line.trim()}`);
    assert.match(text, /`xcodebuild -project ios\/App\/App\.xcodeproj -scheme App/);
});

// I38 - under JWT bearer's default claim mapping `sub` becomes NameIdentifier, so FindFirst("sub") is null.
test('I38: the group join reads Context.UserIdentifier', () =>
{
    const text = read('stack/skills/dotnet-realtime/SKILL.md');
    assert.doesNotMatch(text, /FindFirst\("sub"\)\?\.Value;/);
    assert.match(text, /var customerId = Context\.UserIdentifier;/);
});

// I39 - one house answer: 404 for a resource the caller may not see, 403 only when it can see it.
test('I39: IDOR status is 404 without existence disclosure, pinned in three skills', () =>
{
    const security = read('stack/skills/dotnet-security/SKILL.md');
    assert.doesNotMatch(security, /Results\.Forbid\(\)/);
    assert.match(security, /if \(order is null\)\s*\{\s*return TypedResults\.NotFound\(\);/);
    const rule = 'a resource the caller may not see returns 404, never 403 - no existence disclosure; 403 only where the caller can see the resource but not the action';
    const files = ['stack/skills/dotnet-security/SKILL.md', 'stack/skills/dotnet-testing/SKILL.md', 'stack/skills/dotnet-web-error-handling/SKILL.md'];
    for (const rel of files) assert.ok(squash(read(rel)).includes(rule), `${rel} lacks the IDOR status rule`);
    assertPinned(files, 'stack/skills/dotnet-security/SKILL.md');
});

// I40 - `[TOC]` renders on Gitiles and GitLab; GitHub prints it as literal text.
test('I40: every [TOC] in markdown-style carries the renderer condition', () =>
{
    const dir = 'stack/skills/markdown-style';
    for (const rel of [`${dir}/SKILL.md`, `${dir}/references/style-overlay.md`, `${dir}/references/syntax-canon.md`])
    {
        read(rel).split('\n').forEach((line, i) =>
        {
            if (!line.includes('[TOC]')) return;
            assert.match(line, /where the renderer supports it|literal text/, `${rel}:${i + 1} teaches [TOC] with no renderer condition`);
        });
    }
    assert.match(squash(read(`${dir}/SKILL.md`)), /`## Contents` list of anchor links/);
});

// I41 - the docs root and generated rules belong to the skill that writes them.
test('I41: markdown-style skips the docs root and the generated rules, pinned to the rule', () =>
{
    const marker = 'The generated docs root is NOT governed here, and neither are the generated rules.';
    assert.ok(squash(read('stack/skills/markdown-style/SKILL.md')).includes(marker));
    assertPinned(['stack/rules/markdown-docs.md', 'stack/skills/markdown-style/SKILL.md'], 'stack/rules/markdown-docs.md');
});

// I42 - ignore-scripts=true silently skips every dependency's install script, and a bare
// `npm rebuild` under it runs nothing (measured on npm 11.6.1).
test('I42: the npm baseline lists install-script dependencies and rebuilds the vetted ones', () =>
{
    const text = squash(section(read('stack/skills/npm/SKILL.md'), 'Non-negotiables (any repo that has a package.json)'));
    assert.match(text, /"hasInstallScript": true/);
    assert.match(text, /npm rebuild <name> --ignore-scripts=false/);
    assert.match(text, /build and test/);
    assert.match(text, /propose it through ONE AskUserQuestion.*merged into an existing `\.npmrc`, never an overwrite/);
});

// I43 - PgBouncer 1.21+ tracks protocol-level prepared statements in transaction mode.
test('I43: prepared statements behind a transaction pooler follow the pooler, not a blanket rule', () =>
{
    const pg = squash(section(read('stack/skills/postgres/SKILL.md'), 'Connections and pooling'));
    assert.doesNotMatch(pg, /Session mode is required only for features bound to one backend: server-side prepared statements/);
    assert.doesNotMatch(pg, /Behind a transaction pooler, disable driver-side prepared statements/);
    assert.match(pg, /`max_prepared_statements`/);
    assert.match(pg, /`SHOW CONFIG`/);
    assert.match(pg, /`Max Auto Prepare` at its default 0/);
    for (const rel of ['stack/skills/database-conventions/references/transactions-and-connections.md', 'stack/skills/dotnet-data-access/references/efcore.md'])
    {
        const text = squash(read(rel));
        assert.doesNotMatch(text, /Server-side prepared statements break behind a transaction-mode pooler/);
        assert.doesNotMatch(text, /Behind a Postgres transaction pooler, disable driver prepared statements/);
        assert.match(text, /`max_prepared_statements`/, `${rel} does not name the pooler setting`);
    }
});

// I44 - the config-protection guard blocks the Nullable edit the setup skill prescribes.
test('I44: dotnet-project-setup names the config-protection gate, pinned with typescript', () =>
{
    const text = squash(read('stack/skills/dotnet-project-setup/SKILL.md'));
    assert.match(text, /Where the house config-protection guard runs, it blocks a change that loosens `Nullable`/);
    // audit 2026-10-14 SKD-04: a pure MSBuild tightening passes the guard since audit 2026-10-11 SD16, so neither .NET
    // skill says a tightening is blocked for an MSBuild key; the .editorconfig half (whole-file) still is
    assert.match(text, /a pure tightening \(`Nullable` toward `enable`/);
    const quality = squash(read('stack/skills/dotnet-code-quality/SKILL.md'));
    assert.match(quality, /it blocks a change that loosens `WarningsAsErrors`/);
    assert.match(quality, /any edit to an existing `\.editorconfig` - a tightening included -/);
    assert.match(text, /never route around the block/);
    assertPinned(['stack/skills/typescript/SKILL.md', 'stack/skills/dotnet-project-setup/SKILL.md', 'stack/skills/dotnet-code-quality/SKILL.md'], 'stack/skills/typescript/SKILL.md');
});

// audit 2026-10-14 SKS01 - npm 12 blocks dependency install scripts behind the root `allowScripts` policy
// (v12.0.0 release notes; docs.npmjs.com/cli/v12/commands/npm-install-scripts), and `ignore-scripts=true`
// overrides it (measured on npm 12.2.0); the npm 11 steps stay verbatim so I42 and M120 still hold.
test('SKS01: the npm baseline branches on npm -v, npm 12 approving through allowScripts', () =>
{
    const text = squash(section(read('stack/skills/npm/SKILL.md'), 'Non-negotiables (any repo that has a package.json)'));
    assert.match(text, /Read `npm -v` first/);
    assert.match(text, /\*\*npm >= 12\*\*/);
    assert.match(text, /\*\*npm 11\.10 - 11\.x\*\*/);
    assert.match(text, /`npm install-scripts approve <name> \.\.\.`/);
    assert.match(text, /pinned `pkg@version` entries into `allowScripts`/);
    assert.match(text, /`npm install-scripts ls`/);
    assert.match(text, /No `ignore-scripts=true` here: it overrides `allowScripts`/);
    const npm12 = text.slice(text.indexOf('**npm >= 12**'), text.indexOf('**npm 11.10 - 11.x**'));
    assert.doesNotMatch(npm12, /```ini ignore-scripts=true/, 'the npm 12 .npmrc must not carry ignore-scripts');
});

// audit 2026-10-14 SKD-01 + SKS08 - .NET 8 and .NET 9 leave support on 2026-11-10, .NET 10 LTS runs to 2028-11-14
// (dotnet.microsoft.com support policy): the family floors at .NET 10 / C# 14, and a .NET 8 mention of the old
// floor survives only on a line that marks it below the floor.
test('SKD-01: the .NET family floors at .NET 10 / C# 14, the old floor only in below-the-floor lines', () =>
{
    const family = skillFiles((n) => n.endsWith('.md')).filter((p) => /[\\/](csharp|csharp-design-patterns|dotnet[^\\/]*|ilspy-decompile)[\\/]/.test(p));
    assert.ok(family.length > 50, `found only ${family.length} .NET family files`);
    for (const p of family)
    {
        for (const line of fs.readFileSync(p, 'utf8').split('\n'))
        {
            if (!/\.NET 8 \/ C# 12|\.NET 8 floor|net8\.0/.test(line)) continue;
            assert.match(line, /below the floor|below it/i, `${path.relative(ROOT, p)} still states the old floor: ${line.trim().slice(0, 120)}`);
        }
    }
    assert.match(read('stack/skills/csharp/SKILL.md'), /\*\*Floor: \.NET 10 \/ C# 14\.\*\* \.NET 8 \/ 9 are past support from 2026-11-10 - deltas below the floor are marked\./);
    const setup = read('stack/skills/dotnet-project-setup/SKILL.md');
    assert.match(setup, /<NetLibVersion>net10\.0<\/NetLibVersion>/);
    assert.match(setup, /"version": "10\.0\.100",\s*"rollForward": "latestFeature"/);
    const devops = read('stack/skills/devops/SKILL.md');
    assert.match(devops, /FROM mcr\.microsoft\.com\/dotnet\/sdk:10\.0@sha256:[0-9a-f]{64} AS build/);
    assert.match(devops, /FROM mcr\.microsoft\.com\/dotnet\/aspnet:10\.0-noble-chiseled@sha256:[0-9a-f]{64}/);
    assert.doesNotMatch(devops, /@sha256:<digest>/);
});

// audit 2026-10-14 SKD-16 - NetArchTest.Rules is dormant since 1.3.2 (2021-05-23); NetArchTest.eNhancedEdition
// 1.4.5 (2025-06-04) keeps the `NetArchTest.Rules` namespace and the `Types.InAssembly(...)` chain but exposes
// `FailingTypes`, not `FailingTypeNames` (its README and sources/NetArchTest/TestResult.cs).
test('SKD-16: architecture tests default to the maintained NetArchTest fork and assert with the runner', () =>
{
    const text = squash(section(read('stack/skills/dotnet-architecture-tests/SKILL.md'), 'Pick the library: NetArchTest.eNhancedEdition by default'));
    assert.match(text, /Default to \*\*NetArchTest\.eNhancedEdition\*\*/);
    assert.doesNotMatch(text, /Default to \*\*NetArchTest\.Rules\*\*/);
    assert.match(text, /Types\.InAssembly\(typeof\(Order\)\.Assembly\)/);
    assert.match(text, /Assert\.True\(result\.IsSuccessful,/);
    assert.match(text, /result\.FailingTypes\.Select\(t => t\.FullName\)/);
    assert.doesNotMatch(text, /\.Should\(\)\.BeTrue|FailingTypeNames\)/);
});

// audit 2026-10-14 SKD-14 - OWASP's 2025 list reuses A01-A10 for other categories (A06:2025 is Insecure Design),
// so a finding keeps the 2021 sections and names its edition.
test('SKD-14: dotnet-security findings label the OWASP edition', () =>
{
    const review = squash(section(read('stack/skills/dotnet-security/SKILL.md'), 'Review output'));
    assert.match(review, /the category naming the A0x above with its edition - `A06:2021`/);
    assert.match(review, /when no installed skill matches, keep the finding in this report tagged with its surface/);
    assert.match(squash(read('stack/skills/dotnet-security/references/desktop-and-service-apps.md')), /the category labelled with its edition \(`A08:2021`\)/);
});

// audit 2026-10-14 SKS11 - Capacitor 6 left support 2026-01-20 and Ionic 7 2025-04-17; Ionic 9 supports Capacitor 7+
// (capacitorjs.com support policy; ionicframework.com/docs/reference/support).
test('SKS11: the mobile floors are Capacitor 7 / Ionic 8, a v6 project upgrading first', () =>
{
    const versions = squash(read('stack/skills/ionic/references/versions.md'));
    assert.match(versions, /Floor: Ionic 8/);
    assert.match(versions, /Floor: Capacitor 7/);
    assert.match(versions, /A v6 project: upgrade first, `npx cap migrate`/);
    assert.match(read('stack/skills/capacitor-release/SKILL.md'), /Floored at Capacitor 7, current on 8/);
    assert.match(read('stack/skills/ionic-security/SKILL.md'), /Targets Capacitor 7\+\./);
    for (const rel of ['stack/skills/capacitor-release/SKILL.md', 'stack/skills/ionic/references/versions.md', 'stack/skills/ionic-security/SKILL.md'])
        assert.doesNotMatch(read(rel), /Capacitor 6\+|Floor(ed)?:? (at )?Capacitor 6|Floor: Ionic 7/, rel);
});
