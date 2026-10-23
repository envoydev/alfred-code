'use strict';
// forge.js reads any tool call as a forge CONCEPT by its words - a CLI's argv, an API path, an MCP tool's name and
// operation selectors - so no list of CLIs or servers is the gate's boundary. The corpus rows are the verified routes of
// GitHub, GitLab, Azure DevOps, Gitea and Bitbucket; the benign rows pin the false positives a publish gate must not make
// (a quoted `gh pr merge` once cost 430,740 tokens of denied report writes).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const forge = require('../stack/hooks/forge.js');
const corpus = require('./fixtures/forge-corpus.js');
const { sh, mcp } = corpus;
// A server the MCP configs launch as a forge server is shaped by them: an empty account, and a project whose .mcp.json
// launches one GitLab server keyed `lab` - so the machine's own configs never decide a case (forge.js reads them once).
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-classify-acct-'));
process.env.CLAUDE_PROJECT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-classify-proj-'));
fs.writeFileSync(path.join(process.env.CLAUDE_PROJECT_DIR, '.mcp.json'), JSON.stringify({ mcpServers: { lab: { command: 'npx', args: ['-y', '@zereight/mcp-gitlab'] } } }));
test.after(() => { for (const k of ['CLAUDE_CONFIG_DIR', 'CLAUDE_PROJECT_DIR']) fs.rmSync(process.env[k], { recursive: true, force: true }); });

const conceptOf = (payload, opts) => { const r = forge.classify(payload, opts); return r ? r.concept : null; };

for (const family of ['GITHUB', 'GITLAB', 'AZURE', 'GITEA_BITBUCKET', 'BENIGN']) {
  test(`corpus rows classify - ${family}`, () => {
    const wrong = [];
    for (const r of corpus[family]) {
      const got = forge.classify(r.payload);
      const concept = got ? got.concept : null;
      const strength = got ? got.strength : 'known';
      if (concept !== r.concept || strength !== r.strength) wrong.push(`${r.name}: want ${r.concept}/${r.strength}, got ${concept}/${strength} (${got && got.why})`);
    }
    assert.deepStrictEqual(wrong, []);
  });
}

test('benign corpus never reads as a publish', () => {
  for (const r of corpus.BENIGN) assert.ok(!forge.PUBLISH.has(conceptOf(r.payload)), r.name);
});

test('arbitrary server key - the words decide, not the name', () => {
  assert.strictEqual(conceptOf(mcp('work', 'accept_merge_request', { sha: 'abc1234' })), 'change.merge');
  assert.strictEqual(conceptOf(mcp('ado', 'repo_pull_request_write', { action: 'update', autoComplete: true })), 'change.merge');
  assert.strictEqual(conceptOf({ tool_name: 'mcp__plugin_acme_forge__merge_pull_request', tool_input: {} }), 'change.merge'); // mcp-fixture
  assert.strictEqual(conceptOf({ tool_name: 'mcp__claude_ai_GitHub__merge_pull_request', tool_input: {} }), 'change.merge');
});

test('unknown verb on a forge noun asks', () => {
  const r = forge.classify(mcp('x', 'pull_request_frobnicate', {}));
  assert.strictEqual(r.strength, 'unknown');
  assert.match(r.why, /frobnicate|no known verb/);
  assert.strictEqual(forge.classify(sh('gh pr frobnicate 3')).strength, 'unknown');
});

test('no forge noun is not a forge call', () => {
  assert.strictEqual(forge.classify(mcp('x', 'do_op', { x: 3 })), null);
  assert.strictEqual(forge.classify({ tool_name: 'Read', tool_input: { file_path: '/a' } }), null);
});

test('the stack\'s own servers are never classified', () => {
  assert.strictEqual(forge.classify({ tool_name: 'mcp__plugin_alfred-navigation_alfred-navigation__find_symbol', tool_input: {} }), null);
  assert.strictEqual(forge.classify({ tool_name: 'mcp__alfred-memory__create_pull_request', tool_input: {} }), null); // mcp-fixture
  assert.ok(forge.isStackServer('mcp__alfred-documentation__get')); // mcp-fixture
  assert.ok(!forge.isStackServer('mcp__github__merge_pull_request'));
});

test('api inference - body flags mean a write, GraphQL mutations are tokenised', () => {
  assert.strictEqual(conceptOf(sh('gh api repos/o/r/pulls/3/merge -f merge_method=squash')), 'change.merge');
  assert.strictEqual(conceptOf(sh('curl -X PUT https://h/api/v4/projects/1/merge_requests/2/merge')), 'change.merge');
  assert.strictEqual(conceptOf(sh(`curl -d '{"query":"mutation { mergePullRequest(input:{}) { x } }"}' https://api.github.com/graphql`)), 'change.merge');
  assert.strictEqual(conceptOf(sh(`node -e "fetch('https://api.github.com/repos/o/r/pulls/3/merge', { method: 'PUT' })"`)), 'change.merge');
  const inline = forge.classify(sh(`python3 -c "import requests; requests.request(m, 'https://h/api/v4/projects/1/merge_requests/2/merge')"`));
  assert.strictEqual(inline.strength, 'unknown');
  const opened = forge.classify(sh(`python3 -c "import urllib.request as u; u.urlopen(u.Request('https://h/api/v4/projects/1/merge_requests/2/merge', data=b'x'))"`));
  assert.strictEqual(opened.strength, 'unknown');
});

test('inline code names a URL without a request call - text, not a call', () => {
  assert.strictEqual(forge.classify(sh(`node -e "const u='https://api.github.com/repos/o/r/pulls/3/merge'; console.log(u)"`)), null);
  // the lexicon's requestCalls words are the request signal: a client nobody listed is added in the overlay
  const lexicon = forge.loadLexicon(os.tmpdir());
  const own = { ...lexicon, requestCalls: [...(lexicon.requestCalls || []), 'myhttp.send('] };
  const r = forge.classify(sh(`node -e "myhttp.send('https://api.github.com/repos/o/r/pulls/3/merge')"`), { lexicon: own });
  assert.strictEqual(r && r.strength, 'unknown');
});

test('powershell forms classify like bash', () => {
  assert.strictEqual(conceptOf({ tool_name: 'PowerShell', tool_input: { command: 'gh pr merge 3; if ($?) { echo ok }' } }), 'change.merge');
  assert.strictEqual(conceptOf({ tool_name: 'PowerShell', tool_input: { command: 'Invoke-RestMethod -Method Put -Uri https://api.github.com/repos/o/r/pulls/3/merge' } }), 'change.merge');
});

test('wrappers and carried scripts are read', () => {
  assert.strictEqual(conceptOf(sh('bash -c "glab mr merge 2"')), 'change.merge');
  assert.strictEqual(conceptOf(sh('FOO=1 sudo az repos pr update --id 3 --status completed')), 'change.merge');
  assert.strictEqual(conceptOf(sh("eval 'tea pr merge 5'")), 'change.merge');
});

test('aliases - an az git alias reads as its words, an opaque gh alias asks', () => {
  assert.strictEqual(conceptOf(sh('git pr create --title x')), 'change.create');
  assert.strictEqual(forge.classify(sh('gh pr co 3')).concept, 'read');
});

test('change number, ref and head are read from the call', () => {
  const a = forge.classify(sh('gh pr merge 12 --squash'));
  assert.strictEqual(a.change, '12');
  const b = forge.classify(mcp('github', 'push_files', { branch: 'main', files: [] }));
  assert.strictEqual(b.ref, 'main');
  const c = forge.classify(mcp('gitlab', 'accept_merge_request', { merge_request_iid: 4, sha: 'abc1234' }));
  assert.strictEqual(c.change, '4');
  assert.strictEqual(c.head, 'abc1234');
  const d = forge.classify(sh('az repos pr update --id 3 --status completed'));
  assert.strictEqual(d.change, '3');
});

test('the shell result carries where the act sits in the command', () => {
  const cmd = 'cd x && gh pr merge 12';
  const r = forge.classify(sh(cmd));
  assert.strictEqual(cmd.slice(r.at, r.end), 'gh pr merge 12');
});

test('malformed overlay falls back to the base lexicon with a notice', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-lex-'));
  fs.mkdirSync(path.join(root, '.alfred'), { recursive: true });
  fs.writeFileSync(path.join(root, '.alfred', 'forge-lexicon.json'), '{ not json');
  const lex = forge.loadLexicon(root, {});
  assert.ok(Array.isArray(lex.nouns.change) && lex.nouns.change.includes('pull_request'));
  assert.match(String(lex.notice || ''), /forge-lexicon\.json/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('an overlay adds words', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-lex-'));
  fs.mkdirSync(path.join(root, '.alfred'), { recursive: true });
  fs.writeFileSync(path.join(root, '.alfred', 'forge-lexicon.json'), JSON.stringify({ verbs: { merge: ['landit'] } }));
  const lexicon = forge.loadLexicon(root, {});
  assert.strictEqual(forge.classify(mcp('x', 'landit_pull_request', {}), { lexicon }).concept, 'change.merge');
  fs.rmSync(root, { recursive: true, force: true });
});

test('a branch, tag, file or release on a server that is no forge is not a forge call', () => {
  for (const [server, tool, input] of [
    ['supabase', 'create_branch', { project_id: 'abcd', name: 'dev' }],
    ['neon', 'create_branch', { projectId: 'p-1' }],
    ['supabase', 'merge_branch', { branch_id: 'b1' }],
    ['sentry', 'create_release', { organization_slug: 'o', version: '1' }],
    ['aws', 'tag_resource', { resourceArn: 'arn:x', tags: {} }],
    ['redis', 'release_lock', { key: 'k' }],
    ['fs', 'write_file', { path: 'a', content: 'b' }],
    ['git', 'git_commit', { repo_path: '/work/r', message: 'x' }],
    ['git', 'git_create_branch', { repo_path: '/work/r', branch_name: 'x' }],
  ]) assert.strictEqual(forge.classify(mcp(server, tool, input)), null, `${server} ${tool}`);
});

test('a forge-shaped server keeps its branch, tag and release words', () => {
  assert.strictEqual(conceptOf(mcp('github', 'create_branch', { owner: 'o', repo: 'r', branch: 'b' })), 'branch.write');
  assert.strictEqual(conceptOf(mcp('work', 'create_branch', { owner: 'o', repo: 'r', branch: 'b' })), 'branch.write', 'repo coordinates');
  assert.strictEqual(conceptOf(mcp('work', 'create_release', { project_id: 'g/r', tag_name: 'v1' })), 'release.write', 'a project path');
  assert.strictEqual(conceptOf(mcp('work', 'repo_create_branch', { repositoryId: 'x', branchName: 'b' })), 'branch.write');
  assert.strictEqual(conceptOf({ ...mcp('My Odd.Server-1', 'create_branch', { name: 'b' }), mcp_server: { name: 'My Odd.Server-1', source: 'project' } }, { forgeServers: ['My Odd.Server-1'] }), 'branch.write', 'a server found by its launch command');
  assert.strictEqual(conceptOf(mcp('lab', 'create_branch', { project_id: 123, branch: 'b' })), 'branch.write', 'the project\'s .mcp.json launches it as a forge server');
  assert.strictEqual(conceptOf(mcp('other', 'create_branch', { project_id: 123, branch: 'b' })), null, 'a server nothing launches as a forge server');
  assert.strictEqual(conceptOf(mcp('git', 'git_push', { repo_path: '/work/r' })), 'branch.write', 'a push publishes on any server');
  assert.strictEqual(conceptOf(mcp('anything', 'merge_pull_request', {})), 'change.merge', 'change words are every server\'s');
});

test('an auto-merge is armed: it lands later', () => {
  const armed = (p) => { const r = forge.classify(p); return r && r.concept === 'change.merge' ? !!r.armed : null; };
  assert.strictEqual(armed(sh('gh pr merge 3 --auto --squash')), true);
  assert.strictEqual(armed(sh('glab mr merge 4 --auto-merge')), true);
  assert.strictEqual(armed(sh('az repos pr update --id 3 --auto-complete true')), true);
  assert.strictEqual(armed(mcp('github', 'enable_pull_request_auto_merge', { pullNumber: 3 })), true);
  assert.strictEqual(armed(mcp('gitlab', 'merge_merge_request', { merge_request_iid: 4, merge_when_pipeline_succeeds: true })), true);
  assert.strictEqual(armed(mcp('ado', 'repo_pull_request_write', { action: 'update', pullRequestId: 3, autoComplete: true })), true);
  assert.strictEqual(armed(sh('gh pr merge 3 --squash')), false);
  assert.strictEqual(armed(mcp('gitlab', 'merge_merge_request', { merge_request_iid: 4 })), false);
});

test('a release is read by its tag, not the commit it targets', () => {
  assert.strictEqual(forge.classify(sh('gh release create v2 --target main --notes x')).ref, 'v2');
  assert.strictEqual(forge.classify(sh('glab release create v1.0 --ref main')).ref, 'v1.0');
  assert.strictEqual(forge.classify(sh('tea releases create --tag v4 --target main')).ref, 'v4');
  assert.strictEqual(forge.classify(mcp('gitlab', 'create_release', { tag_name: 'v1', ref: 'main' })).ref, 'v1');
});

test('every subcommand of the four forge CLIs reads as a concept - none asks, only merges and ref writes publish', () => {
  const subs = require('./fixtures/forge-subcommands.js');
  const unknown = [], publish = [];
  for (const [cli, rows] of Object.entries(subs)) {
    for (const row of rows) {
      const r = forge.classify(sh(`${cli} ${row} 1`));
      if (r && r.strength === 'unknown') unknown.push(`${cli} ${row}: ${r.why}`);
      else if (r && forge.PUBLISH.has(r.concept)) publish.push(`${cli} ${row}`);
    }
  }
  assert.deepStrictEqual(unknown, []);
  assert.deepStrictEqual(publish.sort(), ['az repos ref create', 'az repos ref delete', 'gh pr merge', 'glab mr merge', 'tea pulls m', 'tea pulls merge']);
});

test('a short alias reads by the object it follows; a sub-group word before a verb is part of the object', () => {
  assert.strictEqual(conceptOf(sh('tea pulls m 3')), 'change.merge');
  assert.strictEqual(conceptOf(sh('tea pulls c --title x')), 'change.create');
  assert.strictEqual(conceptOf(sh('tea releases c --tag v1')), 'release.write');
  assert.strictEqual(conceptOf(sh('tea releases assets create v1 a.zip')), 'release.write');
  assert.strictEqual(conceptOf(sh('glab mr note create 3 -m x')), 'change.annotate');
  assert.strictEqual(conceptOf(sh('glab mr note -m "needs X" 3')), 'change.annotate');
  assert.strictEqual(conceptOf(sh('az repos pr reviewer add --id 3 --reviewers a')), 'change.annotate');
  assert.strictEqual(conceptOf(sh('az repos pr work-item list --id 3')), 'read');
  assert.strictEqual(conceptOf(sh('az repos policy approver-count create --blocking true')), 'pipeline.write');
  assert.strictEqual(conceptOf(mcp('github', 'search_for_pull_requests', { q: 'x' })), 'read', 'a shell alias never reaches a tool name');
  assert.strictEqual(conceptOf(mcp('gitlab', 'wait_for_pipeline', { pipeline_id: 7 })), 'pipeline.watch');
});

test('a skipped sub-group word never reaches a publish verb - a script runner\'s arguments are not a push', () => {
  assert.strictEqual(conceptOf(sh('yarn run build git push')), null);
  assert.strictEqual(conceptOf(sh('npm run ci git merge')), null);
  assert.strictEqual(conceptOf(sh('gh pr frobnicate merge 3')), 'change.merge', 'an unknown verb on a change request still asks');
  assert.strictEqual(forge.classify(sh('gh pr frobnicate merge 3')).strength, 'unknown');
});
