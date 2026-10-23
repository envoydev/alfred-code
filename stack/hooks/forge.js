'use strict';
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
//
// THE FORGE CLASSIFIER - a library, not a hook (like shell-writes.js). Any tool call is read as a forge CONCEPT by its
// WORDS: a CLI's argv (noun then verb, as `gh pr merge`, `glab mr merge`, `az repos pr update` and a CLI nobody listed all
// spell it), an API call's method and path (`curl`, `<cli> api`, `az devops invoke`, Invoke-RestMethod, inline
// interpreter code), and an MCP tool's name plus its operation selectors (`method`, `action`, a `true` flag such as
// `autoComplete`). The vocabulary is data (forge-lexicon.json, overlaid by <data root>/forge-lexicon.json); no list of
// CLIs or MCP servers is the boundary. Three outcomes: a forge noun with a known verb is that concept; a forge noun with
// no known verb is `unknown` (the gates ask); no forge noun is null - not a forge call, left alone.
// The verified routes it is tested against: scripts/fixtures/forge-corpus.js (docs/forge-routes-evidence.md).
const fs = require('node:fs');
const path = require('node:path');

const CONCEPTS = Object.freeze({
  MERGE: 'change.merge', BRANCH: 'branch.write', CREATE: 'change.create', RELEASE: 'release.write',
  ANNOTATE: 'change.annotate', PIPELINE: 'pipeline.write', WATCH: 'pipeline.watch', READ: 'read',
});
const { MERGE, BRANCH, CREATE, RELEASE, ANNOTATE, PIPELINE, WATCH, READ } = CONCEPTS;
const PUBLISH = new Set([MERGE, BRANCH]);
const PREF_HOLD = new Set([MERGE, BRANCH, CREATE, RELEASE]);
// Which result wins when one command carries several: a publish, then an unknown (it may be one), then the rest.
const RANK = { [MERGE]: 7, [BRANCH]: 7, [CREATE]: 5, [RELEASE]: 5, [PIPELINE]: 3, [ANNOTATE]: 3, [WATCH]: 2, [READ]: 1 };
const rankOf = (r) => (!r ? 0 : r.strength === 'unknown' ? 6 : RANK[r.concept] || 0);
// Verb classes, strongest first: a tool or a command naming two verbs is read by the stronger.
const VERB_ORDER = ['merge', 'push', 'create', 'write', 'pipeline', 'annotate', 'watch', 'read'];
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const LEX_KEYS = ['nouns', 'groups', 'verbs', 'watchFlags', 'mergeFlags', 'selectors', 'changeKeys', 'refKeys', 'headKeys',
  'forgeServerWords', 'apiCommands', 'interpreters', 'paths', 'hints'];

// ---- the vocabulary ------------------------------------------------------------------------------------------------
let BASE = null;
const baseLexicon = () => BASE || (BASE = JSON.parse(fs.readFileSync(path.join(__dirname, 'forge-lexicon.json'), 'utf8')));
// Arrays are appended, objects of arrays merged class by class, only under the keys the base already has - an overlay
// adds words, it never replaces the vocabulary or reaches an inherited key.
function mergeInto(base, add) {
  if (Array.isArray(base)) return Array.isArray(add) ? [...base, ...add.filter((w) => !base.includes(w))] : base;
  if (!base || typeof base !== 'object' || !add || typeof add !== 'object' || Array.isArray(add)) return base;
  const out = { ...base };
  for (const k of Object.keys(add)) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = mergeInto(base[k], add[k]);
  return out;
}
const loaded = new Map();
function loadLexicon(projectRoot, env = process.env) {
  let root = 'unused';
  try { root = path.join(String(projectRoot || process.cwd()), require('./layout.js').dataRoot(env)); } catch { /* no layout */ }
  if (loaded.has(root)) return loaded.get(root);
  const base = baseLexicon();
  let lex = { ...base };
  const overlay = path.join(root, 'forge-lexicon.json');
  let notice = null;
  if (fs.existsSync(overlay)) {
    try {
      const add = JSON.parse(fs.readFileSync(overlay, 'utf8'));
      for (const k of LEX_KEYS) if (add && Object.prototype.hasOwnProperty.call(add, k)) lex[k] = mergeInto(base[k], add[k]);
    } catch (err) {
      notice = `the forge-lexicon.json overlay at ${overlay} is not valid JSON (${err.message}) - ignored, the base vocabulary applies`;
    }
  }
  lex = Object.freeze({ ...lex, notice });
  loaded.set(root, lex);
  return lex;
}
// A lexicon compiled once into lookups.
const compiled = new WeakMap();
function compile(lex) {
  if (compiled.has(lex)) return compiled.get(lex);
  const nounOf = new Map();
  for (const [cls, words] of Object.entries(lex.nouns || {})) for (const w of words || []) if (!nounOf.has(w)) nounOf.set(w, cls);
  const verbOf = new Map();
  for (const cls of VERB_ORDER) for (const w of (lex.verbs || {})[cls] || []) if (!verbOf.has(w)) verbOf.set(w, cls);
  const paths = [];
  for (const p of lex.paths || []) { try { paths.push({ re: new RegExp(p.re), concept: p.concept }); } catch { /* an overlay's bad regex */ } }
  const c = {
    lex, nounOf, verbOf, paths,
    groups: new Set(lex.groups || []), selectors: new Set(lex.selectors || []), watchFlags: new Set(lex.watchFlags || []),
    mergeFlags: new Set(lex.mergeFlags || []), apiCommands: new Set(lex.apiCommands || []), interpreters: new Set(lex.interpreters || []),
    forgeServer: new RegExp(`(?:^|[^a-z])(?:${(lex.forgeServerWords || ['git']).map((w) => w.replace(/[^a-z0-9]/g, '')).join('|')})`, 'i'),
  };
  compiled.set(lex, c);
  return c;
}

// ---- words ---------------------------------------------------------------------------------------------------------
// A name split into lower-case words: camelCase, `_`, `-`, `/`, `.`, spaces; `pull request` / `merge request` and
// `auto merge` / `auto complete` joined back into the one noun or verb they spell.
function tokens(text) {
  const raw = String(text || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i], n = raw[i + 1];
    if ((t === 'pull' || t === 'merge') && (n === 'request' || n === 'requests')) { out.push(`${t}_request`); i++; continue; }
    if (t === 'auto' && (n === 'merge' || n === 'complete')) { out.push(`auto${n}`); i++; continue; }
    if (t === 'bypass' && n === 'policy') { out.push('bypasspolicy'); i++; continue; }
    out.push(t);
  }
  return out;
}
function bestVerb(c, words) {
  let best = null;
  for (const w of words) {
    const cls = c.verbOf.get(w);
    if (cls && (!best || VERB_ORDER.indexOf(cls) < VERB_ORDER.indexOf(best.cls))) best = { cls, word: w };
  }
  return best;
}
function nounsIn(c, words) {
  const found = {};
  for (const w of words) { const cls = c.nounOf.get(w); if (cls && !found[cls]) found[cls] = w; }
  return found;
}
// The concept a verb class makes of the object its nouns name. `fileAsRef` says the call is shaped like a forge write
// (a branch key in its input, or a forge server) - a bare `write_file` is a filesystem, never a branch.
function conceptOf(verb, nouns, fileAsRef) {
  const change = nouns.change || nouns.review;
  const ref = nouns.ref || (fileAsRef && nouns.file);
  if (verb === 'merge') return change ? MERGE : ref ? BRANCH : nouns.release ? RELEASE : null;
  if (verb === 'push') return BRANCH;
  if (verb === 'create' || verb === 'write') {
    if (nouns.review || (change && nouns.annotation)) return ANNOTATE;
    if (change) return verb === 'create' ? CREATE : ANNOTATE;
    if (nouns.release) return RELEASE;
    if (ref) return BRANCH;
    return nouns.pipeline ? PIPELINE : null;
  }
  if (verb === 'pipeline') return nouns.pipeline || change ? PIPELINE : null;
  if (verb === 'annotate') return nouns.pipeline && !change ? PIPELINE : change ? ANNOTATE : null;
  if (verb === 'watch') return nouns.pipeline || change ? WATCH : null;
  if (verb === 'read') return change || nouns.release || nouns.pipeline || ref || nouns.file ? READ : null;
  return null;
}
const result = (concept, strength, transport, why, extra = {}) => ({ concept, strength, transport, change: null, ref: null, head: null, why, ...extra });
// A forge noun the call names, with no verb any class knows: the strongest act that noun admits, `unknown` - the gates ask.
function unknownOf(nouns, transport, why, extra) {
  const concept = nouns.change || nouns.review ? MERGE : nouns.release ? RELEASE : nouns.ref ? BRANCH : null;
  return concept ? result(concept, 'unknown', transport, why, extra) : null;
}

// ---- the API route -------------------------------------------------------------------------------------------------
// One HTTP call: its method, its path (lower-cased, no host or query), the body when it is visible on the call, and
// whether a body comes from a file or stdin the hook cannot read.
function classifyApi(c, { method, url, body, bodyHidden }, transport) {
  const m = String(method || 'GET').toUpperCase();
  let p = String(url || '').replace(/^[a-z]+:\/\/[^/]+/i, '').replace(/[?#].*$/, '').toLowerCase();
  if (p && !p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/+$/, '');
  if (/(?:^|\/)graphql$/.test(p)) {
    const text = String(body || '');
    const mut = /\bmutation\b[^{]*\{\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(text);
    if (!mut) return bodyHidden && m !== 'GET' ? result(MERGE, 'unknown', transport, 'a GraphQL call whose body the hook cannot read') : result(READ, 'known', transport, 'a GraphQL query');
    const words = tokens(mut[1]);
    const verb = bestVerb(c, words);
    const concept = verb && conceptOf(verb.cls, nounsIn(c, words), true);
    if (concept) return result(concept, 'known', transport, `GraphQL mutation ${mut[1]}`);
    return unknownOf(nounsIn(c, words), transport, `GraphQL mutation ${mut[1]} has no known verb`) || null;
  }
  const segs = tokens(p);
  const nouns = nounsIn(c, segs);
  const forgeish = nouns.change || nouns.release || nouns.ref || nouns.file || nouns.pipeline;
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return forgeish ? result(READ, 'known', transport, `${m} ${p}`) : null;
  for (const rule of c.paths) {
    if (!rule.re.test(p)) continue;
    if (rule.concept === 'change.item') {
      const said = tokens(body);
      if (bestVerb(c, said) && bestVerb(c, said).cls === 'merge') return result(MERGE, 'known', transport, `${m} ${p} with a completing body`);
      if (bodyHidden) return result(MERGE, 'unknown', transport, `${m} ${p} with a body the hook cannot read`);
      return result(ANNOTATE, 'known', transport, `${m} ${p}`);
    }
    return result(rule.concept, 'known', transport, `${m} ${p}`);
  }
  return unknownOf(nouns, transport, `${m} ${p} matches no known forge path`);
}

// ---- the shell route -----------------------------------------------------------------------------------------------
const baseName = (name) => String(name || '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase();
const isFlag = (w) => /^-/.test(w);
function flagValue(argv, names) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    for (const n of names) {
      if (a === n && i + 1 < argv.length) return argv[i + 1];
      if (a.startsWith(`${n}=`)) return a.slice(n.length + 1);
      if (/^-[A-Za-z]$/.test(n) && a.startsWith(n) && a.length > 2 && !a.startsWith('--')) return a.slice(2);
    }
  }
  return null;
}
const changeFromArgs = (argv) => {
  const id = flagValue(argv, ['--id', '--iid', '--number']);
  if (id && /^\d+$/.test(id)) return id;
  for (const a of argv) {
    if (/^#?\d+$/.test(a)) return a.replace('#', '');
    const u = /\/(?:pull|pulls|merge_requests|pullrequest|pullrequests)\/(\d+)/.exec(a);
    if (u) return u[1];
  }
  return null;
};
// One HTTP call read off an API-capable command word, or null when the word is not one.
function apiCallOf(c, name, argv) {
  if (name === 'curl') {
    let method = null, url = null, body = '', bodyHidden = false, upload = false;
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i], next = argv[i + 1];
      if (a === '-X' || a === '--request') { method = next; i++; }
      else if (/^-[A-Za-z]*X$/.test(a) && !a.startsWith('--')) { method = next; i++; }
      else if (/^-[A-Za-z]*X[A-Z]+$/.test(a) && !a.startsWith('--')) method = a.replace(/^-[A-Za-z]*X/, '');
      else if (a.startsWith('--request=')) method = a.slice(10);
      else if (/^(?:-d|--data|--data-raw|--data-binary|--data-urlencode|--json|-F|--form|--form-string)$/.test(a)) {
        if (String(next || '').startsWith('@')) bodyHidden = true; else body += ` ${next || ''}`;
        i++;
      } else if (a === '-T' || a === '--upload-file') { upload = true; i++; }
      else if (a === '-G' || a === '--get') method = 'GET';
      else if (a === '--url') { url = next; i++; }
      else if (/^https?:\/\//i.test(a)) url = url || a;
    }
    if (!url) return null;
    return { method: method || (upload ? 'PUT' : body || bodyHidden ? 'POST' : 'GET'), url, body, bodyHidden };
  }
  if (name === 'wget') {
    const url = argv.find((a) => /^https?:\/\//i.test(a));
    if (!url) return null;
    const post = flagValue(argv, ['--post-data', '--body-data']);
    const file = flagValue(argv, ['--post-file', '--body-file']);
    return { method: flagValue(argv, ['--method']) || (post || file ? 'POST' : 'GET'), url, body: post || '', bodyHidden: !!file };
  }
  if (name === 'http' || name === 'https' || name === 'xh') {
    const pos = argv.filter((a) => !isFlag(a));
    let method = null;
    if (pos.length && METHODS.has(pos[0].toUpperCase())) method = pos.shift().toUpperCase();
    const url = pos.shift();
    if (!url) return null;
    const items = pos.filter((a) => /[=:]/.test(a));
    return { method: method || (items.length ? 'POST' : 'GET'), url, body: items.join(' '), bodyHidden: false };
  }
  if (/^(?:invoke-restmethod|invoke-webrequest|irm|iwr)$/.test(name)) {
    const lower = argv.map((a) => (isFlag(a) ? a.toLowerCase() : a));
    const url = flagValue(lower, ['-uri']) || argv.find((a) => /^https?:\/\//i.test(a));
    if (!url) return null;
    return { method: flagValue(lower, ['-method']) || 'GET', url, body: flagValue(lower, ['-body']) || '', bodyHidden: !!flagValue(lower, ['-infile']) };
  }
  if ((name === 'gh' || name === 'glab' || name === 'tea') && argv[0] === 'api') {
    const VALUED = new Set(['-X', '--method', '-H', '--header', '-f', '--raw-field', '-F', '--field', '--input', '-q', '--jq', '-t', '--template', '--hostname', '--cache', '--preview', '-p', '--form']);
    let method = null, url = null, body = '', bodyHidden = false, fields = false;
    for (let i = 1; i < argv.length; i++) {
      const a = argv[i], next = argv[i + 1];
      if (a === '-X' || a === '--method') { method = next; i++; continue; }
      if (/^(?:-f|--raw-field|-F|--field|--form)$/.test(a)) { fields = true; body += ` ${next || ''}`; i++; continue; }
      if (a === '--input') { fields = true; bodyHidden = true; i++; continue; }
      if (VALUED.has(a)) { i++; continue; }
      if (!isFlag(a) && !url) url = a;
    }
    if (!url) return null;
    return { method: method || (fields ? 'POST' : 'GET'), url, body, bodyHidden };
  }
  if (name === 'az' && argv[0] === 'devops' && argv[1] === 'invoke') {
    const area = flagValue(argv, ['--area']) || '', resource = flagValue(argv, ['--resource']) || '';
    const route = flagValue(argv, ['--route-parameters']) || '';
    const id = (/(?:pullrequestid|id)=(\d+)/i.exec(route) || [])[1] || '0';
    return { method: flagValue(argv, ['--http-method']) || 'GET', url: `/${area}/${resource}/${id}`, body: '', bodyHidden: !!flagValue(argv, ['--in-file']) };
  }
  if (name === 'az' && argv[0] === 'rest') {
    const url = flagValue(argv, ['--url', '--uri', '-u']);
    if (!url) return null;
    const body = flagValue(argv, ['--body', '-b']) || '';
    return { method: flagValue(argv, ['--method', '-m']) || (body ? 'POST' : 'GET'), url, body: body.startsWith('@') ? '' : body, bodyHidden: body.startsWith('@') };
  }
  return null;
}
// Inline interpreter code (`node -e`, `python -c`, a heredoc into one): every URL in it is a call, its method sniffed
// from the code; a write path with no method the hook can see is `unknown`.
function interpreterCalls(c, code) {
  const out = [];
  const method = (/\bmethod\s*[:=]\s*['"]?(put|post|patch|delete|get)\b/i.exec(code) || /\brequests\.(put|post|patch|delete|get)\b/i.exec(code)
    || /['"](PUT|POST|PATCH|DELETE)['"]/.exec(code) || [])[1];
  const isGraphql = /\bmutation\b/.test(code);
  for (const m of code.matchAll(/https?:\/\/[^\s'"`)]+/g)) {
    const url = m[0];
    const probe = classifyApi(c, { method: method || 'POST', url, body: isGraphql ? code : '', bodyHidden: false }, 'api');
    if (!probe) continue;
    if (method) out.push(probe);
    else if (probe.concept === READ) out.push(probe);
    else out.push({ ...probe, strength: 'unknown', why: `${probe.why} - inline code whose HTTP method the hook cannot see` });
  }
  return out;
}
// A CLI's argv read in CLI order: group words skipped, then the nouns, then the verb - `gh pr merge`, `az repos pr update`,
// `tea actions runs list`. A noun that is also a verb and ends the nouns is the verb (`az pipelines run`, `gh pr checks`).
function classifyCli(c, name, argv) {
  const lead = [];
  for (const a of argv) { if (isFlag(a)) break; lead.push(a); }
  let i = 0;
  let grouped = false;
  while (i < lead.length && c.groups.has(lead[i])) { i++; grouped = true; }
  const shellNoun = (w) => { const cls = c.nounOf.get(w); return cls === 'change' || cls === 'release' || cls === 'pipeline' || (grouped && cls === 'ref') ? cls : null; };
  const nouns = [];
  while (i < lead.length && shellNoun(lead[i])) nouns.push(lead[i++]);
  if (!nouns.length) return null;
  let verbWord = lead[i];
  let verb = verbWord ? bestVerb(c, tokens(verbWord)) : null;
  if (!verb && nouns.length > 1 && c.verbOf.has(nouns[nouns.length - 1])) { verbWord = nouns.pop(); verb = { cls: c.verbOf.get(verbWord), word: verbWord }; }
  else if (!verb && nouns.length === 1 && c.verbOf.get(nouns[0]) === 'read' && !verbWord) { verb = { cls: 'read', word: nouns[0] }; }
  const classes = {};
  for (const n of nouns) { const cls = c.nounOf.get(n); classes[cls] = n; }
  const object = classes.release ? { release: classes.release } : classes.ref ? { ref: classes.ref } : classes.change ? { change: classes.change } : { pipeline: classes.pipeline };
  if (nouns.some((n) => c.nounOf.get(n) === 'pipeline') && !classes.release && !classes.ref && !classes.change) object.pipeline = classes.pipeline;
  const rest = argv.slice(lead.length);
  const flagWords = rest.filter(isFlag).map((f) => f.replace(/=.*$/, ''));
  const extra = { change: changeFromArgs(argv.slice(i + 1)), ref: flagValue(argv, ['--base', '--target-branch', '--branch', '--target']), head: flagValue(argv, ['--sha', '--match-head-commit']) };
  const label = `${name} ${[...nouns, verbWord || ''].join(' ').trim()}`;
  if (!verb) {
    if (!verbWord || /^#?\d+$/.test(verbWord) || /[=/.:]/.test(verbWord) || /[A-Z]/.test(verbWord)) {
      if (classes.change && !classes.release) return result(flagWords.some((f) => c.watchFlags.has(f)) ? WATCH : READ, 'known', 'shell', `${label}: a bare change-request noun lists or shows`, extra);
      return null;
    }
    return classes.change ? result(MERGE, 'unknown', 'shell', `${label}: '${verbWord}' is no known verb for a change request`, extra) : null;
  }
  let cls = verb.cls;
  if (cls === 'read' || cls === 'watch') {
    if (cls === 'read' && flagWords.some((f) => c.watchFlags.has(f))) cls = 'watch';
  } else if (cls === 'create' || cls === 'write') {
    const flagSaysMerge = flagWords.some((f) => { const t = tokens(f); const v = bestVerb(c, [f.replace(/^-+/, ''), ...t]); return v && v.cls === 'merge'; });
    const valueSaysMerge = [...c.mergeFlags].some((f) => { const v = flagValue(argv, [f]); return v && !/\s/.test(v) && (bestVerb(c, tokens(v)) || {}).cls === 'merge'; });
    if (flagSaysMerge || valueSaysMerge) cls = 'merge';
  }
  const concept = conceptOf(cls, object, true);
  return concept ? result(concept, 'known', 'shell', `${label}${cls !== verb.cls ? ` (${cls} by its flags)` : ''}`, extra) : null;
}
function classifyShell(c, raw, cwd, pre) {
  let sw;
  try { sw = require('./shell-writes.js'); } catch { return []; }
  let read = pre;
  if (!read) { try { read = sw.gitText(String(raw || ''), cwd || process.cwd()); } catch { return []; } }
  const { command, parsed } = read;
  let words;
  try { words = sw.commandWords(command, parsed); } catch { return []; }
  const out = [];
  let interp = false;
  for (const w of words) {
    const name = baseName(w.name);
    const argv = (w.argv || []).map(String);
    const ws = w.cmd && w.cmd.words;
    const span = { at: w.at, end: ws && ws.length ? ws[ws.length - 1].e : command.length };
    let r = null;
    const api = c.apiCommands.has(name) || name === 'gh' || name === 'glab' || name === 'tea' || name === 'az' ? apiCallOf(c, name, argv) : null;
    if (api) r = classifyApi(c, api, 'api');
    else if (c.interpreters.has(name)) {
      interp = true;
      const flagAt = argv.findIndex((a) => /^(?:-[A-Za-z]*[eEc]|-p|--eval|--print|-command)$/i.test(a));
      if (flagAt >= 0 && argv[flagAt + 1]) {
        const calls = interpreterCalls(c, argv[flagAt + 1]);
        r = calls.sort((a, b) => rankOf(b) - rankOf(a))[0] || null;
      }
    } else if (name === 'git') {
      if (argv.length && c.nounOf.get(argv[0]) === 'change') r = classifyCli(c, name, argv);
    } else if (name !== 'sudo' && name !== 'env' && name !== 'xargs') r = classifyCli(c, name, argv);
    if (r) out.push({ ...r, ...span });
  }
  // A heredoc fed to an interpreter carries its code in the body the parse blanks: read the raw text once.
  if (interp && !out.some((r) => r.transport === 'api')) for (const r of interpreterCalls(c, String(raw))) out.push({ ...r, at: 0, end: String(raw).length });
  out.command = command;
  return out;
}

// ---- the MCP route -------------------------------------------------------------------------------------------------
const STACK_SERVER = /^mcp__(?:plugin_alfred-[a-z0-9-]+_)?alfred-[a-z0-9-]+__/;
const isStackServer = (toolName) => STACK_SERVER.test(String(toolName || ''));
const keyValue = (input, keys) => { for (const k of keys) { const v = input[k]; if (typeof v === 'string' || typeof v === 'number') return String(v); } return null; };
function classifyMcp(c, toolName, input, server) {
  const name = String(toolName);
  const at = name.lastIndexOf('__');
  const tool = name.slice(at + 2);
  const serverName = (server && server.name) || name.slice(5, at);
  const inp = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const extra = { change: keyValue(inp, c.lex.changeKeys || []), ref: keyValue(inp, c.lex.refKeys || []), head: keyValue(inp, c.lex.headKeys || []) };
  // A passthrough to the forge's own API: read as that HTTP call.
  const urlKey = ['path', 'url', 'endpoint', 'uri'].find((k) => typeof inp[k] === 'string');
  if (urlKey && typeof inp.method === 'string' && METHODS.has(inp.method.toUpperCase())) {
    const r = classifyApi(c, { method: inp.method, url: inp[urlKey], body: JSON.stringify(inp.body || inp.data || ''), bodyHidden: false }, 'mcp');
    return r && { ...r, ...extra, why: `${tool}: ${r.why}` };
  }
  if (typeof inp.query === 'string' && /\b(?:query|mutation)\b|\{/.test(inp.query) && tokens(tool).includes('graphql')) {
    const r = classifyApi(c, { method: 'POST', url: '/graphql', body: inp.query }, 'mcp');
    return r && { ...r, ...extra, why: `${tool}: ${r.why}` };
  }
  const toolWords = tokens(tool);
  const selectorWords = [];
  const flagWords = [];
  for (const k of Object.keys(inp)) {
    if (c.selectors.has(k) && typeof inp[k] === 'string') selectorWords.push(...tokens(inp[k]));
    else if (inp[k] === true) flagWords.push(...tokens(k));
  }
  const nouns = nounsIn(c, [...toolWords, ...selectorWords]);
  const fileAsRef = !!extra.ref || c.forgeServer.test(serverName);
  if (!(nouns.change || nouns.review || nouns.release || nouns.ref || nouns.file || nouns.pipeline) && !toolWords.includes('push')) return null;
  const toolVerb = bestVerb(c, toolWords);
  const label = `${tool}${selectorWords.length ? ` (${selectorWords.join('_')})` : ''}`;
  // A tool whose own name only reads (`list_pull_requests`, `get_job_logs`) reads, whatever filter values it carries -
  // `{state: 'completed'}` on a list is a filter, not a completion.
  if (toolVerb && (toolVerb.cls === 'read' || toolVerb.cls === 'watch') && !toolWords.some((w) => { const v = c.verbOf.get(w); return v && v !== 'read' && v !== 'watch'; })) {
    const concept = conceptOf(toolVerb.cls, nouns, true);
    return concept ? result(concept, 'known', 'mcp', label, extra) : null;
  }
  const flagVerb = bestVerb(c, flagWords);
  const selVerb = bestVerb(c, selectorWords);
  const verb = flagVerb && flagVerb.cls === 'merge' ? flagVerb : selVerb || toolVerb;
  if (toolWords.includes('push') && (!verb || verb.cls !== 'merge')) {
    // `push` publishes by itself (`git_push`, `push_files`) - unless it pushes something no forge noun names (`push_notification`).
    const other = toolWords.filter((w) => w !== 'push' && w !== 'git' && w !== 'to');
    if (!other.length || other.some((w) => c.nounOf.get(w) === 'ref' || c.nounOf.get(w) === 'file' || c.nounOf.get(w) === 'change')) return result(BRANCH, 'known', 'mcp', label, extra);
    return null;
  }
  if (!verb) return unknownOf(nouns, 'mcp', `${label}: names a forge object but no known verb`, extra);
  const concept = conceptOf(verb.cls, nouns, fileAsRef);
  if (concept) return result(concept, 'known', 'mcp', label, extra);
  return null;
}

// ---- the one entry -------------------------------------------------------------------------------------------------
// classify(payload, { lexicon? }) - a PreToolUse payload (`tool_name`, `tool_input`, `mcp_server`, `cwd`) read as one
// result: { concept, strength: 'known'|'unknown', transport: 'shell'|'api'|'mcp', change, ref, head, why } plus, on the
// shell route, `at` / `end` - where the act sits in the (alias-expanded) command. Several acts in one command: the
// strongest. Not a forge call: null.
function classify(payload, opts = {}) {
  if (!payload || typeof payload !== 'object') return null;
  const toolName = String(payload.tool_name || '');
  const input = payload.tool_input || {};
  const lex = opts.lexicon || loadLexicon(payload.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const c = compile(lex);
  if (/^mcp__/.test(toolName)) return isStackServer(toolName) ? null : classifyMcp(c, toolName, input, payload.mcp_server);
  if (/^(?:Bash|PowerShell|Monitor)$/.test(toolName)) {
    const all = classifyShell(c, input.command, payload.cwd);
    return all.reduce((best, r) => (rankOf(r) > rankOf(best) ? r : best), null);
  }
  return null;
}
// Every act a shell command carries, in order - for a gate that judges each one (the commit guard). `parsed` reuses a
// shell-writes parse of the alias-expanded `command`, so the spans index the text that gate already holds.
function classifyCommand(command, cwd, opts = {}) {
  const c = compile(opts.lexicon || loadLexicon(cwd || process.cwd()));
  return classifyShell(c, command, cwd, opts.parsed ? { command, parsed: opts.parsed } : null);
}

// ---- the act ledger ------------------------------------------------------------------------------------------------
// Every publish a gate ALLOWS (and every unknown call it asked about) is one row in
// <data root>/state/forge/ACTS-<session>.jsonl - what the ref watch reads to tell a gated move from an ungated one.
// Written at PreToolUse, before the act runs: a row whose act was then refused or failed only ever covers a move that did
// not happen. Best effort - a ledger write never changes a verdict.
const sessionFile = (sessionId) => `ACTS-${String(sessionId || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_')}.jsonl`;
function actsPath(projectRoot, sessionId, env = process.env) {
  return require('./layout.js').statePath(projectRoot, 'forge', sessionFile(sessionId), env);
}
function recordAct(projectRoot, sessionId, act, env = process.env) {
  try {
    const file = actsPath(projectRoot, sessionId, env);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const row = { concept: act.concept || null, change: act.change || null, ref: act.ref || null, head: act.head || null, asked: !!act.asked, at: Date.now() };
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
  } catch { /* the ledger is never allowed to break a gate */ }
}
function readActs(projectRoot, sessionId, env = process.env) {
  try {
    return fs.readFileSync(actsPath(projectRoot, sessionId, env), 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// ---- the remote, read with plain git -------------------------------------------------------------------------------
// Every forge speaks git, so the remote's refs are the one transport-neutral fact: `git ls-remote`, bounded so a dead
// network or a credential prompt never hangs a hook (a timed-out PreToolUse hook fails OPEN). No terminal prompt; ssh in
// batch mode with a connect timeout - appended to the user's own GIT_SSH_COMMAND, and left alone when core.sshCommand
// carries their key setup (the spawn cap still bounds it).
const LS_REMOTE_MS = 6000;
const { spawnSync } = require('node:child_process');
const gitOut = (cwd, args, timeout = 5000) => {
  const r = spawnSync('git', ['-c', 'core.fsmonitor=false', ...args], { cwd, timeout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  return r.status === 0 ? String(r.stdout || '').trim() : null;
};
function networkEnv(cwd) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
  const batch = '-o BatchMode=yes -o ConnectTimeout=5';
  if (env.GIT_SSH_COMMAND) env.GIT_SSH_COMMAND = `${env.GIT_SSH_COMMAND} ${batch}`;
  else if (!gitOut(cwd, ['config', 'core.sshCommand'])) env.GIT_SSH_COMMAND = `ssh ${batch}`;
  return env;
}
// The remote the current branch pushes to: its configured remote, else `origin`, else the only one; null when none.
function remoteOf(cwd) {
  const branch = gitOut(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']);
  const own = branch && gitOut(cwd, ['config', `branch.${branch}.remote`]);
  if (own && own !== '.') return own;
  const all = (gitOut(cwd, ['remote']) || '').split('\n').filter(Boolean);
  return all.includes('origin') ? 'origin' : all.length === 1 ? all[0] : null;
}
// { ok, refs: Map<ref, sha>, reason } - `patterns` narrows the listing (`--heads --tags` by default; a symref answer for HEAD
// when `symref` is set).
function lsRemote(cwd, remote, patterns = null, opts = {}) {
  if (!remote) return { ok: false, refs: new Map(), reason: 'no remote' };
  const args = ['ls-remote', ...(opts.symref ? ['--symref'] : []), ...(patterns ? [] : ['--heads', '--tags']), remote, ...(patterns || [])];
  const r = spawnSync('git', args, { cwd, timeout: opts.timeout || LS_REMOTE_MS, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], env: networkEnv(cwd) });
  if (r.error || r.status !== 0) {
    const why = r.error && r.error.code === 'ETIMEDOUT' ? `no answer within ${(opts.timeout || LS_REMOTE_MS) / 1000}s`
      : String(r.stderr || (r.error && r.error.message) || `git exited ${r.status}`).trim().split('\n').pop().slice(0, 160);
    return { ok: false, refs: new Map(), reason: why };
  }
  const refs = new Map();
  let head = null;
  for (const line of String(r.stdout || '').split('\n')) {
    const sym = /^ref: (\S+)\s+HEAD$/.exec(line);
    if (sym) { head = sym[1]; continue; }
    const m = /^([0-9a-f]{40,64})\s+(\S+)$/.exec(line);
    if (m && !m[2].endsWith('^{}')) refs.set(m[2], m[1]);
  }
  return { ok: true, refs, head, reason: null };
}
// The head of change request `change` on the remote, by the ref each forge publishes it under - GitHub and Gitea
// refs/pull/<n>/head, GitLab refs/merge-requests/<n>/head. Azure publishes only refs/pull/<n>/merge, a merge commit and
// not the head, so it is not read. Null when no such ref (or no answer).
function changeHead(cwd, remote, change) {
  if (!/^\d+$/.test(String(change || ''))) return null;
  const want = [`refs/pull/${change}/head`, `refs/merge-requests/${change}/head`];
  const r = lsRemote(cwd, remote, want);
  if (!r.ok) return null;
  for (const ref of want) if (r.refs.has(ref)) return r.refs.get(ref);
  return null;
}
// Why a merge's head is NOT covered by the review a receipt names, or null when it is (or cannot be judged - no head:
// line in a waiver, no change ref, no network: the local-HEAD rule the receipt already passed stands). Covered: the head
// is the reviewed sha or an ancestor of it.
function unseenHead({ cwd, change, sha, receiptHead }) {
  const h = String(receiptHead || '').toLowerCase();
  if (!/^[0-9a-f]{7,64}$/.test(h)) return null;
  const target = sha && /^[0-9a-f]{7,64}$/i.test(sha) ? String(sha).toLowerCase() : changeHead(cwd, remoteOf(cwd), change);
  if (!target) return null;
  if (target.startsWith(h) || h.startsWith(target)) return null;
  const t7 = target.slice(0, 12), h7 = h.slice(0, 12);
  if (gitOut(cwd, ['cat-file', '-e', `${target}^{commit}`]) === null)
    return `the change's head ${t7} is not in this checkout, so the review at ${h7} never saw it - fetch the change, review its head and write head: again`;
  if (spawnSync('git', ['merge-base', '--is-ancestor', target, h], { cwd, timeout: 5000, stdio: 'ignore' }).status === 0) return null;
  return `the change's head ${t7} carries commits the review at ${h7} never saw - review the change's head and write head: again`;
}

module.exports = { classify, classifyCommand, loadLexicon, isStackServer, tokens, recordAct, readActs, actsPath, remoteOf, lsRemote, changeHead, unseenHead, gitOut, LS_REMOTE_MS, CONCEPTS, PUBLISH, PREF_HOLD };
