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

const conceptOf = (payload) => { const r = forge.classify(payload); return r ? r.concept : null; };

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
