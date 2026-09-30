#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// PreToolUse gate (matchers: Read + Bash), plus a CLI mode: alfred-security.md's rule that a
// credential is read for its PRESENCE, never its value - mechanized. Measured: the rule held only
// as prose, and a session checking whether SENTRY_ACCESS_TOKEN was set printed the whole env block
// with `console.log(JSON.stringify(s.env))` on its first attempt (the value landed in the tool
// result and the transcript; the presence-only phrasing came on the second). The settings.json
// permissions.deny covers the Read TOOL on the ACCOUNT files only - a project settings.json that
// wrongly holds the token, and every shell route (cat, jq, grep, an inline node/python read, an
// `echo $VAR`, a bare `env`), passed every guard in the stack. This gate judges CONTENT, not paths:
// a dump verb on a JSON or dotenv file holding a credential-shaped key with a live value, a print
// of a credential-shaped variable, a whole-environment dump, and a credential-shaped literal typed
// into a command. On the SHELL route the dump, the variable print and the environment dump are
// REWRITTEN on the way out (hookSpecificOutput.updatedInput) rather than blocked - a block cost a
// red denial plus a retried turn and, remote, left the user nothing they could run: the model gets
// the file back with every credential value shown as <set (N chars)> and the rest as written, the
// variable as its presence line, the environment as a masked listing. The Read tool and a literal
// stay blocked. The sanctioned reads are this file's own CLI modes, so a denial and a rewrite
// always name a route that exists wherever the guard does:
//   node guard-secret-value.js --presence <file> [KEY ...]   ->   KEY=set (N chars) | KEY=absent
//   node guard-secret-value.js --redacted <file>            ->   the file, credential values masked
//   node guard-secret-value.js --redacted-env               ->   the environment, the same way
// exit 2 = block (stderr fed back); exit 0 = allow, or a JSON rewrite on stdout.
'use strict';
const fs = require('fs');
const os = require('os');
const pathMod = require('path');
// The judging budget (review M3 of 2.1.6), its thresholds in this one place. It counts WORK, never time, so a
// command gets the same verdict on any machine under any load: each judging step charges the characters it reads, and
// past JUDGE_MAX_WORK, or on path-building code nested deeper than JUDGE_MAX_DEPTH, the reading gives up and the
// command is blocked - judged the conservative way, never let through. The read guard carries the same budget. The
// count is `global.JUDGE_WORK`; a test preload lowers the ceiling through `global.JUDGE_WORK_MAX`.
// 20x the most any of 54,503 recorded commands cost (99,197), and about a second of judging
const JUDGE_MAX_WORK = 2000000;
const JUDGE_MAX_DEPTH = 64;
const JUDGE_WORK = global.JUDGE_WORK = { used: 0, max: Number(global.JUDGE_WORK_MAX) || JUDGE_MAX_WORK };
class JudgeBudget extends Error {}
function judgeTick(units) { JUDGE_WORK.used += units; if (JUDGE_WORK.used > JUDGE_WORK.max) throw new JudgeBudget('work'); }

// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them, never inlined in every
// hook. Fail-open on purpose - no prelude, no project dir or a malformed settings file all leave
// this hook running.
let envOf = (env, suffix) => env[`ALFRED_CODE_${suffix}`];
// R86: a repo never set up keeps this guard live but gets no block row (R54) - false fails open to logging.
let unsetRepo = false;
if (require.main === module) {
  let off = false;
  try {
    const prelude = require('./hook-prelude.js');
    envOf = prelude.envOf;
    off = prelude.standDown('guard-secret-value');
    unsetRepo = prelude.neverSetUp();
  } catch { /* an install without the prelude runs the hook unchanged */ }
  // Outside the try: the shell-guard dispatcher runs this file in-process, where that catch would swallow the exit.
  if (off) process.exit(0);
}
// The docs root env value. ALFRED_CODE_DOCS_PATH is the name; envOf (hook-prelude.js) also answers
// CLAUDE_STACK_DOCS_PATH (the pre-2.0.0 spelling) and, last, CLAUDE_DOCS_PATH (pre-0.2.43) - so a // legacy-name
// project whose settings.json has not been migrated yet keeps resolving.
const docsRootEnv = () => envOf(process.env, 'DOCS_PATH') || '.alfred/docs';

// Keys whose value is a credential - the SAME string as meta/environment.json `secret_key_pattern`
// (npm run lint fails when the two differ), matched case-insensitively so `apiKey` and `API_KEY`
// judge alike. The hook ships without meta/, hence the copy.
const SECRET_KEY_SOURCE = '(TOKEN|SECRET|KEY|PASSWORD|PASSWD|DSN|CREDENTIAL|AUTH)$';
const SECRET_KEY_RE = new RegExp(SECRET_KEY_SOURCE, 'i');
// The value shapes the stack's credentials take - copied from guard-stop-contract.js; keep identical.
const SECRET_SHAPE = /\b(sntryu_[0-9a-f]{16,}|ctx7sk-[0-9a-f-]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/;
// A credential file is small - a settings.json is under 10 KB - so the cap costs this gate nothing
// on the files it exists for. The trade it makes is deliberate and stated: a larger file holding a
// credential passes unscanned, because it is a data dump, which guard-read-whole-file.js is the gate
// for, and scanning megabytes on every Bash call would cost every session for that one shape.
const MAX_BYTES = 512 * 1024;

// A `${VAR}` placeholder or a blank is not a live value - .mcp.json carries `${SENTRY_ACCESS_TOKEN}`
// by design, and an installer seeds `"SENTRY_ACCESS_TOKEN": ""` for the user to fill in.
// A variable REFERENCE is no value either (2.1.6): `$NPM_TOKEN` in a CI file (an upper-case name - `$ecret` is a
// password), `%API_KEY%` in a Windows config, a workflow's `${{secrets.X}}`, a Helm or Jinja `{{.Values.x}}`, an
// Octopus `#{X}`, an Azure DevOps or MSBuild `$(X)` and a maven-filtered `@x@`.
const isPlaceholder = (v) => typeof v === 'string'
  && /^(?:\$\{[^}]*\}|\$\{\{[^}]*\}\}|\{\{[^}]*\}\}|#\{[^}]*\}|\$\([\w.-]+\)|@[\w.-]+@|\$[A-Z_][A-Z0-9_]*|%[A-Za-z_]\w*%)$/.test(v.trim());
const isLive = (v) => typeof v === 'string' && v.trim() !== '' && !isPlaceholder(v);

// CONTENT tells that a credential-shaped KEY is not holding a credential - the false positives the
// key name alone cannot separate (measured on real projects): an i18n bundle's `"password":
// "Password"`, an MV3 manifest's `"key": "MIIB..."` (a PUBLIC key), a `.env.example`'s
// `API_KEY=your-api-key-here`. A value that repeats its own key, carries whitespace (a label, not a
// token), reads as placeholder vocabulary, or starts with `MII` (DER/base64 public key) is a sample.
// These apply to the FILE judgement only - `--presence` still reports a placeholder as such, since
// there the placeholder IS the answer. Accepted gap: a test fixture holding a fake credential under
// a credential-shaped key (`"apiKey": "test-key-1234"`) has no content tell and still blocks - read
// it through `--presence`, or rename the key.
const TEMPLATE_VALUE = /^(?:your[-_]|<[^>]+>$|changeme|x{3,}$|\.\.\.$|todo|replace|example|dummy|placeholder)/i;
// A value that IS an identifier NAME names a credential, it is not one: SCREAMING_SNAKE with at
// least one underscore, no lower case, nothing else in it. Measured: this stack's OWN catalogs are
// lists of variable names under a field literally called `key`, so `meta/environment.json`
// (`env.0.key` = `ALFRED_CODE_DOCS_PATH`) and `meta/migrations.json`
// (`detect.settings_env_key` = `CLAUDE_DOCS_PATH`) were read as credential files - on the Read
// route a block, and on the shell route something worse: every `key` in the file the guided walks
// run on came back as `<set (N chars)>`. A SHAPE match still wins, so an all-caps credential like
// an AWS `AKIA...` id (no underscore anyway) is judged on its shape, not excused as a name. The
// gap this accepts is a real password spelled in screaming snake under 64 characters.
const NAME_VALUE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
// A private key in PEM form is ONE value spanning lines, so the whitespace tell below would read it as a
// label. Measured: a Firebase `PrivateKey` printed raw in the redacted view of an appsettings file.
const PEM_PRIVATE = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/;
// A machine credential is ASCII. A value carrying a letter outside it is a human-language LABEL -
// the i18n tell the whitespace rule above misses, because a one-word translation of 'Password' has
// no space in it (measured: a translation bundle came back as a 52.5KB 'redacted view ... 4
// credential value(s)', and at replay `grep` and `cat` on an i18n file were still rewritten). A
// SHAPE match still wins, so nothing with a known credential shape is excused here.
const NON_ASCII = /[^\x00-\x7F]/;
// A file path: home- or cwd-relative, under a variable, under a system or secrets directory, or a drive letter. A bare
// `/Xk3abc/def` is left out on purpose - a base64 secret can start with a slash.
const FILE_PATH = /^(?:~|\.\.?|\$\{?[A-Za-z_]\w*\}?|\/(?:etc|home|Users|var|opt|usr|run|tmp|srv|root|mnt|data|secrets?|certs?|keys?|ssl)|[A-Za-z]:)[\\/][^\s:*?"<>|]*$/;
const isSampleValue = (key, v) => {
  const s = String(v).trim();
  if (PEM_PRIVATE.test(s)) return false;
  return s.toLowerCase() === String(key).toLowerCase() || /\s/.test(s) || TEMPLATE_VALUE.test(s) || s.startsWith('MII')
    || /^(?:true|false|yes|no|on|off|null|none|nil)$/i.test(s) // a switch (`auth: true`), not a secret
    || FILE_PATH.test(s) // where a key lives (`ssl_certificate_key /etc/nginx/site.key;`, `SSH_KEY=~/.ssh/id_rsa`), not the key
    || (NON_ASCII.test(s) && !SECRET_SHAPE.test(s))
    || (s.length <= 64 && NAME_VALUE.test(s) && !SECRET_SHAPE.test(s));
};
const holdsCredential = (key, v) => isLive(v) && !isSampleValue(key, v);
// A credential INSIDE a larger value: a connection string's `Password=` / `Pwd=` (`;` pairs, or Redis's `,`
// pairs) and a URL's userinfo (`postgres://user:<pw>@host`). The key names the CONNECTION (`Postgres`,
// `DATABASE_URL`), so the key test never saw it. Measured: a Staging Postgres and Redis password printed raw
// in the redacted view whose header promised no value enters the chat. The value is judged like any other -
// a `${VAR}` placeholder or a template word is not live - and only the password part is masked.
const EMBEDDED_PAIR = /((?:^|[;,])\s*(?:password|pwd)\s*=\s*)([^;,]*)/gi;
const EMBEDDED_URL = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:)([^@\s/]+)(?=@)/gi;
const embeddedCredential = (v) => typeof v === 'string'
  && [...v.matchAll(EMBEDDED_PAIR), ...v.matchAll(EMBEDDED_URL)].some((m) => holdsCredential('password', m[2]));
const maskEmbedded = (v, mask) => v
  .replace(EMBEDDED_PAIR, (all, head, val) => (holdsCredential('password', val) ? head + mask(val) : all))
  .replace(EMBEDDED_URL, (all, head, val) => (holdsCredential('password', val) ? head + mask(val) : all));
// A file-SHAPE tell: a basename ending .example / .sample / .template / .dist ships the KEYS, never
// the values - judging it blocks the one file a session legitimately reads to learn what to fill in.
const TEMPLATE_FILE = /\.(?:example|sample|template|dist)$/i;

// A FILE's key names more than a variable's name does (2.1.6): rclone's `pass`, redis's `requirepass`, a `db.pass`,
// a passphrase, a kubeconfig's `client-key-data`, a camelCase `userPass` or a publish profile's `userPWD`. Only a key
// inside a file reads these - a variable name is judged by SECRET_KEY_RE alone, the pattern environment.json pins
// (`PWD=/home` is the shell's working directory, never a password, and needs a lowercase letter before it here).
const FILE_KEY_EXTRA = /(?:^|[._-])pass(?:phrase)?$|(?:^|[._-])(?:client|private)[-_]?key[-_]?data$|^requirepass$/i;
const CAMEL_PASS = /[a-z0-9](?:Pass(?:phrase)?|PWD|Pwd)$/;
const credKey = (k) => SECRET_KEY_RE.test(k) || FILE_KEY_EXTRA.test(k) || CAMEL_PASS.test(k);
// A credential keyed by the HOST it opens, under a map whose own name says what it holds - composer's auth.json
// (`github-oauth: { github.com: <token> }`, `gitlab-token`, `bearer`).
const HOST_KEY = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?$/i;
const hostCredential = (parent, k, v) => HOST_KEY.test(k) && (credKey(parent) || /^bearer$/i.test(parent)) && holdsCredential(k, v);

// The dotted path of the first credential-shaped key holding a live string, or null. Depth-capped:
// a settings file is shallow, and the cap keeps a pathological JSON from costing the call.
// `labels`: the file is a translation bundle, where `password` / `token` / `secret` are UI STRINGS
// under their own English names. The key test cannot hold there - every label it matches is a
// label - so only a value that IS a credential counts: a known shape, a PEM key, a connection
// string's embedded password.
function secretKeyIn(node, prefix, depth, labels, parent = '') {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  for (const [k, v] of Object.entries(node)) {
    const here = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') {
      if ((!labels && ((credKey(k) && holdsCredential(k, v)) || hostCredential(parent, k, v))) || (labels && SECRET_SHAPE.test(v))
        || PEM_PRIVATE.test(v) || embeddedCredential(v)) return here;
    } else { const hit = secretKeyIn(v, here, depth + 1, labels, k); if (hit) return hit; }
  }
  return null;
}
const DOTENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
const unquote = (v) => v.trim().replace(/^(["'])(.*)\1$/, '$2');
// Lines split on CRLF as well as LF: DOTENV_LINE ends in `(.*)$` and `.` never crosses a line
// terminator, so a Windows-authored .env split on `\n` alone matched NO line - a live key passed
// and --presence reported every key absent (reproduced with a CRLF fixture).
const LINES = /\r?\n/;
function secretLineIn(text) {
  for (const line of text.split(LINES)) {
    const m = line.match(DOTENV_LINE);
    if (m && ((credKey(m[1]) && holdsCredential(m[1], unquote(m[2]))) || embeddedCredential(unquote(m[2])))) return m[1];
  }
  return null;
}
// The credential files that are neither JSON nor dotenv, each read into [name, value] pairs that the content test,
// --presence and --redacted all share. 2.1.6 read INI - `~/.aws/credentials`, `~/.pypirc`, any file whose first line
// is a `[section]`, and `~/.npmrc`, whose keys are `//host/:_authToken` - netrc (`~/.netrc`, `_netrc`) and a URL per
// line (`~/.git-credentials`). Measured: `cat ~/.aws/credentials` printed the secret raw, its first line a section
// header, so neither test above ever read it. The concerns round closed every other format a credential ships in:
// `.pgpass`, `.htpasswd`, YAML (a kubeconfig, gh's hosts.yml, `.yarnrc.yml`, gem credentials, a Kubernetes Secret, a
// compose environment list, bundler's config), XML (maven's settings.xml and settings-security.xml, a NuGet.Config, a
// web.config connection string, a publish profile), HCL (`.terraformrc`, `*.tf`, `*.tfvars`), properties and the
// other INI spellings by name (`.properties`, `.cnf`, `.conf`, `.toml`, `.s3cfg`, `.boto`), yarn v1's space pairs, a
// private key file (PEM, OpenSSH, PuTTY, GnuPG), a token file (`.vault-token`) and a binary key store (`.p12`, `.pfx`,
// `.jks`, `.keystore`, `.kdbx`, `.mylogin.cnf`). A pair's third field says how its value is judged: absent, by its
// key; `pos`, by its POSITION (a `.pgpass` password field, an `.htpasswd` hash, a Secret's data); `always`, the whole
// file is the credential (a private key). A key that NAMES a key (`signingkey`, `publickey`, .NET's `publicKeyToken`)
// holds none.
const INI_SECTION = /^\s*\[([^\]\n]+)\]\s*$/;
const INI_LINE = /^\s*([A-Za-z_][\w.-]*|\/\/[^=\s]+)\s*[=:]\s*(.*)$/;
const COMMENT_LINE = /^\s*(?:[#;]|$)/;
const URL_CRED = /^\s*[a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:([^@\s/]+)@([^\s/:?#]+)\S*\s*$/i;
const NETRC_FILE = /(?:^|[\\/])[._]netrc$/i;
const NPMRC_FILE = /(?:^|[\\/])\.npmrc$/i;
const NAMES_A_KEY = /(?:^|[._-])(?:signing|public|pub)[_-]?key$|publickeytoken$/i;
const KEY_STORE = 'key store';
const KEYSTORE_FILE = /\.(?:p12|pfx|jks|jceks|keystore|bks|kdbx)$|^\.mylogin\.cnf$|^(?:credentials|access_tokens)\.db$/i;
const PEM_BEGIN_LINE = /^\s*-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----\s*$/;
const GPG_PRIVATE = /^\s*(?:Key:\s*)?\((?:\d+:)?(?:protected-)?private-key\b/m;
const PPK_HEAD = /^PuTTY-User-Key-File-\d+:/;
const HCL_BLOCK = /^\s*([\w-]+)((?:\s+"[^"]*")*)\s*\{\s*$/;
const YAML_KEY_LINE = /^\s*(?:"[^"]*"|'[^']*'|[^\s#'"{}[\]|>!&*%@,=][^#=]*?)\s*:(?:\s|$)/;
const baseOf = (file) => pathMod.basename(String(file));
const extOf = (file) => { const b = baseOf(file); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };
function kindByName(file) {
  const b = baseOf(file).toLowerCase();
  const e = extOf(file);
  if (/^(?:\.pgpass|pgpass\.conf)$/.test(b)) return 'pgpass';
  if (/(?:^|\.)htpasswd$/.test(b)) return 'htpasswd';
  if (NETRC_FILE.test(String(file))) return 'netrc';
  if (b === '.vault-token') return 'token';
  if (b === '.yarnrc') return 'spaced';
  if (NPMRC_FILE.test(String(file))) return 'ini';
  if (/^(?:\.terraformrc|terraform\.rc)$/.test(b) || /^(?:tf|tfvars|hcl)$/.test(e)) return 'hcl';
  if (/^ya?ml$/.test(e) || /(?:^|[\\/])\.bundle[\\/]config$/i.test(String(file))) return 'yaml';
  if (/^(?:xml|config|pubxml|publishsettings)$/.test(e)) return 'xml';
  if (e === 'ppk') return 'ppk';
  if (/^(?:ini|cfg|cnf|properties|toml|conf)$/.test(e) || /^\.(?:s3cfg|boto|pypirc|gitconfig|databrickscfg)$/.test(b)) return 'ini';
  return null;
}
function kindByContent(text, meaningful, file) {
  const first = meaningful[0];
  const e = extOf(file);
  if (PEM_BEGIN_LINE.test(first) || (/^(?:pem|key)$/.test(e) && (PEM_PRIVATE.test(text) || GPG_PRIVATE.test(text)))) return 'pem';
  if (PPK_HEAD.test(first)) return 'ppk';
  if (INI_SECTION.test(first)) return 'ini';
  if (/^\s*(?:machine\s+\S|default(?:\s+(?:login|password|account)\b|\s*$))/.test(first)) return 'netrc';
  if (meaningful.every((l) => URL_CRED.test(l))) return 'urls';
  if (meaningful.length === 1 && /^\s*\S+\s*$/.test(first) && SECRET_SHAPE.test(first)) return 'token';
  // The shapes below are read only in a file with no extension (a kubeconfig, `.gem/credentials`): in a source file or
  // a document the same first line is code or prose.
  if (e || DOTENV_LINE.test(first)) return null;
  if (/^\s*</.test(first)) return 'xml';
  if (HCL_BLOCK.test(first)) return 'hcl';
  if (/^---\s*$/.test(first) || YAML_KEY_LINE.test(first)) return 'yaml';
  return null;
}
const CONF_SPACED = /^\s*([A-Za-z_][\w.-]*)\s+("[^"]*"|[^\s;]+);?\s*$/;
const iniPairs = (lines, meaningful, text, file) => {
  const out = [];
  const spaced = extOf(file) === 'conf';
  let section = '';
  for (const l of lines) {
    if (COMMENT_LINE.test(l)) continue;
    const sec = l.match(INI_SECTION);
    if (sec) {
      // a gitconfig `[url "https://user:<token>@host/"]` carries its credential in the section's own name, so the
      // section is named by its masked spelling, in its own pair and every key under it
      const raw = sec[1].trim();
      section = embeddedCredential(raw) ? maskEmbedded(raw, () => '<set>') : raw;
      if (section !== raw) out.push([section, raw]);
      continue;
    }
    const m = l.match(INI_LINE) || (spaced && l.match(CONF_SPACED));
    if (!m) continue;
    const v = unquote(m[2]);
    if (section) out.push([`${section}.${m[1]}`, v]);
    out.push([m[1], v]);
  }
  return out;
};
const netrcPairs = (lines, meaningful) => {
  const toks = meaningful.join(' ').split(/\s+/).filter(Boolean);
  const out = [];
  let machine = 'default';
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t === 'machine') { machine = toks[++i] || machine; continue; }
    if (t === 'default') { machine = 'default'; continue; }
    if (/^(?:login|password|account)$/.test(t) && i + 1 < toks.length) { const v = toks[++i]; out.push([`${machine}.${t}`, v]); out.push([t, v]); }
  }
  return out;
};
// `.pgpass`: `host:port:database:user:password`, a `\:` or `\\` escaped inside a field.
const pgpassSplit = (line) => {
  const fields = [''];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && i + 1 < line.length) { fields[fields.length - 1] += line[++i]; continue; }
    if (line[i] === ':' && fields.length < 5) { fields.push(''); continue; }
    fields[fields.length - 1] += line[i];
  }
  return fields;
};
const pgpassPairs = (lines, meaningful) => meaningful.map(pgpassSplit).filter((f) => f.length === 5).map((f) => [f.slice(0, 4).join(':'), f[4], 'pos']);
const HTPASSWD_LINE = /^\s*([^:\s#]+):(\S+)\s*$/;
const htpasswdPairs = (lines, meaningful) => meaningful.map((l) => l.match(HTPASSWD_LINE)).filter(Boolean).map((m) => [m[1], m[2], 'pos']);
// yarn v1's `.yarnrc`: `key value`, either side quoted.
const SPACED_LINE = /^(\s*)("[^"]*"|[^\s"]+)(\s+)("[^"]*"|\S+)(\s*)$/;
const spacedPairs = (lines, meaningful) => meaningful.map((l) => l.match(SPACED_LINE)).filter(Boolean).map((m) => [unquote(m[2]), unquote(m[4])]);
const PPK_PRIVATE = /^Private-Lines:\s*(\d+)\s*$/;
const ppkPairs = (lines) => {
  const i = lines.findIndex((l) => PPK_PRIVATE.test(l));
  return i < 0 ? [] : [['private key', lines.slice(i + 1, i + 1 + Number(lines[i].match(PPK_PRIVATE)[1])).join(''), 'always']];
};
const pemPairs = (lines, meaningful, text) => [['private key', text.trim(), 'always']];
const tokenPairs = (lines, meaningful) => [['token', meaningful[0].trim(), 'pos']];
const urlPairs = (lines, meaningful) => {
  const out = [];
  for (const l of meaningful) { const m = l.match(URL_CRED); out.push([m[2], m[1]]); out.push(['password', m[1]]); }
  return out;
};
// YAML, read by indentation: a mapping key adds a segment to the path, a list item adds none (`users.user.token` in a
// kubeconfig), a `- KEY=VALUE` item is a pair of its own (a compose environment list), a block scalar (`key: |`) is
// one value, and a one-line flow map (`{user: a, password: b}`) its pairs. A Kubernetes Secret's `data` /
// `stringData` values are credentials by position, and so are bundler's host keys (`BUNDLE_GEMS__EXAMPLE__COM`).
const YAML_KEY = /^("((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)'|((?:[^\s#'"{}[\]|>!&*%@,]|-(?=\S))[^#]*?))\s*:(?:\s+(.*?))?\s*$/;
const YAML_ITEM = /^-(?:\s+|$)/;
const YAML_BLOCK = /^[|>][+-]?\d*(?:\s+#.*)?$/;
const yamlScalar = (raw) => {
  let v = String(raw || '').trim().replace(/^(?:!!?\S*\s+|&\S+\s+)+/, '');
  if (/^\*/.test(v)) return null; // an alias carries no value of its own
  if (/^"/.test(v)) { const m = v.match(/^"((?:[^"\\]|\\.)*)"/); return m ? m[1] : v.slice(1); }
  if (/^'/.test(v)) { const m = v.match(/^'((?:[^']|'')*)'/); return m ? m[1].replace(/''/g, "'") : v.slice(1); }
  return v.replace(/\s+#.*$/, '').trim();
};
const BUNDLER_HOST = /^BUNDLE_(?!BUILD__|MIRROR__)\S*__\S+$/;
// a list's items are credentials when the list is named for them, singular or plural (`tokens:`, `api_keys:`)
const listOfCredentials = (name) => [name, name.replace(/s$/i, '')].some((n) => credKey(n) && !NAMES_A_KEY.test(n));
function yamlPairs(lines, meaningful, text, file) {
  const out = [];
  const stack = [];
  let doc = 0;
  const secretDocs = new Set();
  const bundler = /(?:^|[\\/])\.bundle[\\/]config$/i.test(String(file));
  const push = (path, leaf, v) => {
    const mode = bundler && BUNDLER_HOST.test(leaf) ? 'pos' : undefined;
    out.push([path, v, mode, doc]);
    if (path !== leaf) out.push([leaf, v, mode, doc]);
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^---(?:\s|$)/.test(line)) { doc++; stack.length = 0; continue; }
    if (COMMENT_LINE.test(line) || /^\.\.\.\s*$/.test(line)) continue;
    let indent = line.match(/^\s*/)[0].length;
    let c = line.slice(indent);
    let item = false;
    while (YAML_ITEM.test(c)) { const w = c.match(YAML_ITEM)[0].length; indent += w; c = c.slice(w); item = true; }
    while (stack.length && stack[stack.length - 1][0] >= indent) stack.pop();
    const parent = stack.map((s) => s[1]);
    const m = c.match(YAML_KEY);
    if (!m) {
      if (!item || !c) continue;
      const kv = c.match(/^([A-Za-z_][\w.-]*)=(.*)$/);
      if (kv) push([...parent, kv[1]].join('.'), kv[1], unquote(kv[2]));
      else if (parent.length && listOfCredentials(parent[parent.length - 1])) { const v = yamlScalar(c); if (v) out.push([parent.join('.'), v, 'pos', doc]); }
      continue;
    }
    const key = (m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3].replace(/''/g, "'") : m[4]).replace(/^:(?=\S)/, '');
    const path = [...parent, key].join('.');
    const rest = m[5] || '';
    if (!rest || /^#/.test(rest)) { stack.push([indent, key]); continue; }
    if (YAML_BLOCK.test(rest)) {
      const body = [];
      while (i + 1 < lines.length && (!lines[i + 1].trim() || lines[i + 1].match(/^\s*/)[0].length > indent)) body.push(lines[++i]);
      const cut = Math.min(...body.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length), Infinity);
      push(path, key, body.map((l) => l.slice(Number.isFinite(cut) ? cut : 0)).join('\n').trim());
      continue;
    }
    const flow = rest.match(/^\{(.*)\}\s*(?:#.*)?$/);
    if (flow) {
      for (const part of flow[1].split(',')) { const f = part.match(/^\s*([^:]+?)\s*:\s*(.*?)\s*$/); if (f) push(`${path}.${unquote(f[1])}`, unquote(f[1]), yamlScalar(f[2])); }
      continue;
    }
    const v = yamlScalar(rest);
    if (v === null) continue;
    if (!parent.length && key === 'kind' && v === 'Secret') secretDocs.add(doc);
    push(path, key, v);
  }
  return out.map(([k, v, mode, d]) => [k, v, mode || (secretDocs.has(d) && /^(?:string)?[dD]ata\./.test(k) ? 'pos' : undefined)]);
}
// XML: an element's text by its nested path (`settings.servers.server.password`), a `key="K" value="V"` or
// `name="K" value="V"` pair (a NuGet.Config, an appSettings block, a Spring bean property), a connection string by
// its `name` (a web.config), and any attribute whose own name is credential-shaped (`password="..."`, a publish
// profile's `userPWD`). maven's settings-security.xml keeps its master password under `master`.
const XML_TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<[?!][\s\S]*?>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const XML_ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const xmlText = (s) => s.replace(/&(lt|gt|amp|quot|apos);/g, (all, e) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" })[e]);
const localName = (n) => n.replace(/^[\w.-]+:/, '');
const PAIR_NAME_ATTR = /^(?:key|name)$/i;
const PLAIN_ATTR = /^(?:key|name|value|id|type)$/i;
// The pairs one element's attributes carry: [name, value, attribute-to-mask].
function xmlAttrPairs(attrText) {
  const attrs = [...String(attrText || '').matchAll(XML_ATTR)].map((a) => [localName(a[1]), xmlText(a[2] !== undefined ? a[2] : a[3])]);
  const get = (re) => { const a = attrs.find(([n]) => re.test(n)); return a ? a[1] : undefined; };
  const out = [];
  const pairName = get(PAIR_NAME_ATTR);
  const value = get(/^value$/i);
  if (pairName !== undefined && value !== undefined) out.push([pairName, value, 'value']);
  const cs = get(/^connectionString$/i);
  if (pairName !== undefined && cs !== undefined) out.push([pairName, cs, 'connectionString']);
  for (const [n, v] of attrs) if (!PLAIN_ATTR.test(n) && !/^connectionString$/i.test(n)) out.push([n, v, n]);
  return out;
}
const xmlMaster = (file, name) => /^settings-security\.xml$/i.test(baseOf(file)) && name === 'master';
function xmlPairs(lines, meaningful, text, file) {
  const out = [];
  const stack = [];
  let buf = '';
  for (const m of text.matchAll(XML_TOKEN)) {
    if (m[1] !== undefined) { buf += m[1]; continue; }
    if (m[6] !== undefined) { buf += xmlText(m[6]); continue; }
    if (!m[3]) continue;
    const name = localName(m[3]);
    if (m[2]) {
      const top = stack.pop();
      const v = buf.trim();
      if (top && !top.child && v) {
        const p = [...stack.map((s) => s.name), top.name].join('.');
        const mode = xmlMaster(file, top.name) ? 'pos' : undefined;
        out.push([p, v, mode]);
        if (stack.length) out.push([top.name, v, mode]);
      }
      buf = '';
      continue;
    }
    if (stack.length) stack[stack.length - 1].child = true;
    const parent = stack.map((s) => s.name);
    for (const [k, v, attr] of xmlAttrPairs(m[4])) {
      const own = attr === 'value' || attr === 'connectionString' ? k : `${name}.${k}`;
      out.push([[...parent, own].join('.'), v]);
      out.push([k, v]);
    }
    if (!m[5]) stack.push({ name, child: false });
    buf = '';
  }
  return out.filter((p, i, all) => all.findIndex((q) => q[0] === p[0] && q[1] === p[1]) === i);
}
// HCL: a block's labels (or its type when it has none) are its segment - `credentials "app.terraform.io" { token =
// "..." }` is `app.terraform.io.token` - and only a QUOTED value is a value: `password = var.db_password` is an
// expression naming a variable, never a credential.
const HCL_OBJ = /^\s*([\w.-]+|"[^"]+")\s*=\s*\{\s*$/;
const HCL_ATTR = /^(\s*)([\w.-]+|"[^"]+")(\s*=\s*)"((?:[^"\\]|\\.)*)"(\s*(?:(?:#|\/\/).*)?)$/;
function hclPairs(lines) {
  const out = [];
  const stack = [];
  for (const l of lines) {
    if (/^\s*(?:#|\/\/|$)/.test(l)) continue;
    let m = l.match(HCL_BLOCK);
    if (m) { const labels = [...m[2].matchAll(/"([^"]*)"/g)].map((x) => x[1]); stack.push(labels.length ? labels.join('.') : m[1]); continue; }
    if ((m = l.match(HCL_OBJ))) { stack.push(unquote(m[1])); continue; }
    if (/^\s*\}[\s,]*$/.test(l)) { stack.pop(); continue; }
    if ((m = l.match(HCL_ATTR))) {
      const k = unquote(m[2]);
      out.push([[...stack, k].join('.'), m[4]]);
      if (stack.length) out.push([k, m[4]]);
    }
  }
  return out;
}
const READERS = {
  ini: iniPairs, netrc: netrcPairs, urls: urlPairs, pgpass: pgpassPairs, htpasswd: htpasswdPairs, spaced: spacedPairs,
  ppk: ppkPairs, pem: pemPairs, token: tokenPairs, yaml: yamlPairs, xml: xmlPairs, hcl: hclPairs,
};
function otherPairs(text, file) {
  const lines = text.split(LINES);
  const meaningful = lines.filter((l) => !COMMENT_LINE.test(l));
  if (!meaningful.length) return null;
  const kind = kindByName(file) || kindByContent(text, meaningful, file);
  return kind ? { kind, pairs: READERS[kind](lines, meaningful, text, file) } : null;
}
const pairHoldsCredential = (k, v) => (credKey(k) && !NAMES_A_KEY.test(k) && holdsCredential(k, v)) || embeddedCredential(v) || PEM_PRIVATE.test(String(v));
const pairCounts = ([k, v, mode]) => (mode === 'always' ? isLive(v) : mode === 'pos' ? holdsCredential('password', v) : pairHoldsCredential(k, v));
// A key store is judged by its KIND, never its bytes: a PKCS#12, JKS or KeePass file is binary, and printing it hands
// the chat what an offline attack needs.
const isKeyStore = (file) => KEYSTORE_FILE.test(baseOf(file));
// Judge one file by CONTENT: the key that makes it a credential file, or null. JSON first (a
// settings.json, .mcp.json, appsettings.json), then the formats above, then dotenv (a `.conf` holding `export
// KEY=value` lines is read both ways); anything else - source code, docs - is never a credential file here (source
// dumps are guard-read-whole-file's concern).
// A translation bundle's own tree: `src/assets/i18n/en.json`, `locales/uk/common.json`. The path
// is the only tell a one-word label has, and a stack that keeps credentials in a locales directory
// is a shape nobody ships - the accepted gap is stated rather than guessed at.
const TRANSLATION_PATH = /(?:^|[\\/])(?:i18n|locales?|translations?|lang|langs)[\\/]/i;
const dotenvShaped = (text, file) => DOTENV_LINE.test(text.split(LINES).find((l) => l.trim() && !l.trim().startsWith('#')) || '') && !NPMRC_FILE.test(String(file));
// A credential file is text in the encoding its writer chose: Windows PowerShell 5 writes UTF-16LE with a BOM, and those
// bytes read as UTF-8 never form a KEY=value line (review item 5 of 2.1.6). A BOM decides it; without one, NUL bytes on
// every other position of the first 64 bytes and none on the rest decide it. Every route reads through here - the
// content judgment, the presence read and the redacted view.
function swap16(buf) { const b = Buffer.from(buf.subarray(0, buf.length - (buf.length % 2))); return b.swap16(); }
function readText(file) {
  const buf = fs.readFileSync(file);
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) return swap16(buf.subarray(2)).toString('utf16le');
  const head = buf.subarray(0, 64);
  if (head.length >= 4) {
    let even = 0; let odd = 0;
    for (let i = 0; i < head.length; i++) if (head[i] === 0) { if (i % 2) odd++; else even++; }
    const half = head.length >> 1;
    if (even === 0 && odd >= half * 0.9) return buf.toString('utf16le');
    if (odd === 0 && even >= half * 0.9) return swap16(buf).toString('utf16le');
  }
  return buf.toString('utf8').replace(/^\uFEFF/, '');
}
function secretIn(file) {
  let text;
  if (TEMPLATE_FILE.test(pathMod.basename(String(file)))) return null;
  try {
    const size = fs.statSync(file).size;
    if (size > 0 && isKeyStore(file)) return KEY_STORE;
    if (size > MAX_BYTES) return null;
    text = readText(file);
  } catch { return null; }
  try { return secretKeyIn(JSON.parse(text), '', 0, TRANSLATION_PATH.test(String(file))); } catch { /* not JSON */ }
  const other = otherPairs(text, file);
  if (other) for (const p of other.pairs) if (pairCounts(p)) return p[0];
  return dotenvShaped(text, file) ? secretLineIn(text) : null;
}

// Git Bash / MSYS spell a Windows path in POSIX mount form (`/c/Users/...`), which node on win32
// resolves against the CURRENT drive instead. Translate before resolving; off Windows the spelling
// is a real POSIX path and is never touched.
// The translation is shell-writes.js's one home (2.1.5 M8); without the module a path is taken as written.
let nativePath = (p) => String(p);
try { ({ nativePath } = require(pathMod.join(__dirname, 'shell-writes.js'))); } catch { /* an install without it */ }
const HOME = os.homedir() || '';
const accountDir = () => process.env.CLAUDE_CONFIG_DIR || pathMod.join(HOME, '.claude');
// The variables a credential path is spelled with (`~`, $HOME, $CLAUDE_PROJECT_DIR,
// $CLAUDE_CONFIG_DIR - also in the `${VAR:-default}` form), PLUS the NAME=value assignments the
// command itself makes: `f=<file>; cat $f` put the path one segment away from the token scan and
// nothing judged it. Values are lists because `for f in <glob>` binds several. Any other `$` is an
// unexpanded variable this guard cannot judge (the cross-project guard's rule) - the token is
// skipped rather than guessed at.
const VARS = new Map([
  ['HOME', [HOME]],
  // The WINDOWS spelling of the same directory. Without it `$USERPROFILE/.claude/settings.json`
  // kept a `$` through expandPath, which returns null for any surviving variable, so the account
  // file on every Windows install was never judged at all - the one platform where the path is
  // routinely written that way. Measured: a live token printed from that path in a Windows session.
  ['USERPROFILE', [process.env.USERPROFILE || HOME]],
  ['CLAUDE_PROJECT_DIR', [process.env.CLAUDE_PROJECT_DIR || '']],
  ['CLAUDE_CONFIG_DIR', [accountDir()]],
]);
const KNOWN_VARS = () => { const o = {}; for (const [k, v] of VARS) o[k] = v[0]; return o; };
// A runtime heredoc body under a QUOTED tag reaches the runtime verbatim, and node, python and ruby never expand
// `$NAME` - it is the script's own text, not a path it opens (proven: `node <<'EOF'` reading
// "$CLAUDE_CONFIG_DIR/.claude.json" gets ENOENT on that literal path, the unquoted tag reads the account file). Measured
// (2.1.6 K1): test text naming it inside a `node - <<'EOF'` script that WROTE a test file was blocked as a read of the
// account file. So while such a body is judged, only the names its code reads from the environment expand
// (`const D = process.env.CLAUDE_CONFIG_DIR` then `${D}` spelled with that name); null everywhere else.
let verbatimVars = null;
const expands = (name) => !verbatimVars || verbatimVars.has(name);
function expandPath(token) {
  const known = KNOWN_VARS();
  if (known.PWD == null) known.PWD = cwdAnchor || (payload && payload.cwd) || process.cwd(); // where the shell stands
  let p = String(token).replace(/^["'`]|["'`]$/g, '').replace(/^~(?=\/|$)/, HOME);
  p = p.replace(/\$\{(\w+)(?::-[^}]*)?\}|\$(\w+)/g, (m, a, b) => (expands(a || b) && known[a || b] != null ? known[a || b] : m));
  // `my\ dir/settings.json` is one token the shell hands over with the space intact.
  return /\$/.test(p) ? null : nativePath(p.replace(/\\ /g, ' '));
}
// A variable bound to several paths (a `for` list) becomes several tokens; a single value is left
// to expandPath. Capped - a fan-out is a convenience, not a search.
function fanOut(token) {
  const out = [];
  const re = /\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/;
  const walk = (t, depth) => {
    if (out.length >= 20) return;
    const m = t.match(re);
    const vals = m && expands(m[1] || m[2]) && VARS.get(m[1] || m[2]);
    if (!vals || vals.length < 2 || depth > 2) { out.push(t); return; }
    for (const v of vals) walk(t.slice(0, m.index) + v + t.slice(m.index + m[0].length), depth + 1);
  };
  walk(String(token), 0);
  return out;
}
let payload; // set below; resolveFile reads its cwd
// A `cd` earlier in the command moves the anchor for everything after it (the house pattern is
// guard-cross-project-write.js): `cd .claude && cat settings-secret.json` named no path the scan
// could resolve. The default anchors stay in the list - a cd this guard cannot follow (`cd -`, an
// unexpanded variable) leaves the judgement exactly where it was, never worse.
let cwdAnchor = null;
// Where judgeShell is: the command, and the segment / stage whose verdict is about to rewrite it - read by
// refuseDroppedSteps, which must know what the rewrite would throw away.
let judging = null;
// The anchors a relative path is tried against. A payload field is attacker-shaped input, not a
// promise: a non-string `cwd` reached pathMod.join and threw ERR_INVALID_ARG_TYPE, and a hook that
// exits 1 fails OPEN - the dump it was judging ran (review finding, reproduced with `"cwd": 5`).
const anchorDirs = () => [...new Set([cwdAnchor, process.env.CLAUDE_PROJECT_DIR, payload && payload.cwd, process.cwd()]
  .filter((d) => typeof d === 'string' && d))]; // deduped - the project dir and the cwd are usually one directory, listed once
// The account dir is an anchor only for a segment that SPELLS it (`os.homedir()`, `expanduser('~')`,
// `$USERPROFILE`) with a bare settings file name - the runtime shape that builds the path at run
// time and hands the scan no path at all.
let homeAnchor = false;
const ACCOUNT_FILE = /^settings(?:\.local)?\.json$/;

// Brace alternatives (`{settings,x}.json`) - one group per pass, no whitespace or quotes inside,
// which keeps a JSON literal out of the expansion. The cap binds the WORKLIST, not just the result:
// the recursive form capped what it pushed but not what it visited, and 26 groups cost 23s against
// the hook's 10s timeout, which fails open (re-review). A pass costs at most 20 strings, and the
// alternatives past the cap are dropped - a 20-way brace is noise, not a path a model types.
const BRACE_GROUP = /\{([^{}\s"']*,[^{}\s"']*)\}/;
function expandBraces(p) {
  let out = [p];
  for (;;) {
    const next = [];
    let expanded = false;
    for (const s of out) {
      const m = s.match(BRACE_GROUP);
      if (!m) { next.push(s); continue; }
      expanded = true;
      for (const alt of m[1].split(',')) {
        if (next.length < 20) next.push(s.slice(0, m.index) + alt + s.slice(m.index + m[0].length));
      }
    }
    out = next;
    if (!expanded) return out;
  }
}
const GLOB_CHARS = /[*?[]/;
const globToRe = (pat) => new RegExp('^' + pat.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$');
// `cat .env*` and `cat .claude/*.json` name the file as surely as spelling it out. ONE directory
// listing per glob token - the first anchor that has a match wins, and only the LAST path component
// may glob (a glob in a directory component would need a walk, and this hook runs on every Bash call).
function globPaths(p) {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  const dirPart = idx >= 0 ? p.slice(0, idx) : '';
  const pat = idx >= 0 ? p.slice(idx + 1) : p;
  if (!GLOB_CHARS.test(pat) || GLOB_CHARS.test(dirPart)) return [];
  let re;
  try { re = globToRe(pat); } catch { return []; }
  const dirs = dirPart === '' ? anchorDirs()
    : pathMod.isAbsolute(dirPart) ? [dirPart] : anchorDirs().map((d) => pathMod.join(d, dirPart));
  for (const d of dirs) {
    let names;
    try { names = fs.readdirSync(d); } catch { continue; }
    const hits = names.slice(0, 200).filter((n) => re.test(n)).map((n) => pathMod.join(d, n));
    if (hits.length) return hits;
  }
  return [];
}
// One token -> every path it can name: a list variable's values, brace alternatives, glob matches.
function candidatePaths(token) {
  const out = [];
  for (const t of fanOut(token)) {
    const p = expandPath(t);
    if (!p) continue;
    for (const b of expandBraces(p)) {
      if (GLOB_CHARS.test(b)) out.push(...globPaths(b));
      else if (b) out.push(b);
    }
  }
  return out;
}
function statFile(p) {
  const cands = pathMod.isAbsolute(p) ? [p]
    : (homeAnchor && ACCOUNT_FILE.test(p) ? [pathMod.join(accountDir(), p)] : []).concat(anchorDirs().map((d) => pathMod.join(d, p)));
  for (const c of cands) { try { if (fs.statSync(c).isFile()) return c; } catch { /* next anchor */ } }
  return null;
}
function resolveFile(token) {
  for (const p of candidatePaths(token)) { const f = statFile(p); if (f) return f; }
  return null;
}

// ---- the user's own allowance for THIS session -------------------------------------------------
// A block or a redacted view ends in an ask, and the 'show or use it' answer has to be honourable or
// the ask offers a route this guard then denies. A remote user cannot run the copy-ready command in
// their own terminal - the bare denial took the decision away from them. So the answer is a receipt
// this guard reads: <docs-path>/flow/SECRET-READ-ALLOW, one entry per line ('#' comments allowed) -
// a file path (that file may be read or dumped), a variable NAME (that variable may be printed), or
// `*` (everything, this session). Session-scoped the way the dispatch guard's APPROVAL stamp is:
// older than 8h, or written before this session began (the transcript's birthtime where the
// filesystem reports a real one), reads as absent. While any entry is live the credential-literal
// check is relaxed too - the value the user chose to expose may be placed into a file. The default
// stays the redacted view: a model improvising a presence check is still the measured incident.
const MAX_RECEIPT_AGE_MS = 8 * 60 * 60 * 1000;
const realOf = (p) => { try { return fs.realpathSync(p); } catch { return pathMod.resolve(p); } };
function readReceipt(root, transcriptPath) {
  const r = { path: pathMod.resolve(root, docsRootEnv(), 'flow', 'SECRET-READ-ALLOW'), stale: false, all: false, files: new Set(), names: new Set(), live: false };
  try {
    const st = fs.statSync(r.path);
    let sessionStartMs = 0;
    try {
      const t = fs.statSync(String(transcriptPath || ''));
      sessionStartMs = t.birthtimeMs && t.birthtimeMs !== t.ctimeMs ? t.birthtimeMs : 0;
    } catch { sessionStartMs = 0; }
    if (Date.now() - st.mtimeMs > MAX_RECEIPT_AGE_MS || (sessionStartMs && st.mtimeMs < sessionStartMs)) {
      r.stale = true;
    } else {
      for (const rawLine of fs.readFileSync(r.path, 'utf8').split(LINES)) {
        const e = rawLine.trim();
        if (!e || e.startsWith('#')) continue;
        if (e === '*') r.all = true;
        else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(e)) r.names.add(e);
        else {
          const p = expandPath(e);
          if (p) r.files.add(realOf(pathMod.isAbsolute(p) ? p : pathMod.join(anchorDirs()[0] || process.cwd(), p)));
        }
      }
    }
  } catch { /* absent or unreadable - no allowance recorded */ }
  r.live = r.all || r.files.size > 0 || r.names.size > 0;
  return r;
}
// The one sentence every denial and every redacted view ends on: the block or the placeholder is the
// default, the user's answer is honoured. It names the RESOLVED receipt path - the docs root may be
// absolute, and a relative spelling of it is one the model would have to re-anchor.
const askLine = (r) =>
  'If the VALUE itself is what the user needs - shown to them, or placed where a blind copy (jq ... > file, cp, sed -i) ' +
  'cannot reach - do not decide for them: end this turn with ONE AskUserQuestion carrying, in this order, ' +
  "'Presence only (Recommended)', 'Show or use the value this session - it enters the transcript permanently', 'Drop it'. " +
  `On the second answer write the receipt ${r.path} with the file path, the variable NAME, or \`*\` (everything, this session) ` +
  'on its own line, then retry; it is honoured for this session only, under 8h' +
  (r.stale ? ' - the receipt there now is stale (older than 8h, or written before this session began), so rewrite it only on a fresh answer' : '') + '.';
// A note the rewritten call prints as its first line, so the model reads what happened and the route
// to the value in the same tool result - nothing is fed back through a denial.
const noteLine = (what, r) => `# credential guard: ${what} A value never enters the chat. ${askLine(r)}`;
// Inside a double-quoted shell string: the three characters bash still reads there, and a backslash
// only where bash would read IT - before one of those, before another backslash, or at the end. A
// Windows path's own backslashes stay as they are: doubling every one named `D:\\a\\...` for
// `D:\a\...` (measured on windows-latest), a path that is not the file's.
const shDouble = (s) => String(s).replace(/\\(?=["$`\\]|$)|["$`]/g, (c) => '\\' + c);
const SECRET_SHAPE_G = new RegExp(SECRET_SHAPE.source, 'g');
// A value is masked when its KEY is credential-shaped and it holds a credential, or when the value
// itself has a known credential SHAPE (or is a PEM private key) whatever the key - the cases the key test
// cannot see. A password inside a larger value is masked in place by maskEmbedded instead.
const maskable = (k, v) => typeof v === 'string' && ((credKey(k) && !NAMES_A_KEY.test(k) && holdsCredential(k, v)) || SECRET_SHAPE.test(v) || PEM_PRIVATE.test(v));
// The redacted view of a text credential file that is not JSON: every line as written, a credential value masked
// where it stands - the value of a pair the reader judged a credential (so a Secret's data, a `.pgpass` password and a
// bundler host key are masked by the same judgement that flagged them), a credential-shaped key's value, a private
// key's body line by line (its BEGIN and END kept), a connection string's or URL's password and any credential shape.
const PEM_END = /-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/;
const XML_ATTR_AT = /([^\s=<>/"']+)(\s*=\s*)(["'])([^"']*)\3/g;
const XML_LEAF = /(<([A-Za-z_][\w:.-]*)(?:\s[^<>]*)?>)([^<]+)(<\/\2\s*>)/g;
const indentOf = (line) => line.match(/^\s*/)[0];
// the index just past the 4th unescaped `:` of a `.pgpass` line - where its password starts
const pgpassCut = (line) => { let n = 0; for (let i = 0; i < line.length; i++) { if (line[i] === '\\') { i++; continue; } if (line[i] === ':' && ++n === 4) return i + 1; } return -1; };
// One XML line with its credential values masked: an element's text under a credential-shaped name (or maven's
// settings-security `master`), the `value` of a `key` / `name` pair naming a credential, a credential-shaped
// attribute, a connection string's password, and - in the redacted view, where `creds` holds what the reader judged -
// any attribute value or bare text line the reader counted (a tag spread over several lines).
const XML_TAG = /<[A-Za-z_][\w:.-]*((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))+)\s*\/?>/g;
function maskXmlLine(line, mask, creds, file) {
  line = line.replace(XML_LEAF, (all, open, tag, txt, close) => {
    const v = xmlText(txt.trim());
    return v && (creds.has(v) || maskable(localName(tag), v) || xmlMaster(file, localName(tag))) ? open + txt.replace(txt.trim(), mask(v)) + close : all;
  });
  line = line.replace(XML_TAG, (tag, attrs) => (xmlAttrPairs(attrs).some(([k, v, attr]) => attr === 'value' && v && !NAMES_A_KEY.test(k) && maskable(k, v))
    ? tag.replace(/(\svalue\s*=\s*)(["'])([^"']*)\2/i, (all, head, q, raw) => `${head}${q}${mask(xmlText(raw))}${q}`) : tag));
  line = line.replace(XML_ATTR_AT, (all, n, eq, q, raw) => {
    const name = localName(n);
    const v = xmlText(raw);
    if (/^connectionString$/i.test(name)) return `${n}${eq}${q}${maskEmbedded(v, mask)}${q}`;
    if (v && (creds.has(v) || (!PLAIN_ATTR.test(name) && !NAMES_A_KEY.test(name) && maskable(name, v)))) return `${n}${eq}${q}${mask(v)}${q}`;
    return all;
  });
  // an element's text on a line of its own (`<password>` above it, `</password>` below)
  if (!/[<>]/.test(line) && line.trim() && creds.has(xmlText(line.trim()))) return `${indentOf(line)}${mask(xmlText(line.trim()))}`;
  return line;
}
// HCL's embedded pass reads quoted strings only: `password = var.db_password` is an expression, not a `password=` pair
const maskQuotedEmbedded = (line, mask) => line.replace(/"((?:[^"\\]|\\.)*)"/g, (all, v) => `"${maskEmbedded(v, mask)}"`);
function maskFormatText(text, file, mask, count) {
  const other = otherPairs(text, file);
  const kind = other ? other.kind : null;
  // the values judged whole - by key, position or kind; a password INSIDE a value is masked in place by the passes below
  const creds = new Set(other ? other.pairs.filter((p) => (p[2] ? pairCounts(p) : (credKey(p[0]) && !NAMES_A_KEY.test(p[0]) && holdsCredential(p[0], p[1])) || PEM_PRIVATE.test(String(p[1])))).map((p) => String(p[1])) : []);
  const credValue = (k, v) => v !== '' && v !== null && (creds.has(v) || maskable(k, v));
  const dotenvToo = !kind || kind === 'ini' || kind === 'netrc' || kind === 'urls' || dotenvShaped(text, file);
  const lines = text.split(LINES);
  let pem = false;
  let gpg = false;
  let ppk = 0;
  let block = -1; // the indent of a YAML key whose block scalar holds a credential
  const keyLine = (line) => { count(); return `${indentOf(line)}<private key line>`; };
  const out = lines.map((raw, idx) => {
    let line = raw;
    if (pem) { if (PEM_END.test(line)) { pem = false; return line; } return line.trim() ? keyLine(line) : line; }
    if (gpg) return line.trim() ? keyLine(line) : line;
    if (ppk > 0) { ppk--; return keyLine(line); }
    if (block >= 0) {
      if (!line.trim() || indentOf(line).length > block) {
        if (PEM_PRIVATE.test(line) && !PEM_END.test(line)) { pem = true; return line; }
        return !line.trim() || PEM_END.test(line) ? line : `${indentOf(line)}${mask(line.trim())}`;
      }
      block = -1;
    }
    if (PEM_PRIVATE.test(line) && !PEM_END.test(line)) pem = true;
    // a comment or blank line takes only the passes at the end
    const k = COMMENT_LINE.test(line) && kind !== 'xml' ? null : kind;
    if (k === 'pem' && GPG_PRIVATE.test(line)) { gpg = true; count(); return line.replace(/^(\s*(?:Key:\s*)?).*$/, '$1<private key line>'); }
    if (k === 'ppk') {
      const p = line.match(PPK_PRIVATE);
      if (p) { ppk = Number(p[1]); return line; }
      const mac = line.match(/^(Private-MAC:\s*)(\S+)/);
      if (mac) return mac[1] + mask(mac[2]);
    }
    if (k === 'token') return line.replace(/\S+/, (v) => (holdsCredential('password', v) ? mask(v) : v));
    if (k === 'pgpass') {
      const f = pgpassSplit(line);
      const cut = pgpassCut(line);
      if (f.length === 5 && cut > 0 && holdsCredential('password', f[4])) return line.slice(0, cut) + mask(f[4]);
    }
    if (k === 'htpasswd') {
      const h = line.match(HTPASSWD_LINE);
      if (h && holdsCredential('password', h[2])) return line.slice(0, line.indexOf(':') + 1) + mask(h[2]);
    }
    if (k === 'spaced') {
      const s = line.match(SPACED_LINE);
      if (s && credValue(unquote(s[2]), unquote(s[4]))) return `${s[1]}${s[2]}${s[3]}${/^"/.test(s[4]) ? `"${mask(unquote(s[4]))}"` : mask(s[4])}${s[5]}`;
    }
    if (k === 'hcl') {
      const h = line.match(HCL_ATTR);
      if (h && credValue(unquote(h[2]), h[4])) return `${h[1]}${h[2]}${h[3]}"${mask(h[4])}"${h[5]}`;
      return maskQuotedEmbedded(line, mask).replace(SECRET_SHAPE_G, (x) => mask(x));
    }
    if (k === 'xml') return maskEmbedded(maskXmlLine(line, mask, creds, file), mask).replace(SECRET_SHAPE_G, (x) => mask(x));
    if (k === 'yaml') {
      const lead = line.match(/^\s*(?:-(?:\s+|$))*/)[0];
      const c = line.slice(lead.length);
      const item = /-/.test(lead);
      const kv = item && c.match(/^([A-Za-z_][\w.-]*)=(.*)$/);
      if (kv) return credValue(kv[1], unquote(kv[2])) ? `${lead}${kv[1]}=${mask(unquote(kv[2]))}` : line;
      const m = c.match(YAML_KEY);
      if (m) {
        const key = (m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4]).replace(/^:(?=\S)/, '');
        const rest = m[5] || '';
        if (YAML_BLOCK.test(rest)) {
          const body = [];
          for (let j = idx + 1; j < lines.length && (!lines[j].trim() || indentOf(lines[j]).length > lead.length); j++) body.push(lines[j]);
          const cut = Math.min(...body.filter((l) => l.trim()).map((l) => indentOf(l).length), Infinity);
          const v = body.map((l) => l.slice(Number.isFinite(cut) ? cut : 0)).join('\n').trim();
          if (credValue(key, v)) block = lead.length;
          return line;
        }
        const flow = rest.match(/^\{(.*)\}/);
        if (flow) {
          const at = line.lastIndexOf(rest);
          return line.slice(0, at) + rest.replace(/([{,]\s*)([^:,{}]+?)(\s*:\s*)([^,{}]+?)(\s*)(?=[,}])/g,
            (all, a, k, s, v, t) => (credValue(unquote(k), yamlScalar(v)) ? `${a}${k}${s}${mask(yamlScalar(v))}${t}` : all));
        }
        const v = yamlScalar(rest);
        if (v && credValue(key, v)) { const at = line.lastIndexOf(rest); return line.slice(0, at) + rest.replace(v, () => mask(v)) + line.slice(at + rest.length); }
        return maskEmbedded(line, mask).replace(SECRET_SHAPE_G, (x) => mask(x));
      }
      if (item && c && creds.has(yamlScalar(c))) return `${lead}${mask(yamlScalar(c))}`;
    }
    if (k === 'ini') {
      // as written, spacing and all: `aws_secret_access_key = <set (40 chars)>`
      const i = line.match(/^(\s*)([A-Za-z_][\w.-]*|\/\/[^=\s]+)(\s*[=:]\s*)(.*)$/);
      if (i && maskable(i[2], unquote(i[4]))) return `${i[1]}${i[2]}${i[3]}${mask(unquote(i[4]))}`;
      const sp = !i && extOf(file) === 'conf' && line.match(CONF_SPACED);
      if (sp && maskable(sp[1], unquote(sp[2]))) {
        const at = line.indexOf(sp[2], line.indexOf(sp[1]) + sp[1].length);
        return line.slice(0, at) + mask(unquote(sp[2])) + line.slice(at + sp[2].length);
      }
    }
    if (k === 'netrc') {
      line = line.replace(/(\b(?:password|account)\s+)(\S+)/g, (all, head, v) => (holdsCredential('password', v) ? head + mask(v) : all));
    }
    const m = dotenvToo ? line.match(DOTENV_LINE) : null;
    if (m && maskable(m[1], unquote(m[2]))) return `${m[1]}=${mask(unquote(m[2]))}`;
    if (m) { const v = unquote(m[2]); const inPlace = maskEmbedded(v, mask); if (inPlace !== v) return `${m[1]}=${inPlace}`; }
    // a URL on a line of its own (a git-credentials store); a dotenv pair was judged by its value above - `PWD=/home` is no password
    return (m ? line : maskEmbedded(line, mask)).replace(SECRET_SHAPE_G, (x) => mask(x));
  });
  return out.join('\n');
}


// ---- CLI mode: the sanctioned presence-only read --------------------------------------------
// `node guard-secret-value.js --presence <file> [KEY ...]` - what the denials and the guided
// commands name. Prints a length or `absent`, never a value; a missing file is reported, not thrown.
if (process.argv[2] === '--presence') {
  const fileArg = String(process.argv[3] || '');
  const keys = process.argv.slice(4);
  const file = nativePath(fileArg.replace(/^~(?=\/|$)/, HOME));
  const out = [];
  let text = null;
  let store = null; // a binary key store's size: it has one name, `key store`, and never a text reading
  try {
    if (isKeyStore(file)) store = fs.statSync(file).size;
    else text = readText(file);
  } catch { out.push(`# ${fileArg}: not found`); }
  if (store !== null) {
    for (const k of keys.length ? keys : [KEY_STORE]) out.push(k === KEY_STORE && store > 0 ? `${k}=set (${store} bytes)` : `${k}=absent`);
    process.stdout.write(out.join('\n') + '\n');
    process.exit(0);
  }
  let entries = {};
  let doc = null;
  let listed = null; // the names a keyless listing shows, for a format whose pairs carry two spellings
  if (text != null) {
    try {
      const j = JSON.parse(text);
      doc = j && typeof j === 'object' ? j : null;
      entries = (j && typeof j.env === 'object' && j.env) ? j.env : (j && typeof j === 'object' && !Array.isArray(j) ? j : {});
    } catch {
      const other = otherPairs(text, file);
      if (other) {
        // the first spelling wins: `default.aws_secret_access_key` before a later profile's bare key
        for (const [k, v] of other.pairs) if (!Object.prototype.hasOwnProperty.call(entries, k)) entries[k] = v;
        // a path, or a bare name no path ends in: `github.com.oauth_token`, never `oauth_token` beside it
        listed = other.pairs.map(([k]) => k).filter((k, i, all) => all.indexOf(k) === i && (other.kind === 'netrc' ? /\./.test(k)
          : other.kind === 'urls' ? k !== 'password' : /\./.test(k) || !all.some((x) => x.endsWith(`.${k}`))));
      }
      if (!other || dotenvShaped(text, file)) {
        for (const line of text.split(LINES)) {
          const m = line.match(DOTENV_LINE);
          if (m && !Object.prototype.hasOwnProperty.call(entries, m[1])) { entries[m[1]] = unquote(m[2]); if (listed && !listed.includes(m[1])) listed.push(m[1]); }
        }
      }
    }
  }
  // A KEY is looked up as written first (a settings.json's env block, a dotenv line, a top-level key), then as a
  // path from the root of a JSON file: `.`, `:` (.NET configuration) or `__` (its environment spelling) between the
  // parts, and a part may hold a dot itself (`Logging.LogLevel.Microsoft.Hosting.Lifetime`). Pilot 3 asked for
  // `ConnectionStrings.Lending` and `Notices.Gateway.ServiceToken` and was told both were absent.
  const own = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
  const walk = (node, parts) => {
    if (!parts.length) return { found: true, v: node };
    for (let i = parts.length; i >= 1; i--) {
      const key = parts.slice(0, i).join('.');
      if (own(node, key)) { const r = walk(node[key], parts.slice(i)); if (r.found) return r; }
    }
    return { found: false };
  };
  const lookup = (k) => (own(entries, k) ? { found: true, v: entries[k] } : doc ? walk(doc, k.split(/\.|:|__/)) : { found: false });
  const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
  const describe = (k, r) => {
    const v = r.found ? r.v : undefined;
    if (v === undefined || v === null) return `${k}=absent`;
    if (typeof v === 'string') return isLive(v) ? `${k}=set (${v.length} chars)` : isPlaceholder(v) ? `${k}=absent (placeholder ${v.trim()})` : `${k}=absent`;
    if (Array.isArray(v)) return `${k}=set (array, ${plural(v.length, 'item')})`;
    if (typeof v === 'object') return `${k}=set (object, ${plural(Object.keys(v).length, 'key')})`;
    return `${k}=set (${String(v).length} chars)`;
  };
  // No KEY: a settings.json's env block, or a dotenv, as before; any other JSON lists every string leaf as a path.
  const leaves = (node, prefix, acc) => {
    for (const [k, v] of Object.entries(node)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'string') acc.push(p);
      else if (v !== null && typeof v === 'object') leaves(v, p, acc);
    }
    return acc;
  };
  const names = keys.length ? keys
    : doc && entries === doc ? leaves(doc, '', [])
      : listed || Object.keys(entries).filter((k) => typeof entries[k] === 'string');
  // A key NAME can hold a credential shape (`users.ghp_...`), and a lockfile has thousands of leaves (review M5):
  // a printed name is masked, and the keyless listing stops at LEAF_CAP with a count.
  const LEAF_CAP = 200;
  const masked = (k) => k.replace(SECRET_SHAPE_G, (m) => `<credential-shaped, ${m.length} chars>`);
  const shown = keys.length ? names : names.slice(0, LEAF_CAP);
  for (const k of shown) { const line = describe(k, lookup(k)); out.push(masked(k) + line.slice(k.length)); }
  if (shown.length < names.length) out.push(`# ${names.length - shown.length} more string leaves not listed - name a KEY to read one`);
  process.stdout.write(out.length ? out.join('\n') + '\n' : '');
  process.exit(0);
}
// `node guard-secret-value.js --redacted <file>` - what a shell dump of a credential file is rewritten
// into: the file with every credential value replaced by `<set (N chars)>` and the rest as written
// (the hook wiring a session inspects in a settings.json, the non-secret keys of a dotenv), led by a
// note saying so and naming the route to the value. JSON is re-emitted from its parse; a dotenv is
// masked line by line, and a credential SHAPE anywhere in the text is masked whatever surrounds it.
// `--note-to-stderr` is the NARROW form a filtering read is rewritten into (`--redacted <file> --note-to-stderr |
// grep KEY`): the note leaves the pipe, so the command's own filter reads only the masked file.
if (process.argv[2] === '--redacted') {
  const fileArg = String(process.argv[3] || '');
  const filtered = process.argv[4] === '--note-to-stderr';
  const file = nativePath(fileArg.replace(/^~(?=\/|$)/, HOME));
  const receipt = readReceipt(process.env.CLAUDE_PROJECT_DIR || process.cwd(), null);
  let text = null;
  let out = '';
  try {
    const size = fs.statSync(file).size;
    if (size > 0 && isKeyStore(file)) {
      out = noteLine(`redacted view of ${file} - a binary key store, judged by its kind and never printed.` +
        ` Presence: node "${__filename}" --presence "${file}".`, receipt) + `\n<binary key store, ${size} bytes>\n`;
    } else if (size > MAX_BYTES) out = `# ${fileArg}: larger than ${MAX_BYTES} bytes - not a credential file this guard judges; read it in ranges\n`;
    else text = readText(file);
  } catch { out = `# ${fileArg}: not found\n`; }
  if (text != null) {
    let masked = 0;
    const mask = (v) => { masked++; return `<set (${v.length} chars)>`; };
    let body;
    try {
      const walk = (node, parent = '') => {
        if (typeof node === 'string') return SECRET_SHAPE.test(node) || PEM_PRIVATE.test(node) ? mask(node) : maskEmbedded(node, mask);
        if (Array.isArray(node)) return node.map((x) => walk(x, parent));
        if (node && typeof node === 'object') {
          const o = {};
          for (const [k, v] of Object.entries(node)) o[k] = maskable(k, v) || (typeof v === 'string' && hostCredential(parent, k, v)) ? mask(v) : walk(v, k);
          return o;
        }
        return node;
      };
      body = JSON.stringify(walk(JSON.parse(text)), null, 2) + '\n';
    } catch {
      body = maskFormatText(text, file, mask, () => { masked++; });
    }
    // The runnable presence command, absolute: the guard ships inside the plugin, and pilot 3's first presence call
    // guessed `.claude/hooks/`, where only the docs, memory and history engines are copied.
    const note = noteLine(`redacted view of ${file} - ${masked} credential value(s) shown as <set (N chars)>, everything else as written` +
      (filtered ? '; piped through the command\'s own filter, so line numbers count the view, not the file.' : '.') +
      ` Presence of one key: node "${__filename}" --presence "${file}" KEY (A.B.C reads a nested key).`, receipt);
    if (filtered) { process.stderr.write(note + '\n'); out = body; } else out = note + '\n' + body;
  }
  process.stdout.write(out);
  process.exit(0);
}
// `node guard-secret-value.js --redacted-env` - what a whole-environment dump is rewritten into: every
// variable as env prints it, a credential-shaped NAME holding a credential (or any value of a known
// credential shape) as `<set (N chars)>`. Accepted gap, stated: a credential under a name this
// pattern does not match and with no known shape prints as env would print it.
// `--note-to-stderr` is the filtered form (`--redacted-env --note-to-stderr | grep KEY`), as for a file.
if (process.argv[2] === '--redacted-env') {
  const filtered = process.argv[3] === '--note-to-stderr';
  const receipt = readReceipt(process.env.CLAUDE_PROJECT_DIR || process.cwd(), null);
  const lines = [];
  let masked = 0;
  for (const k of Object.keys(process.env).sort()) {
    const v = String(process.env[k]);
    if (maskable(k, v)) { masked++; lines.push(`${k}=<set (${v.length} chars)>`); } else lines.push(`${k}=${maskEmbedded(v, (x) => { masked++; return `<set (${x.length} chars)>`; })}`);
  }
  const note = noteLine(`the environment with ${masked} credential value(s) shown as <set (N chars)>, everything else as env prints it`
    + (filtered ? '; piped through the command\'s own filter.' : '.'), receipt);
  if (filtered) process.stderr.write(note + '\n');
  process.stdout.write((filtered ? '' : note + '\n') + lines.join('\n') + '\n');
  process.exit(0);
}

// The line masker the stream redactor below runs, and the shell route's git probe runs over the same text. One
// per stream: it carries the file a diff section is about (from its header) and whether it is inside a PEM
// private key. Masked: a credential-shaped key's value in a JSON pair, a dotenv line or a YAML pair - in a config
// file the diff header names, or anywhere when no header was seen (`git show HEAD:<file>`) - a URL's password
// everywhere, a connection string's `Password=` in config files, a known credential SHAPE anywhere, and every
// line between a PEM private key's BEGIN and END. A diff's own prefix (`+`, `-`, ` `, `< `, `> `) stays. A
// declaration, so the shell branch below can call it; everything it reads is initialised above this line.
function lineRedactor() {
  let masked = 0;
  const mask = (v) => { masked++; return `<set (${v.length} chars)>`; };
  // a config file by its extension, a dotfile or a file with no extension (`.pgpass`, `.kube/config`, `credentials`)
  const CONFIG_FILE = /(?:^|\/)(?:\.env[^/]*|[^/.]+|\.[^/.]+|[^/]*\.(?:json|jsonc|json5|ya?ml|ini|toml|properties|conf|config|cfg|cnf|env|tfvars|tf|hcl|xml|pubxml|publishsettings|ppk))$/i;
  const JSON_PAIR = /("((?:[^"\\]|\\.)*)"\s*:\s*")((?:[^"\\]|\\.)*)"/g;
  const YAML_PAIR = /^(\s*(?:-\s+)?)(:?[A-Za-z_][\w.-]*|"[^"]*"|'[^']*')(\s*:\s+)(['"]?)([^\s'"#][^#]*?)\4(\s*(?:#.*)?)$/;
  const YAML_ENV_ITEM = /^(\s*-\s+)([A-Za-z_][\w.-]*)=(.*)$/;
  const NONE = new Set();
  let file = null;
  let kind = null;
  let pem = false;
  let gpg = false;
  let ppk = 0;
  const reset = (f) => { file = f; kind = f ? kindByName(f) : null; pem = false; gpg = false; ppk = 0; };
  const keyLine = (pre, cr) => { masked++; return `${pre}<private key line>${cr}`; };
  const line = (raw) => {
    const cr = raw.endsWith('\r') ? '\r' : '';
    const text = cr ? raw.slice(0, -1) : raw;
    if (/^commit [0-9a-f]{7,}\b/.test(text)) { reset(null); return raw; }
    const header = text.match(/^(?:\+\+\+ b\/|diff --git a\/.* b\/)(.+)$/);
    if (header) { reset(header[1]); return raw; }
    const [, pre, body] = text.match(/^((?:[+\- ]|[<>] )?)([\s\S]*)$/);
    if (pem) {
      if (PEM_END.test(body)) pem = false;
      else if (body.trim()) return keyLine(pre, cr);
      return raw;
    }
    if (gpg || ppk > 0) {
      if (ppk > 0) ppk--;
      return body.trim() ? keyLine(pre, cr) : raw;
    }
    if (GPG_PRIVATE.test(body)) { gpg = true; masked++; return `${pre}${body.replace(/^(\s*(?:Key:\s*)?).*$/, '$1<private key line>')}${cr}`; }
    let out = body;
    const p = kind === 'ppk' && out.match(PPK_PRIVATE);
    if (p) ppk = Number(p[1]);
    if (kind === 'ppk') out = out.replace(/^(Private-MAC:\s*)(\S+)/, (all, head, v) => head + mask(v));
    if (kind === 'pgpass' && !COMMENT_LINE.test(out)) {
      const f = pgpassSplit(out);
      const cut = pgpassCut(out);
      if (f.length === 5 && cut > 0 && holdsCredential('password', f[4])) out = out.slice(0, cut) + mask(f[4]);
    }
    if (kind === 'htpasswd') {
      const h = out.match(HTPASSWD_LINE);
      if (h && holdsCredential('password', h[2])) out = out.slice(0, out.indexOf(':') + 1) + mask(h[2]);
    }
    if (kind === 'token' && !COMMENT_LINE.test(out)) out = out.replace(/\S+/, (v) => (holdsCredential('password', v) ? mask(v) : v));
    if (kind === 'spaced') {
      const s = out.match(SPACED_LINE);
      if (s && maskable(unquote(s[2]), unquote(s[4]))) out = `${s[1]}${s[2]}${s[3]}${/^"/.test(s[4]) ? `"${mask(unquote(s[4]))}"` : mask(s[4])}${s[5]}`;
    }
    if (kind === 'xml') out = maskXmlLine(out, mask, NONE, file);
    if (file === null || CONFIG_FILE.test(file)) {
      out = out.replace(JSON_PAIR, (all, head, k, v) => (maskable(k, v) ? `${head}${mask(v)}"` : all));
      // an HCL attribute only in an HCL file: a headerless `git show <rev>:install.sh` holds `    AUTH="oauth"   # ...`
      const h = kind === 'hcl' && out.match(HCL_ATTR);
      if (h && maskable(unquote(h[2]), h[4])) out = `${h[1]}${h[2]}${h[3]}"${mask(h[4])}"${h[5]}`;
      // an HCL value is a value only when quoted: `password = var.db_password` names a variable
      const d = kind !== 'hcl' && out.match(DOTENV_LINE);
      if (d && maskable(d[1], unquote(d[2]))) out = `${out.slice(0, out.indexOf('=') + 1)}${mask(unquote(d[2]))}`;
      const y = out.match(YAML_PAIR);
      if (y && maskable(unquote(y[2]).replace(/^:/, ''), y[5])) out = `${y[1]}${y[2]}${y[3]}${y[4]}${mask(y[5])}${y[4]}${y[6]}`;
      const e = out.match(YAML_ENV_ITEM);
      if (e && maskable(e[2], unquote(e[3]))) out = `${e[1]}${e[2]}=${mask(unquote(e[3]))}`;
      out = kind === 'hcl' ? maskQuotedEmbedded(out, mask) : maskEmbedded(out, mask);
    } else {
      out = out.replace(EMBEDDED_URL, (all, head, val) => (holdsCredential('password', val) ? head + mask(val) : all));
    }
    out = out.replace(SECRET_SHAPE_G, (x) => mask(x));
    if (PEM_PRIVATE.test(out) && !PEM_END.test(out)) pem = true;
    return `${pre}${out}${cr}`;
  };
  return { line, masked: () => masked };
}

// `<git dump> | node guard-secret-value.js --redact-stdin` - what a git command that PRINTS file content is
// rewritten into (`git diff`, `git show`, `git log -p`, `git stash show -p`; I2, 2.1.4 audit): replayed at
// 23c24b9d, each printed a tracked appsettings.json's ClientSecret raw, and alfred-security.md runs
// `git add -N . && git diff HEAD` over every security-relevant change. A stream filter: the output is masked
// line by line as it passes (lineRedactor above), synchronously - fd reads, so no code below this block runs -
// and with no size cap. The note goes to STDERR, only when something was masked.
if (process.argv[2] === '--redact-stdin') {
  const red = lineRedactor();
  const write = (fd, text) => {
    const buf = Buffer.from(text, 'utf8');
    for (let off = 0; off < buf.length;) {
      try { off += fs.writeSync(fd, buf, off); }
      catch (e) { if (e.code === 'EAGAIN') continue; process.exit(0); } // EPIPE: the reader (a `head`) is done
    }
  };
  const decoder = new (require('string_decoder').StringDecoder)('utf8'); // a character split across two reads
  const chunk = Buffer.alloc(64 * 1024);
  let rest = '';
  for (;;) {
    let n;
    try { n = fs.readSync(0, chunk, 0, chunk.length, null); }
    catch (e) {
      if (e.code === 'EAGAIN') continue;
      if (e.code !== 'EOF') write(2, `# credential guard: the stream stopped at a read error (${e.code || 'unknown'}) - the output above is all of it.\n`);
      break; // what was not read was never printed, so stopping leaks nothing
    }
    if (!n) break;
    const lines = (rest + decoder.write(chunk.subarray(0, n))).split('\n');
    rest = lines.pop();
    if (lines.length) write(1, lines.map(red.line).join('\n') + '\n');
  }
  rest += decoder.end();
  if (rest) write(1, red.line(rest));
  if (red.masked()) {
    const receipt = readReceipt(process.env.CLAUDE_PROJECT_DIR || process.cwd(), null);
    write(2, noteLine(`${red.masked()} credential value(s) in this output shown as <set (N chars)>, everything else as git printed it.`, receipt) + '\n');
  }
  process.exit(0);
}

try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0); // unparseable stdin - don't block
}
if (!payload || typeof payload !== 'object') process.exit(0); // a JSON scalar/null - nothing to judge

// --- block telemetry (shared by every guard hook; keep the copies identical) ------------
// A block costs a whole turn - the stderr goes back to the model and the work is re-done - so a
// FALSE positive is 10-100x the cost of the gate itself, and until this existed the block rate was
// the one number the stack could not measure (measured 2026-09-04: the hooks emit ~22-25ms and
// nothing else). One JSONL row per block, written where the tool-usage instrument writes, so
// scripts/analyze-usage.js can tally both from the same docs root. Best-effort in every direction:
// telemetry never changes the verdict and never throws.
(() => {
  let last = '';
  const w = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => { last = String(chunk); return w(chunk, ...rest); };
  const exit = process.exit.bind(process);
  process.exit = (code) => {
    if (code === 2 && !unsetRepo) {
      try {
        const fs = require('fs');
        const path = require('path');
        const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
        // resolve, NOT join: an ABSOLUTE ALFRED_CODE_DOCS_PATH makes path.join('/a/b','/x/y')
        // '/a/b/x/y', so every ledger row landed in a doubled path that nothing reads (measured
        // across all ten guards). resolve honours an absolute value and still joins a relative one.
        const dir = path.resolve(root, docsRootEnv(), 'hook-blocks');
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(path.join(dir, `${String(payload.session_id || 'nosession').replace(/[^\w.-]/g, '_')}.jsonl`), JSON.stringify({
          ts: new Date().toISOString(),
          hook: path.basename(__filename),
          event: payload.hook_event_name || payload.tool_name || '',
          tool: payload.tool_name || '',
          reason: last.split('\n')[0].slice(0, 200),
          // A hook may name the BRANCH that fired and what matched, when it has more than one
          // (`global.BLOCK_DETAIL`, dropped by JSON.stringify when nothing set it). A block whose
          // cause cannot be reconstructed cannot be tuned - this is the field that reconstructs it.
          detail: global.BLOCK_DETAIL || undefined,
        }) + '\n');
      } catch { /* telemetry is never allowed to break the gate */ }
    }
    exit(code);
  };
})();

// One MEASUREMENT row for a rewrite (2.1.5 M17): the shell route's main verdict is the rewrite, not a block, so
// the block rate alone never said how often the model reaches for a value. A `mode` row, which the analyzer
// reads as a probe and never as a block; tool, branch and a file's BASENAME only - never the value. A repo never
// set up gets none (R54), like a block. Best-effort - a lost row is a lost measurement, never a changed verdict.
function rewriteRow(detail) {
  if (unsetRepo) return;
  try {
    const dir = pathMod.resolve(process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd(), docsRootEnv(), 'hook-blocks');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(pathMod.join(dir, `${String(payload.session_id || 'nosession').replace(/[^\w.-]/g, '_')}.jsonl`), JSON.stringify({
      ts: new Date().toISOString(), hook: pathMod.basename(__filename), event: payload.hook_event_name || payload.tool_name || '',
      tool: payload.tool_name || '', mode: 'rewrite', reason: `rewrite: ${detail.branch}`, detail,
    }) + '\n');
  } catch { /* never throws */ }
}

const input = payload.tool_input || {};
const receipt = readReceipt(process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd(), payload.transcript_path);
const receiptLive = receipt.live;
const allowAll = receipt.all;
const allowedNames = receipt.names;
const fileAllowed = (file) => allowAll || receipt.files.has(realOf(file));
const secretInUnlessAllowed = (file) => (fileAllowed(file) ? null : secretIn(file));
// Every denial ends in the ask mandate: the block is the default, the user's answer is honoured.
const askHint = () => '\nIf PRESENCE answers the question, take the presence route and do not ask. ' + askLine(receipt) + '\n';
const block = (msg) => { process.stderr.write(msg + askHint()); process.exit(2); };
// The shell route's verdict: the call is REPLACED (hookSpecificOutput.updatedInput) by one that
// prints the placeholder form, and the tool runs that instead - no denial, no retried turn, and the
// note on its first line carries the route to the value. Not a block: it costs no turn, so it writes a
// `mode: rewrite` row (rewriteRow), counted apart from the block rate. `updatedInput` REPLACES the tool's
// arguments (code.claude.com/docs/en/hooks), so every other field - timeout, description,
// run_in_background - is carried over.
const rewrite = (command, detail) => {
  rewriteRow(detail);
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { ...input, command } } }));
  process.exit(0);
};
const presenceHint = (file) =>
  `Per alfred-security.md a credential is read for PRESENCE only:\n` +
  `  node "${__filename}" --presence "${file}" [KEY ...]   ->  KEY=set (N chars) | KEY=absent\n` +
  `A shell dump of it - cat "${file}" - is rewritten into the redacted view for free:\n` +
  `  node "${__filename}" --redacted "${file}"   ->  the file, every credential value shown as <set (N chars)>\n` +
  `Never echo the value, never pass it to a tool, never ask for it in the chat - the user sets it in\n` +
  `the file by hand. A credential in a PROJECT settings.json belongs in the ACCOUNT file\n` +
  `(~/.claude/settings.json, or the space's): only that env reaches .mcp.json expansion.\n`;

// The verbs that print a file, and the runtimes whose inline reads do the same with a different
// spelling. `grep` is a dump verb: `grep -n SENTRY settings.json` prints the value's whole line.
// The second half of the list is the review's: `tac`, `base64`, `xxd` and friends print the same
// bytes in a different order or encoding, and a dump verb only matters when its file token holds a
// live credential, so the false-positive cost of a long list is nil. `cp` and `dd` are NOT here -
// `cp .env .env.bak` is a legitimate backup, and it prints nothing. The PowerShell spellings
// (`Get-Content` and its `gc` / `type` aliases, `Select-String`, `Format-Hex`, `Import-Csv`) are the
// same reads - measured 2026-09-15, `Get-Content .env` printed the value in real pwsh - and cmdlet
// names are case-insensitive, so the whole list is.
// The comparison verbs (I2, 2.1.4 audit) print both operands' differing lines - `diff .env .env.example` is the
// ordinary 'which keys am I missing' move - and `rev` prints every line backwards; a hyphen ends none of them, so
// `git rev-parse` is no `rev`. A git dump (`git diff <file>`) is not judged here: it is piped through the stream
// redactor where it stands (redactGitStages), and only a git stage left unpiped (`--stat`) falls to this list.
const DUMP_VERB = /\b(?:cat|head|tail|sed|less|more|[gmn]?awk|jq|bat|strings|grep|rg|egrep|fgrep|tac|nl|pr|od|xxd|hexdump|base64|paste|fold|column|sort|uniq|cut|tee|get-content|gc|type|select-string|sls|format-hex|import-csv)\b|(?<![\w-])(?:diff|sdiff|cmp|comm|rev)(?![\w-])/i;
const RUNTIME = /\b(?:node|python3?|perl|ruby|deno|bun|pwsh|powershell|php)\b/;
// ---- the routes that print a file under another verb's name (review item 5 of 2.1.6) ----------------------------------
// dd's `if=`, iconv, the text filters (expand, unexpand, fmt), the gzip readers that pass a plain file through (`zcat -f`),
// look, split onto a device or a filter, curl on a file:// URL, sqlite3's readfile() / .read / .shell, a copy onto a terminal
// device, and vim / ex. Each names the files it PRINTS: output sent to a file (`of=`, `-o`, `-O`, a copy's destination)
// prints nothing, and vim's ex mode prints only on a print command.
const FILE_ROUTE = /^(?:dd|iconv|expand|unexpand|fmt|zcat|gzcat|zmore|zless|look|split|gsplit|curl|sqlite3|cp|gcp|vim?|nvim|gvim|rvim|ex|view|rview)$/i;
const TERMINAL_OUT = /^\/dev\/(?:std(?:out|err)|tty|fd\/[12])$/;
const unq = (w) => String(w == null ? '' : w).replace(/^["']|["']$/g, '');
// A command's words split into operands and flag values: `short` lists the one-letter flags that take a value (the rest of
// the bundle, or the next word), `long` the long ones (`--x=v` or `--x v`). A redirect word is neither.
function operandsOf(args, short, long = /^$/) {
  const ops = [];
  const vals = [];
  for (let i = 0; i < args.length; i++) {
    const w = unq(args[i]);
    if (/^\d*[<>]/.test(args[i])) { if (/^\d*[<>]+&?$/.test(args[i])) i++; continue; }
    if (w === '--') { ops.push(...args.slice(i + 1).map(unq)); break; }
    if (w === '-' || !w.startsWith('-')) { ops.push(w); continue; }
    if (w.startsWith('--')) {
      const eq = w.indexOf('=');
      const name = eq < 0 ? w : w.slice(0, eq);
      vals.push([name, eq >= 0 ? w.slice(eq + 1) : long.test(name) ? unq(args[++i]) : null]);
      continue;
    }
    for (let j = 1; j < w.length; j++) {
      if (!short.includes(w[j])) { vals.push(['-' + w[j], null]); continue; }
      vals.push(['-' + w[j], j + 1 < w.length ? w.slice(j + 1) : unq(args[++i])]);
      break;
    }
  }
  const val = (...names) => { const v = vals.find(([n]) => names.includes(n)); return v ? v[1] : undefined; };
  return { ops, vals, val };
}
// vim and its kin: the files it opens, whether the run prints them and whether it writes. With no terminal the full-screen
// editor paints the file into the output; ex mode (`-e`, `-es`, `ex`) prints only on a print command (`%p`, `g/x/p`,
// `%#`, `w !cat`, `w /dev/stdout`) - or on commands the guard cannot see, a `-S` / `-s` script or a heredoc.
const VIM_PRINTS = /(?:^|[\s|%$.,;\d/])(?:p|pr|print|P|Print|nu|number|#|l|list|z|echo|echon|echom|echomsg|echoerr|redir|w\s*!|w(?:rite)?\s+(?:>>\s*)?\/dev\/(?:stdout|stderr|tty|fd\/[12]))(?=$|[\s|!])/;
const VIM_WRITES = /(?:^|[\s|%])(?:w|write|wq|wqa|wqall|x|xa|xit|xall|exi|exit|up|update|sav|saveas|wa|wall|wn|wN|wp)!?(?=$|\s*\||\s+[^!\s])/;
function vimRun(verb, args) {
  const cmds = [];
  const files = [];
  let ex = /^ex$/i.test(verb);
  let unseen = false;
  let headless = false;
  for (let i = 0; i < args.length; i++) {
    const raw = args[i];
    const w = unq(raw);
    if (/^\d*<</.test(raw) || /^\d*<$/.test(raw)) { unseen = true; if (/^\d*<$/.test(raw)) i++; continue; }
    if (/^\d*[<>]/.test(raw)) { if (/^\d*[<>]+&?$/.test(raw)) i++; continue; }
    if (w.startsWith('+')) { cmds.push(w.slice(1)); continue; }
    if (w === '--') { files.push(...args.slice(i + 1).map(unq)); break; }
    if (w === '-') continue;
    if (w === '--cmd') { cmds.push(unq(args[++i])); continue; }
    if (w === '--headless') { headless = true; continue; }
    if (w.startsWith('--')) continue;
    if (w.startsWith('-')) {
      const flag = w.slice(1);
      if (flag === 'c') { cmds.push(unq(args[++i])); continue; }
      if (flag === 'S') { unseen = true; i++; continue; }
      if (/^[uUiTwWtq]$/.test(flag)) { i++; continue; }
      if (flag === 's' && !ex) { unseen = true; i++; continue; } // Normal mode's `-s {scriptin}`
      if (/[eE]/.test(flag)) ex = true;
      continue;
    }
    files.push(w);
  }
  const prints = (!ex && !headless) || unseen || cmds.some((c) => VIM_PRINTS.test(c));
  return { files, prints, writes: cmds.some((c) => VIM_WRITES.test(c)) };
}
function routeFiles(verb, args) {
  const v = verb.toLowerCase().replace(/^g(?=split$|cp$)/, '');
  if (v === 'dd') {
    const kv = (k) => { const w = args.map(unq).find((a) => a.startsWith(k + '=')); return w === undefined ? null : w.slice(k.length + 1); };
    const from = kv('if'); const to = kv('of');
    return from && (to == null || TERMINAL_OUT.test(to)) ? [from] : [];
  }
  if (/^(?:vim?|nvim|gvim|rvim|ex|view|rview)$/.test(v)) { const r = vimRun(v, args); return r.prints ? r.files : []; }
  if (v === 'iconv') {
    const o = operandsOf(args, 'fto', /^--(?:from-code|to-code|output)$/);
    const out = o.val('-o', '--output');
    return out !== undefined && !TERMINAL_OUT.test(out || '') ? [] : o.ops;
  }
  if (v === 'look') return operandsOf(args, 't').ops.slice(1); // the first operand is the prefix
  if (v === 'split') {
    const o = operandsOf(args, 'abClnpt', /^--(?:suffix-length|bytes|line-bytes|lines|number|additional-suffix|separator|filter)$/);
    const chunk = o.val('-n', '--number');
    const prints = o.val('--filter') !== undefined || /\//.test(chunk || '') || /^\/dev\//.test(o.ops[1] || '');
    return prints && o.ops[0] && o.ops[0] !== '-' ? [o.ops[0]] : [];
  }
  if (v === 'cp') {
    const o = operandsOf(args, 'St', /^--(?:target-directory|suffix)$/);
    const target = o.val('-t', '--target-directory');
    if (target !== undefined) return TERMINAL_OUT.test(target || '') ? o.ops : [];
    return o.ops.length >= 2 && TERMINAL_OUT.test(o.ops[o.ops.length - 1]) ? o.ops.slice(0, -1) : [];
  }
  if (v === 'curl') {
    const o = operandsOf(args, 'AbcCdDeEFHKmoPQrtTuUwxXyYz', /^--(?:url|output)$/);
    const out = o.vals.filter(([n]) => n === '-o' || n === '--output');
    if (o.vals.some(([n]) => /^(?:-O|--remote-name|--remote-name-all)$/.test(n)) || out.some(([, w]) => w !== '-' && !TERMINAL_OUT.test(w || ''))) return [];
    const urls = [...o.ops, ...o.vals.filter(([n]) => n === '--url').map(([, w]) => w || '')];
    return urls.filter((u) => /^file:/i.test(u)).map((u) => { const p = u.replace(/^file:(?:\/\/(?:localhost)?)?/i, ''); try { return decodeURIComponent(p); } catch { return p; } });
  }
  if (v === 'sqlite3') {
    const texts = [];
    const files = [];
    let db = false;
    for (let i = 0; i < args.length; i++) {
      const w = unq(args[i]);
      if (/^\d*[<>]/.test(args[i])) { if (/^\d*[<>]+&?$/.test(args[i])) i++; continue; }
      if (/^--?(?:cmd)$/.test(w)) { texts.push(unq(args[++i])); continue; }
      if (/^--?init$/.test(w)) { files.push(unq(args[++i])); continue; }
      if (/^--?(?:separator|newline|nullvalue|escape|maxsize|mmap|pagecache|lookaside|heap|vfs|zip)$/.test(w)) { i++; continue; }
      if (w.startsWith('-')) continue;
      if (!db) { db = true; continue; }
      texts.push(w);
    }
    for (const t of texts) {
      for (const m of t.matchAll(/\breadfile\s*\(\s*(?:'((?:[^']|'')*)'|"([^"]*)")/gi)) files.push(m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2]);
      for (const line of t.split(/\r?\n|;(?=\s*\.)/)) {
        const dot = /^\s*\.(shell|system|read)\s+([\s\S]*)$/.exec(line);
        if (dot && dot[1] === 'read') files.push(unq(dot[2].trim()));
        else if (dot) spawnedShell.push(dot[2]);
      }
    }
    return files;
  }
  // expand, unexpand, fmt and the gzip readers: every operand is a file they print
  return operandsOf(args, { expand: 't', unexpand: 't', fmt: 'wgpdlt' }[v] || 'S', /^--(?:tabs|width|goal|prefix|suffix)$/).ops;
}
// A heredoc body is DATA, not shell: a plan that merely DESCRIBES `cat ~/.claude/settings.json` is
// inert text (reproduced against the sibling guards). The bodies are blanked by shell-writes.js's reader - the one
// the cross-project guard judges with - which keeps the character count, so any index into the command still
// holds, and keeps each heredoc's FIRST line: `cat <<'EOF'; cat <secret>` runs its second command on that line,
// and blanking the whole match hid it (2.1.6 K1). The EXCEPTION is a heredoc that feeds a runtime or a shell
// (`python3 - <<'EOF'`, `bash <<'EOF'`, `cat <<'EOF' | node`), where the body is the command and blanking it hid the
// dump completely (review finding). Those bodies come back in `code` to be judged as code.
// A copy that runs before shell-writes.js lands judges every body as code and every wrapper as a command word.
let blankHeredocs = (c) => c;
let heredocsOf = () => [];
let heredocBody = () => '';
let heredocVerbatim = () => false;
let heredocSubstitutions = () => [];
let commandIndex = () => 0;
try { ({ blankHeredocs, heredocsOf, heredocBody, heredocVerbatim, heredocSubstitutions, commandIndex } = require(pathMod.join(__dirname, 'shell-writes.js'))); } catch { /* an install without it */ }
// What reads a heredoc's body is the COMMAND of the stage holding the `<<`, or of a stage piped from it on the same
// line - a whole word, never a substring: `\bsh\b` matched the `.sh` of `cat > run.sh <<'EOF'`, so a script being
// WRITTEN was judged as one being run, and the write became a redacted dump (2.1.6 K1). A redirect target is the file
// written, never the reader.
const SHELL_WORD = /^(?:bash|sh|zsh|dash|ksh)(?:\.exe)?$/i;
const RUNTIME_WORD = /^(?:node|nodejs|python(?:\d+(?:\.\d+)?)?|perl|ruby|deno|bun|pwsh|powershell|php)(?:\.exe)?$/i;
function heredocReader(line, at) {
  const own = line.slice(0, at).split(/&&|\|\||;|\|/).pop();
  const piped = line.slice(at).split(/&&|\|\||;/)[0].split('|').slice(1);
  for (const stage of [own, ...piped]) {
    // a subshell, a substitution or a `NAME=` prefix opens the stage's first word: `x=$(python3 - <<'EOF'` (seam m1)
    const words = shellTokens(stage).map((w) => w.replace(/^(?:[A-Za-z_]\w*=)?(?:\$\(|[(`"'])+/, ''));
    for (let k = 0; k < words.length; k++) {
      if (/^\d*[<>]+&?$/.test(words[k])) { k++; continue; } // `> file`: the next word is the target
      if (/^\d*[<>]/.test(words[k])) continue; // `>file`, `2>&1`, `<<'EOF'`
      const word = words[k].replace(/^["']|["']$/g, '').replace(/^.*[\\/]/, '');
      if (RUNTIME_WORD.test(word)) return stdinIsScript(word, words.slice(k + 1)) ? `runtime:${runtimeLang(word)}` : null;
      if (SHELL_WORD.test(word)) return stdinIsScript(word, words.slice(k + 1)) ? 'shell' : null;
    }
  }
  return null;
}
// The language a runtime word runs, for reading the environment in its own spelling: '' for one with no table row.
function runtimeLang(word) {
  const w = String(word).replace(/^["']|["']$/g, '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '');
  return /^(?:node|nodejs|bun)$/i.test(w) ? 'node' : /^python/i.test(w) ? 'python' : /^ruby$/i.test(w) ? 'ruby' : /^perl$/i.test(w) ? 'perl' : /^php$/i.test(w) ? 'php' : '';
}
// Which STDIN_FLAGS row reads a heredoc reader's options; null for a runtime whose flags the table does not know
// (deno, bun, pwsh), whose body stays judged as code.
function stdinKind(word) {
  const w = word.replace(/\.exe$/i, '');
  return SHELL_WORD.test(w) ? 'shell' : /^node/i.test(w) ? 'node' : /^python/i.test(w) ? 'python' : /^ruby$/i.test(w) ? 'ruby' : /^perl$/i.test(w) ? 'perl' : /^php$/i.test(w) ? 'php' : null;
}
// The body is the program only when the program takes its SCRIPT from stdin: a script file named, or a script handed
// as -c / -e / -p / -m, makes the body that program's input data (`bash ./run.sh <<EOF`, `node -e '...' <<EOF`).
// An option's own value is no script file (`bash -euo pipefail`, `bash --rcfile x`, `node --stack-size 4096`,
// `python3 -X dev`). A runtime's `-` is stdin itself and the words after it are the script's argv
// (`python3 - out.txt <<EOF`); a shell's `-` or `--` only ends its options, so a next word is still a script file,
// while php's `--` hands the words after it to a script read from stdin (`php -- a b <<EOF`).
// Each interpreter's options, read the way its own parser does (review B1 of 2.1.6): a `script` letter takes the rest
// of its bundle or else the next word as the script, a `stdin` letter reads it from stdin, a `value` letter takes the
// rest of its bundle or else the next word, a `next` letter (a shell's o / O) takes the next word and lets the bundle
// go on (`-euo pipefail`), a `rest` letter takes only the rest of its bundle, a `digits` letter takes the digits
// after it and lets the bundle go on (`perl -lne`, `-0777ne`), a `flag` letter takes nothing. Long options:
// `longScript`, `longValue`, then `longFlag`. An option the table does not know is read as taking the next
// word, so a value is never mistaken for a script file - the body stays judged. A script option with no script
// word after it leaves the body judged too (`perl -we <<EOF`).
const STDIN_FLAGS = {
  shell: { script: 'c', stdin: 's', next: 'oO', value: '', rest: '', digits: '', flag: 'abBCDeEfhHiklmnpPrtTuvx',
    longScript: null, longValue: /^--(?:rcfile|init-file)$/,
    longFlag: /^--(?:debugger|dump-po-strings|dump-strings|help|login|noediting|noprofile|norc|posix|pretty-print|protected|restricted|verbose|version)$/ },
  node: { script: 'epc', stdin: '', next: '', value: 'rC', rest: '', digits: '', flag: 'ivh',
    longScript: /^--(?:eval|print|check)$/,
    longValue: /^--(?:experimental-(?:loader|default-type|config-file|sea-config|policy)|trace-event-(?:categories|file-pattern)|trace-require-module|inspect-port|allow-fs-(?:read|write))$/,
    longFlag: /^--(?:no-[\w-]+|experimental-[\w-]+|trace-[\w-]+|inspect(?:-brk|-wait)?|harmony[\w-]*|allow-[\w-]+|watch(?:-preserve-output)?|test(?:-only|-update-snapshots|-force-exit)?|enable-source-maps|abort-on-uncaught-exception|preserve-symlinks(?:-main)?|pending-deprecation|throw-deprecation|expose-gc|expose-internals|frozen-intrinsics|heap-prof|cpu-prof|insecure-http-parser|jitless|force-fips|enable-fips|interactive|prof|prof-process|report-on-signal|report-uncaught-exception|report-on-fatalerror|report-compact|zero-fill-buffers|permission|use-openssl-ca|use-bundled-ca|use-system-ca|openssl-legacy-provider|openssl-shared-config|build-snapshot|entry-url|strip-types|v8-options|version|help|completion-bash)$/ },
  python: { script: 'cm', stdin: '', next: '', value: 'WXQ', rest: '', digits: '', flag: 'bBdEhiIOPqRsSuvVx?',
    longScript: null, longValue: /^--check-hash-based-pycs$/, longFlag: /^--(?:help(?:-[\w-]+)?|version)$/ },
  ruby: { script: 'e', stdin: '', next: '', value: 'rICE', rest: 'FiKTWx', digits: '0', flag: 'acdlnpsSvwyUh',
    longScript: null, longValue: /^--(?:encoding|external-encoding|internal-encoding|dump|enable|disable)$/,
    longFlag: /^--(?:verbose|version|copyright|help|yydebug|jit|yjit|rjit)$/ },
  perl: { script: 'eE', stdin: '', next: '', value: 'IMm', rest: 'CdDFiVx', digits: '0l', flag: 'acfgnpsStTuUvwWXh',
    longScript: null, longValue: null, longFlag: null },
  php: { script: 'rfRF', stdin: '', next: '', value: 'BEcdzSt', rest: '', digits: '', flag: 'aCehHilmnqsvw?',
    longScript: /^--(?:run|file|process-code|process-file)$/, longValue: null,
    longFlag: /^--(?:interactive|no-chdir|profile-info|help|info|syntax-check|modules|no-php-ini|no-header|hide-args|syntax-highlight(?:ing)?|strip|usage|version|ini)$/ },
};
function stdinIsScript(word, rest) {
  const kind = stdinKind(word);
  if (!kind) return true;
  const f = STDIN_FLAGS[kind];
  const args = [];
  for (let k = 0; k < rest.length; k++) {
    const w = rest[k].replace(/^["']|["']$/g, '');
    if (/^\d*[<>]+&?$/.test(w)) { k++; continue; } // a redirect and its target
    if (!/^\d*[<>]/.test(w)) args.push(w);
  }
  for (let k = 0; k < args.length; k++) {
    const w = args[k];
    const more = k + 1 < args.length;
    if (w === '-') return kind === 'shell' ? !more : true; // a runtime's script IS stdin; the words after it are its argv
    if (w === '--') return kind === 'php' || !more; // the end of the options: a next word is the script file
    if (w.startsWith('--')) {
      const name = w.replace(/=.*$/, '');
      if (f.longScript && f.longScript.test(name)) return !(w.includes('=') || more);
      if (w.includes('=')) continue; // an attached value
      if (f.longValue && f.longValue.test(name)) { k++; continue; }
      if (f.longFlag && f.longFlag.test(name)) continue;
      k++; continue; // an option this table does not know: its value is no script file
    }
    if (!(w.length > 1 && (w[0] === '-' || (kind === 'shell' && w[0] === '+')))) return false; // a script file
    let take = 0;
    for (let i = 1; i < w.length; i++) {
      const ch = w[i];
      const tail = i + 1 < w.length;
      if (f.stdin.includes(ch)) return true;
      if (f.script.includes(ch)) return !((tail && kind !== 'shell') || k + take + 1 < args.length);
      if (f.next.includes(ch)) { take++; continue; }
      if (f.value.includes(ch)) { if (!tail) take++; break; }
      if (f.rest.includes(ch)) break;
      if (f.digits.includes(ch)) { const d = /^(?:x[\dA-Fa-f]*|\d*)/.exec(w.slice(i + 1))[0]; i += ch === '0' ? d.length : /^\d*/.exec(w.slice(i + 1))[0].length; continue; }
      if (f.flag.includes(ch)) continue;
      take++; break; // a letter this table does not know: its value is no script file
    }
    k += take;
  }
  return true;
}
// A QUOTED or backslashed tag (`<<'EOF'`, `<<"EOF"`, `<<\EOF`) hands the body over verbatim: the shell expands nothing in it. The
// spans are `heredocsOf`'s - the reader every guard shares - so an opener spelling it accepts is one here too (seam M1).
function stripHeredocsOf(c, code) {
  if (!code) return blankHeredocs(c);
  const docs = heredocsOf(c);
  const blank = blankHeredocs(c, docs);
  const written = new Map(); // a file this command writes from a heredoc body -> that body, for a later run of it (seam m5)
  for (const h of docs) {
    const line = c.slice(h.lineStart, h.lineEnd);
    const reader = heredocReader(line, h.index - h.lineStart);
    if (reader) { code.push({ body: heredocBody(c, h), runtime: reader !== 'shell', lang: reader.split(':')[1] || '', verbatim: heredocVerbatim(c, h) }); continue; }
    const body = heredocBody(c, h);
    if (!heredocVerbatim(c, h)) { // a body the shell expands: each `$( ... )` in it is a command
      for (const { from, to } of heredocSubstitutions(body)) code.push({ body: body.slice(from, to), runtime: false, lang: '', verbatim: false });
    }
    const target = /(?:^|[\s\d])>>?[ \t]*["']?([^\s;&|<>"'&]+)/.exec(line);
    if (target && written.size < 8) written.set(target[1].replace(/^\.\//, ''), { body, h });
  }
  for (const [file, { body, h }] of written) {
    let seen = 0;
    for (let at = blank.indexOf(file, h.end); at >= 0 && seen < 8; at = blank.indexOf(file, at + file.length), seen++) {
      const words = shellTokens(blank.slice(Math.max(0, at - 200), at).split(/[;&|\n(]/).pop().trim()).map((w) => w.replace(/^["']|["']$/g, ''));
      const k = commandIndex(words);
      const word = (words[k] || '').replace(/^.*[\\/]/, '');
      if (RUNTIME_WORD.test(word) || SHELL_WORD.test(word)) code.push({ body, runtime: !SHELL_WORD.test(word), lang: runtimeLang(word), verbatim: heredocVerbatim(c, h) });
    }
  }
  return blank;
}
// `#` starts a comment only at the start of a word outside quotes - `${#VAR}` is a length. Judging
// the comment text let `cat <secret> # wc` borrow an exemption from a word the shell never runs.
function stripComments(text) {
  let out = '';
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      out += ch;
      if (ch === '\\' && quote === '"' && i + 1 < text.length) { out += text[++i]; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\\' && i + 1 < text.length) { out += ch + text[++i]; continue; }
    if (ch === '"' || ch === '\'') { quote = ch; out += ch; continue; }
    if (ch === '#' && (out === '' || /[\s;|&(]$/.test(out))) { while (i + 1 < text.length && text[i + 1] !== '\n') i++; continue; }
    out += ch;
  }
  return quote ? text : out; // an unbalanced quote: judge the raw text rather than guess where it ends
}
// A stage that REDUCES its input to presence - a count, a length, a key list, names without values.
// Scoped to the stage's own command word: `\bwc\b` matched inside `grep -v wc`, and `jq keys`
// matched `jq 'keys, .'`, which prints the whole document beside the keys (review findings).
const PREFIX_WORDS = /^\s*(?:(?:sudo|command|nice|time|exec|builtin|nohup|\w+=\S*)\s+)*/;
function jqReduces(stage) {
  let filter = null;
  for (const t of shellTokens(stage).slice(1)) { if (t.startsWith('-')) continue; filter = t.replace(/^(['"])([\s\S]*)\1$/, '$2'); break; }
  if (filter == null || filter.includes(',')) return false; // `,` prints both sides
  // `keys[]` is the same name list one per line - the `-r` idiom for reading names.
  return /^(?:keys(?:_unsorted)?(?:\[\])?|length|type|has\([^)]*\))$/.test(filter.split('|').pop().trim());
}
function isReducer(stage) {
  const s = stage.replace(PREFIX_WORDS, '');
  if (/^wc\b/.test(s)) return true;
  if (/^(?:grep|rg|egrep|fgrep)\s+(?:-\w*[clLq]\b|--count\b|--files-with-matches\b|--quiet\b)/.test(s)) return true;
  if (/^cut\s+(?:-d\s*['"]?=['"]?|--delimiter[= ]['"]?=['"]?)\s+-f\s*1(?![\d,\-])/.test(s)) return true; // -f1 is the NAME; -f2 and -f1- carry the value
  if (/^awk\s+-F\s*['"]?=/.test(s) && /\$1\b/.test(s) && !/\$(?:0|[2-9])/.test(s)) return true;
  if (/^sed\s+['"]?s\/=\.\*\/\//.test(s)) return true;
  if (/^jq\b/.test(s)) return jqReduces(s);
  return false;
}
// A redirect into a FILE never reaches the context - but `/dev/stdout`, `/dev/stderr` and `/dev/tty`
// ARE the context, and a `tee` stage writing to one prints everything upstream of the reducer.
// Only STDOUT's redirect (`>` or `1>`) excuses a segment: a `2>/dev/null` moves stderr and leaves
// the dump on stdout - the `\d?` that accepted it let `cat <file> 2>/dev/null` pass (re-review).
const TERMINAL_DEV = /^\/dev\/(?:std(?:out|err)|tty|fd\/[12])$/;
const REDIRECT_RE = /(?:^|\s)1?>>?\s*([^&\s>|]+)/g;
const redirectsToFile = (seg) => [...seg.matchAll(REDIRECT_RE)].some((m) => !TERMINAL_DEV.test(m[1]));
const teesToTerminal = (stage) => /^tee\b[^|]*?(\/dev\/(?:std(?:out|err)|tty|fd\/[12]))\b/.test(stage.replace(PREFIX_WORDS, ''));

// Split `text` at the separators `sepAt` reports (their length at position i, 0 for none),
// honouring quotes: an escaped char outside quotes and inside double quotes is skipped, single
// quotes take no escapes (bash semantics). FAIL SAFE: a quote left open at the end (a typo, a
// truncated input, a `\` before a closing quote) would otherwise swallow the rest into one piece,
// where any exemption substring could excuse a real dump (review finding) - so an unbalanced scan
// falls back to the quote-blind `blind` split, which judges every operator-separated piece.
// `seps` (optional) collects the separator TEXT between the parts, so a caller can put the pieces
// back together with what joined them - what the segment splice below needs. An unbalanced scan
// empties it, because the blind fallback's pieces are not the ones these separators sat between.
function splitOutsideQuotes(text, sepAt, blind, seps) {
  const parts = [];
  let cur = '';
  let quote = null; // the quote character we are inside, or null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      cur += ch;
      if (ch === '\\' && quote === '"' && i + 1 < text.length) { cur += text[++i]; continue; } // an escaped char inside double quotes
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\\' && i + 1 < text.length) { cur += ch + text[++i]; continue; } // an escaped char outside quotes
    if (ch === '"' || ch === '\'') { quote = ch; cur += ch; continue; }
    const n = sepAt(text, i);
    if (n) { parts.push(cur); if (seps) seps.push(text.substr(i, n)); cur = ''; i += n - 1; continue; }
    cur += ch;
  }
  parts.push(cur);
  if (quote && seps) seps.length = 0;
  return quote ? blind(text) : parts;
}
// Segments split on `&&`, `||`, `;` and newline OUTSIDE quotes: a runtime's inline code carries
// `;` inside its quoted argument (`python3 -c "import json;print(...)"`), and a naive split
// separated the runtime word from the segment holding the file path, so neither half matched.
// A LONE `&` is a boundary too: it backgrounds its left side and runs the right one (`true & env` left the
// dump unjudged). Not the `&` of a redirection (`2>&1`, `&>`, `<&`) or of `|&`.
const loneAmp = (t, i) => t[i] === '&' && t[i + 1] !== '&' && t[i + 1] !== '>' && !/[<>|&]/.test(t[i - 1] || '');
const splitSegments = (cmd, seps) => splitOutsideQuotes(cmd,
  (t, i) => ((t[i] === '\n' || t[i] === ';' || loneAmp(t, i)) ? 1 : ((t[i] === '&' || t[i] === '|') && t[i + 1] === t[i]) ? 2 : 0),
  (t) => t.split(/&&|\|\||;|\n|(?<![<>|&])&(?![&>])/), seps);
// A segment is a PIPELINE: its stages split on a single `|` (`||` never reaches here - splitSegments
// consumed it), and a print verb's arguments end at its own stage.
const splitPipes = (seg) => splitOutsideQuotes(seg, (t, i) => (t[i] === '|' ? 1 : 0), (t) => t.split('|'));
// Words split on whitespace OUTSIDE quotes: a naive `\s+` split cut `cat "<project>/my dir/x.json"`
// into three tokens, none of them a path, and CLAUDE.md supports a project path with a space - so
// that was an environment condition, not a chosen bypass.
const shellTokens = (s) => splitOutsideQuotes(s, (t, i) => (/\s/.test(t[i]) ? 1 : 0), (t) => t.split(/\s+/)).filter(Boolean);

// ---- a credential path a runtime BUILDS from a directory it reads at run time (2.1.6) ----------------
// `path.join(os.homedir(), '.claude.json')`, `os.homedir() + '/.aws/credentials'`, a template over a name bound to
// the home, `Path.home() / '.claude.json'`, `File.join(Dir.home, ...)`, `path.join(process.env.CLAUDE_CONFIG_DIR, ...)`
// hand the token scan no path at all - only a bare settings.json was ever anchored at home (homeAnchor), so each of
// them read the account file unjudged. The directory is resolved the way the runtime will resolve it (this hook's
// own HOME and environment, which the command inherits), the literal parts joined, and the result judged like a
// literal path. A script that assigns HOME itself reads that home instead, so it resolves no home at all; a
// directory it builds from anything else (a sandbox under a temp dir) is never guessed at.
const DIR_ENV = new Set(['HOME', 'USERPROFILE', 'CLAUDE_CONFIG_DIR', 'CLAUDE_PROJECT_DIR']);
const HOME_CALL = /^(?:(?:require\s*\(\s*['"](?:node:)?os['"]\s*\)|os)\s*\.\s*homedir\s*\(\s*\)|homedir\s*\(\s*\)|(?:pathlib\s*\.\s*)?Path\s*\.\s*home\s*\(\s*\)|Dir\s*\.\s*home|os\s*\.\s*path\s*\.\s*expanduser\s*\(\s*(['"])~\1\s*\))$/;
const ENV_DIR = /^(?:process\s*\.\s*env\s*(?:\.\s*(\w+)|\[\s*['"](\w+)['"]\s*\])|os\s*\.\s*environ\s*(?:\[\s*['"](\w+)['"]\s*\]|\.\s*get\s*\(\s*['"](\w+)['"]\s*\))|os\s*\.\s*getenv\s*\(\s*['"](\w+)['"]\s*\)|ENV\s*(?:\[\s*['"](\w+)['"]\s*\]|\.\s*fetch\s*\(\s*['"](\w+)['"]\s*\))|\$ENV\{\s*['"]?(\w+)['"]?\s*\}|Deno\s*\.\s*env\s*\.\s*get\s*\(\s*['"](\w+)['"]\s*\)|getenv\s*\(\s*['"](\w+)['"]\s*\)|\$_(?:SERVER|ENV)\s*\[\s*['"](\w+)['"]\s*\])$/;
const HOME_MOVED = /process\s*\.\s*env\s*(?:\.\s*(?:HOME|USERPROFILE)|\[\s*['"](?:HOME|USERPROFILE)['"]\s*\])\s*=(?!=)|os\s*\.\s*environ\s*\[\s*['"](?:HOME|USERPROFILE)['"]\s*\]\s*=(?!=)|\$ENV\{\s*['"]?HOME['"]?\s*\}\s*=(?!=)|\bENV\s*\[\s*['"]HOME['"]\s*\]\s*=(?!=)/;
const QUOTES = '"\'`';
// Every opening bracket's partner in ONE quote-aware pass (-1 when unbalanced), and the deepest nesting: closeOf per
// bracket rescanned the rest of the text each time, so nested parens cost their square (review M3 of 2.1.6).
function bracketPairs(text) {
  const pair = new Int32Array(text.length).fill(-1);
  const stack = [];
  let q = null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (QUOTES.includes(c)) q = c;
    else if (c === '(' || c === '[' || c === '{') { stack.push(i); if (stack.length > depth) depth = stack.length; }
    else if (c === ')' || c === ']' || c === '}') { const o = stack.pop(); if (o !== undefined) pair[o] = i; }
  }
  return { pair, depth };
}
// The index of the bracket closing the one at `open`, quote-aware; -1 when unbalanced.
function closeOf(text, open) {
  let depth = 0;
  let q = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (QUOTES.includes(c)) q = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}
// `expr` split at `sep` where it stands outside quotes and brackets.
function splitTop(expr, sep) {
  const out = [];
  let depth = 0;
  let q = null;
  let from = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (QUOTES.includes(c)) q = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && c === sep) { out.push(expr.slice(from, i)); from = i + 1; }
  }
  out.push(expr.slice(from));
  return out;
}
// What a path expression evaluates to - { p, rooted } when every part is known, rooted when a run-time directory
// is in it; null otherwise. `vals` holds the names the script bound to one earlier.
function evalPath(expr, vals, homeMoved, depth = 0) {
  let e = String(expr).trim();
  if (!e || depth > 8) return null;
  if (e[0] === '(') {
    // peel every wrapping pair in one pass: `((x))` is x
    const { pair } = bracketPairs(e);
    let a = 0;
    let b = e.length - 1;
    while (a < b && e[a] === '(' && pair[a] === b) {
      a++; b--;
      while (a <= b && /\s/.test(e[a])) a++;
      while (b >= a && /\s/.test(e[b])) b--;
    }
    e = e.slice(a, b + 1);
  }
  judgeTick(1 + e.length);
  const lit = e.match(/^(['"])((?:\\.|(?!\1)[^\\\n])*)\1$/);
  if (lit) return { p: lit[2], rooted: false };
  const tpl = e.match(/^`([^`]*)`$/) || e.match(/^[fF](['"])(.*)\1$/) || e.match(/^"([^"]*#\{[^"]*)"$/);
  if (tpl) {
    let rooted = false;
    let bad = false;
    const body = (tpl[2] !== undefined ? tpl[2] : tpl[1]).replace(/\$\{([^{}]*)\}|#\{([^{}]*)\}|\{([^{}]*)\}/g, (m, a, b, c) => {
      if (c !== undefined && !/^[fF]/.test(e)) return m; // a brace is interpolation only in an f-string
      const v = evalPath(a !== undefined ? a : b !== undefined ? b : c, vals, homeMoved, depth + 1);
      if (!v) { bad = true; return m; }
      rooted = rooted || v.rooted;
      return v.p;
    });
    return bad ? null : { p: body, rooted };
  }
  if (HOME_CALL.test(e)) return HOME && !homeMoved ? { p: HOME, rooted: true } : null;
  const env = e.match(ENV_DIR);
  if (env) {
    const name = env.slice(1).find(Boolean);
    if (!DIR_ENV.has(name) || (homeMoved && (name === 'HOME' || name === 'USERPROFILE'))) return null;
    const d = name === 'HOME' ? HOME : name === 'USERPROFILE' ? process.env.USERPROFILE || HOME : process.env[name];
    return d ? { p: d, rooted: true } : null;
  }
  if (/^[A-Za-z_$][\w$]*$/.test(e)) return vals.get(e) || null;
  const all = (parts, join) => {
    const vs = parts.map((x) => evalPath(x, vals, homeMoved, depth + 1));
    if (!vs.length || vs.some((v) => !v)) return null;
    return { p: join(vs.map((v) => v.p)), rooted: vs.some((v) => v.rooted) };
  };
  const call = e.match(/^((?:path|require\s*\(\s*['"](?:node:)?path['"]\s*\)|os\s*\.\s*path|posixpath|ntpath|File|Path|pathlib\s*\.\s*Path)\s*\.\s*(?:join|resolve)|(?:pathlib\s*\.\s*)?Path)\s*\(/);
  if (call && closeOf(e, call[0].length - 1) === e.length - 1) {
    return all(splitTop(e.slice(call[0].length, -1), ',').filter((x) => x.trim()), (ps) => pathMod.join(...ps));
  }
  // `<base>.joinpath(` - what `/^([\s\S]+?)\s*\.\s*joinpath\s*\(/` matched, found without its lazy prefix
  // splitting a run of spaces every way (review M3 of 2.1.6): [through the paren, the base]
  let jp = null;
  const jre = /\.\s*joinpath\s*\(/g;
  jre.lastIndex = 1;
  const jm = jre.exec(e);
  if (jm) {
    let r = jm.index;
    while (r > 0 && /\s/.test(e[r - 1])) r--;
    jp = [e.slice(0, jm.index + jm[0].length), e.slice(0, Math.max(r, 1))];
  }
  if (jp && closeOf(e, jp[0].length - 1) === e.length - 1) {
    return all([jp[1], ...splitTop(e.slice(jp[0].length, -1), ',')], (ps) => pathMod.join(...ps));
  }
  const plus = splitTop(e, '+');
  if (plus.length > 1) return all(plus, (ps) => ps.join(''));
  const slash = splitTop(e, '/');
  if (slash.length > 1 && slash.every((x) => x.trim())) return all(slash, (ps) => pathMod.join(...ps));
  // php's concatenation (`getenv("HOME") . "/.aws/credentials"`), read after `/` so pathlib's `Path.home() / ".aws"` keeps
  // its split; every part must evaluate, so a method chain is no path
  const dot = splitTop(e, '.');
  if (dot.length > 1 && dot.every((x) => x.trim())) return all(dot, (ps) => ps.join(''));
  return null;
}
// Every rooted path the code builds - in any parenthesised expression (a call's arguments, a group) or a name bound
// to one - as absolute paths for the candidate scan.
// A rooted path starts at a run-time directory, and every such spelling (HOME_CALL, ENV_DIR's DIR_ENV names) carries
// one of these words: code without one builds no rooted path, so it is not read at all.
const ROOT_HINT = /homedir|\.\s*home\b|expanduser|HOME|USERPROFILE|CLAUDE_CONFIG_DIR|CLAUDE_PROJECT_DIR/;
function builtPaths(texts) {
  const out = new Set();
  for (const text of texts) {
    const code = String(text);
    if (!ROOT_HINT.test(code)) continue;
    const homeMoved = HOME_MOVED.test(code);
    const vals = new Map();
    const exprs = [];
    const commands = [];
    // one pass for every bracket's partner, and where each statement from a position ends (a top-level `;`, `,`,
    // newline or an unmatched closer): read in O(1) below, where each lookup used to rescan the rest of the code
    const { pair, depth } = bracketPairs(code);
    if (depth > JUDGE_MAX_DEPTH) throw new JudgeBudget('depth');
    const quoteEnd = new Int32Array(code.length).fill(-1);
    for (let i = 0, q = null, from = -1; i < code.length; i++) {
      const c = code[i];
      if (q) { if (c === '\\') i++; else if (c === q) { quoteEnd[from] = i; q = null; } continue; }
      if (QUOTES.includes(c)) { q = c; from = i; }
    }
    const stop = new Int32Array(code.length + 1).fill(code.length);
    for (let k = code.length - 1; k >= 0; k--) {
      const c = code[k];
      if (c === ';' || c === ',' || c === '\n' || c === ')' || c === ']' || c === '}') stop[k] = k;
      else if (c === '(' || c === '[' || c === '{') stop[k] = pair[k] < 0 ? code.length : stop[pair[k] + 1];
      else if (QUOTES.includes(c)) stop[k] = quoteEnd[k] < 0 ? code.length : stop[quoteEnd[k] + 1];
      else stop[k] = stop[k + 1];
    }
    let q = null;
    for (let i = 0; i < code.length; i++) {
      const c = code[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
      if (QUOTES.includes(c)) { q = c; continue; }
      if (c === '(') {
        const e = pair[i];
        // a pure wrapper - `( (x) )` - adds nothing its inner group does not: that one is read on its own
        let a = i + 1;
        let b = e - 1;
        while (a < b && /\s/.test(code[a])) a++;
        while (b > a && /\s/.test(code[b])) b--;
        if (e > i && !(code[a] === '(' && pair[a] === b)) { judgeTick(e - i); exprs.push(...splitTop(code.slice(i + 1, e), ',')); }
        // the command a shell-running call is handed, built from a root (`execSync("cat " + os.homedir() + "/...")`)
        if (e > i && SHELL_CALL_NAME.test(code.slice(Math.max(0, i - 24), i))) commands.push(splitTop(code.slice(i + 1, e), ',')[0]);
      }
      // a name bound to a built directory: `const d = path.join(os.homedir(), '.claude')`
      if (c === '=' && code[i + 1] !== '=' && code[i + 1] !== '>' && !/[=!<>+\-*/]/.test(code[i - 1] || '')) {
        let j = i - 1;
        while (j >= 0 && /\s/.test(code[j])) j--;
        let s0 = j;
        while (s0 >= 0 && /[\w$]/.test(code[s0])) s0--;
        const name = code.slice(s0 + 1, j + 1).replace(/^\d+/, '');
        if (!name) continue;
        const end = stop[i + 1];
        // a chained assignment (`d = e = <expr>`) is read at its last `=`: evaluating every link to the end of the chain
        // cost the chain's square, and a link's own right side is never a path
        if (/^\s*[A-Za-z_$][\w$]*\s*=(?![=>])/.test(code.slice(i + 1, Math.min(end, i + 257)))) continue;
        judgeTick(1 + end - i);
        const v = evalPath(code.slice(i + 1, end), vals, homeMoved);
        if (v && v.rooted) vals.set(name, v);
        exprs.push(code.slice(i + 1, end));
      }
    }
    for (const x of exprs) {
      const v = evalPath(x, vals, homeMoved);
      if (v && v.rooted && pathMod.isAbsolute(v.p)) out.add(nativePath(v.p));
    }
    for (const x of commands.splice(0)) {
      const v = evalPath(x, vals, homeMoved);
      if (v && v.rooted) spawnedShell.push(v.p);
    }
  }
  return [...out];
}
// The scripts an inline runtime stage carries: its quoted arguments, a double-quoted one unescaped the way the shell will.
const inlineScripts = (stage) => shellTokens(stage).filter((t) => /^(['"])[\s\S]*\1$/.test(t))
  .map((t) => (t[0] === '"' ? t.slice(1, -1).replace(/\\(["\\$`])/g, '$1') : t.slice(1, -1)));
// The command strings a pipeline stage hands to a shell, judged as that shell like a runtime's `execSync("...")` (2.1.6
// review round: `bash -c 'cat ~/.aws/credentials'`, `eval` and `echo "cat <file>" | sh` printed the file unjudged, on base
// too). A shell's `-c` runs the first word after its options, read with STDIN_FLAGS' shell row (`bash -e -c 'x'`, `bash
// -ce 'x'`, `-o pipefail` taking its value); `eval` runs its words joined, `watch` its command, `su` / `script` the word
// after `-c`, and a shell reading its script from stdin runs what the print stage before it prints.
const wordOf = (t) => (/^"[\s\S]*"$/.test(t) ? t.slice(1, -1).replace(/\\(["\\$`])/g, '$1') : /^'[\s\S]*'$/.test(t) ? t.slice(1, -1) : t);
const SHELL_VERB = /^(?:bash|sh|zsh|dash|ksh|fish)$/;
// The command word of a stage is found past shell-writes.js's wrapper list (`commandIndex`, the one home of it).
const commandAt = (words) => commandIndex(words, shellTokens);
// The `$(...)` and backtick substitutions in a stage's text, outside single quotes (`$((` is arithmetic).
function substitutions(text) {
  const out = [];
  let dq = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') { i++; continue; }
    if (c === '"') { dq = !dq; continue; }
    if (c === "'" && !dq) { const j = text.indexOf("'", i + 1); if (j < 0) break; i = j; continue; }
    if (c === '$' && text[i + 1] === '(' && text[i + 2] !== '(') {
      let depth = 1; let j = i + 2;
      for (; j < text.length && depth; j++) { if (text[j] === '(') depth++; else if (text[j] === ')') depth--; }
      out.push(text.slice(i + 2, depth ? j : j - 1));
      i = j - 1;
    } else if (c === '`') {
      const j = text.indexOf('`', i + 1);
      if (j < 0) break;
      out.push(text.slice(i + 1, j));
      i = j;
    }
  }
  return out;
}
// The script a shell word list runs: its `-c` string, or the here-string a shell with no `-c` reads (`bash <<< 'cat f'`).
function shellScriptOf(words, stage) {
  const f = STDIN_FLAGS.shell;
  let c = false;
  for (let k = 1; k < words.length; k++) {
    const w = wordOf(words[k]);
    if (w === '-' || w === '--') return c && k + 1 < words.length ? [wordOf(words[k + 1])] : [];
    if (w.startsWith('--')) { if (!w.includes('=') && f.longValue.test(w)) k++; continue; }
    if (w.length > 1 && (w[0] === '-' || w[0] === '+')) {
      let take = 0;
      for (let i = 1; i < w.length; i++) { if (w[i] === 'c') c = true; else if (f.next.includes(w[i])) take++; }
      k += take;
      continue;
    }
    return c ? [w] : hereString(stage);
  }
  return c ? [] : hereString(stage);
}
// The word a `<<<` hands a shell as its script, in the stage that carries it.
function hereString(stage) {
  const raw = stage ? shellTokens(stage.trim()) : [];
  const at = raw.findIndex((t) => t.startsWith('<<<'));
  const w = at < 0 ? null : raw[at].length > 3 ? raw[at].slice(3) : raw[at + 1];
  return w == null ? [] : [wordOf(w)];
}
function shellRunStrings(stages, sj) {
  const wordsOf = (s) => { const w = shellTokens(s.trim()).filter((t) => !/^\d*[<>]/.test(t)); return w.slice(commandAt(w)); };
  const words = wordsOf(stages[sj]);
  const verb = wordOf(words[0] || '').replace(/^.*[\\/]/, '');
  if (SHELL_VERB.test(verb)) return shellScriptOf(words, stages[sj]);
  if (verb === 'find' || verb === 'gfind') { // `find ... -exec sh -c '<script>' \;` runs its script once per match
    const out = [];
    for (let k = 1; k < words.length; k++) {
      if (!/^-(?:exec|execdir|ok|okdir)$/.test(wordOf(words[k]))) continue;
      let e = k + 1;
      while (e < words.length && !/^\\?;$|^\+$/.test(wordOf(words[e]))) e++;
      const seg = words.slice(k + 1, e);
      const run = seg.slice(commandAt(seg));
      if (SHELL_VERB.test(wordOf(run[0] || '').replace(/^.*[\\/]/, ''))) out.push(...shellScriptOf(run, ''));
      k = e;
    }
    return out;
  }
  if (verb === 'eval') return words.length > 1 ? [words.slice(1).map(wordOf).join(' ')] : [];
  if (verb === 'watch') {
    let k = 1;
    for (; k < words.length && /^-/.test(wordOf(words[k])); k++) if (/^(?:-[a-z]*n|--interval|-q|--equexit)$/.test(wordOf(words[k]))) k++;
    return k < words.length ? [words.slice(k).map(wordOf).join(' ')] : [];
  }
  if (verb === 'su' || verb === 'script') {
    for (let k = 1; k + 1 < words.length; k++) if (/^(?:-c|--command)$/.test(wordOf(words[k]))) return [wordOf(words[k + 1])];
    const eq = words.map(wordOf).find((w) => w.startsWith('--command='));
    return eq ? [eq.slice(10)] : [];
  }
  if (verb === 'echo' || verb === 'printf') {
    // a printed substitution prints what its command read (`echo "$(cat <file>)"`); an assignment of one prints nothing
    const out = substitutions(stages[sj]);
    if (sj + 1 < stages.length) {
      const next = wordsOf(stages[sj + 1]);
      const nv = wordOf(next[0] || '').replace(/^.*[\\/]/, '');
      if (SHELL_VERB.test(nv) && stdinIsScript(nv, next.slice(1))) {
        const args = words.slice(1).map(wordOf).filter((w) => !(verb === 'echo' && /^-[neE]+$/.test(w)));
        out.push(args.join(' ').replace(/%[-\d.]*[sdb]/g, ' ').replace(/\\n/g, '\n'));
      }
    }
    return out;
  }
  return [];
}

// A runtime reads the environment in its own spelling - the same leak as `echo $SECRET`, which the
// file-path scan never looked for (review finding: every shape below passed). A NAMED read is
// judged by the name; a whole-environment object beside a print is the env dump.
const ENV_NAMED = [
  /process\.env(?:\.|\[\s*['"])(\w+)/g,
  /os\.environ(?:\.get\()?\s*(?:\[\s*)?['"](\w+)/g,
  /\bENV\[\s*['"](\w+)/g,
  /\$ENV\{\s*['"]?(\w+)/g,
];
const ENV_BARE = /process\.env(?![.[\w])|os\.environ(?![.[\w(])|%ENV\b|\bENV\.(?:to_h|each)\b/;
// A runtime reads the environment only in ITS OWN spelling: in a Python body `{ ...process.env }` is text it edits (the
// replay's `python3 - <file> <<'EOF'` edit scripts, blocked as environment dumps). A runtime with no row keeps every spelling.
const ENV_OF = {
  node: { named: [ENV_NAMED[0]], bare: /process\.env(?![.[\w])/ },
  python: { named: [ENV_NAMED[1]], bare: /os\.environ(?![.[\w(])/ },
  ruby: { named: [ENV_NAMED[2]], bare: /\bENV\.(?:to_h|each)\b/ },
  perl: { named: [ENV_NAMED[3]], bare: /%ENV\b/ },
  php: { named: [/\bgetenv\s*\(\s*['"](\w+)/g, /\$_(?:ENV|SERVER)\s*\[\s*['"](\w+)/g], bare: /\$_(?:ENV|SERVER)(?!\s*\[)|\bgetenv\s*\(\s*\)/ },
};
// Every name a runtime body reads from the environment - the names a verbatim body may still expand (verbatimVars).
const ENV_READS = [...ENV_NAMED, /\bgetenv\s*\(\s*['"](\w+)/g, /\bDeno\.env\.get\s*\(\s*['"](\w+)/g, /\$env:(\w+)/gi];
const envNamesIn = (code) => new Set(ENV_READS.flatMap((re) => [...String(code).matchAll(re)].map((m) => m[1])));
// Names without values is the presence read, in a runtime as much as in a shell pipeline.
const ENV_REDUCED = /Object\.keys\(\s*process\.env\s*\)|os\.environ\.keys\(\s*\)|\bENV\.keys\b/g;
const RUNTIME_PRINT = /console\.log|JSON\.stringify|\bprint\s*\(|\bputs\b|(?:^|\s)-p(?=\s|$)|--print\b|\b(?:print_r|var_dump|var_export|echo)\b/;
// The calls that turn a `~/` string into the home path: Python's expanduser, Ruby's expand_path, a Perl or PHP glob, a
// replace of the leading tilde, the untildify package.
const TILDE_EXPANDER = /expanduser|expand_path|\b(?:bsd_)?glob\s*\(|\.replace\s*\(\s*(?:\/\^?~|['"]~)|untildify/;

// A RUNTIME stage that reduces the file it reads to a KEY LIST prints names, never values - the
// same sanctioned read `jq keys` and `cut -f1` already get on the shell route. Measured: a
// `node -e "... Object.keys(d.env||{})"` asking for ~200 chars of key names came back as 6,273
// chars of the whole redacted file, and the model then needed a third command to re-check the half
// of its own output the rewrite had swallowed. Narrow on purpose: the printed expression must
// BEGIN with a key-list call (optionally wrapped once in list/sorted/join) and carry none of the
// idioms that turn names back into values, so anything cleverer than that still gets the redacted
// view - which is an over-broad answer, never a leak.
const PRINT_CALL = /(?:console\.(?:log|info)|process\.stdout\.write|\bprint|\bputs)\s*\(/g;
function argsOf(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return text.slice(openIdx + 1, i);
  }
  return text.slice(openIdx + 1);   // unbalanced - judge what there is
}
const KEYS_ARG = /^\s*(?:(?:list|sorted|Array\.from)\s*\(\s*|(?:'[^']*'|"[^"]*")\s*\.\s*join\s*\(\s*)?(?:Object\.keys\s*\(|[\w$)\]'"[.]+\.keys\s*\(\s*\))/;
const VALUE_IDIOM = /=>|\bfor\b|\.values\s*\(|\.entries\s*\(|JSON\.stringify|\bitems\s*\(/;
// A SECOND argument prints whatever it names beside the key list - the same reason `jq 'keys, .'`
// is not a reducer. Nesting and quotes are tracked so the commas inside the key call itself don't
// count.
function hasTopLevelComma(args) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === '\'' || ch === '`') { quote = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) return true;
  }
  return false;
}
function printsKeysOnly(stage) {
  const prints = [...stage.matchAll(PRINT_CALL)];
  if (!prints.length) return false;
  return prints.every((m) => {
    const args = argsOf(stage, m.index + m[0].length - 1);
    return KEYS_ARG.test(args) && !VALUE_IDIOM.test(args) && !hasTopLevelComma(args);
  });
}

// A rewrite replaces the WHOLE command, so every other step in it is dropped. That is free for a step that
// changes nothing (a cd, an ls, an echo, a filter) and silent data loss for one that does. Measured: `grep -c
// ... && sed -i ... "$F" && jq -r .SuperAdmin.Email "$F"` became the file's redacted view, the edit never ran,
// and the user found the old value in the config 37 minutes later. So a command carrying a CHANGING step is
// blocked - visibly, naming the step - and only a read-only one is rewritten. Allowlist, not denylist: a step
// this list does not know (a build, a network call, a runtime) counts as changing.
const READ_ONLY_STEP = /^(?:cd|pushd|popd|ls|pwd|cat|head|tail|grep|egrep|fgrep|rg|jq|yq|sed|[gmn]?awk|wc|sort|uniq|cut|tr|nl|tac|column|fold|paste|echo|printf|true|false|test|\[\[?|read|stat|file|which|type|basename|dirname|realpath|readlink|date|diff|cmp|shasum|sha\d*sum|md5sum|md5|base64|xxd|od|hexdump|strings|less|more|bat|sleep|exit|set|export|unset|shopt|local)(?=\s|$)|^command\s+-v\b|^git\s+(?:status|log|diff|show|rev-parse|ls-files)\b|^find\b(?!.*\s-(?:exec|execdir|delete|ok|okdir|fprint\w*|fls)\b)|^(?:get-content|gc|get-childitem|gci|dir|get-item|gi|get-location|set-location|sl|select-string|sls|select-object|select|where-object|where|sort-object|measure-object|measure|format-table|ft|format-list|fl|out-string|write-output|write-host|test-path|resolve-path|convertfrom-json|convertto-json)(?=\s|$)/i;
// A stage that WRITES a file. The rewrite replaces the stage it judges too, so a writer naming the credential file
// came back as the read-only view and its edit silently never ran - pilot 3, ours guard-02 r1:
// `node -e "...fs.writeFileSync(path, ...)"` and `perl -0pi -e 's/.../' <file>` both returned the view, and the
// `grep -c` after them said 0. Two shapes: an in-place flag on sed / perl / ruby, wherever it sits among the flags
// (a cluster stops at a letter that takes an argument, so `-ne` and `-Mstrict` are not `-i`) or gawk's `-i inplace`,
// and inline code that writes - a node / deno / bun file write or `openSync` in a write mode, python open() or
// pathlib `.open()` in a write mode or a write helper, ruby and perl writes.
const IN_PLACE_STOP = { sed: /[ef]/, perl: /[eEMmIxdDCFV]/, ruby: /[erICEFKWxT]/ };
// gawk edits in place through its `inplace` extension, loaded by `-i` / `--include` (review I1).
const AWK_INPLACE = /^(?:['"]?)(?:.*[\\/])?inplace(?:\.awk)?['"]?$/;
function inPlaceFlag(stage) {
  const words = shellTokens(stage.replace(PREFIX_WORDS, ''));
  const verb = (words[0] || '').replace(/^.*[\\/]/, '').replace(/^gsed$/, 'sed').replace(/^[gmn]awk$/, 'awk');
  if (verb === 'awk') {
    for (let k = 1; k < words.length; k++) {
      const m = words[k].match(/^(?:-i|--include)(?:=?(.+))?$/);
      if (m && AWK_INPLACE.test(m[1] || words[k + 1] || '')) return 'awk -i inplace';
    }
    return null;
  }
  const stop = IN_PLACE_STOP[verb];
  if (!stop) return null;
  for (let k = 1; k < words.length; k++) {
    const w = words[k];
    if (/^--in-place(?:=|$)/.test(w)) return `${verb} --in-place`;
    // sed reads its flags anywhere (GNU permutes them); perl and ruby stop at the script or the first file
    if (!/^-[^-]/.test(w)) { if (verb === 'sed') continue; break; }
    const cluster = w.slice(1);
    const cut = cluster.search(stop);
    if ((cut < 0 ? cluster : cluster.slice(0, cut)).includes('i')) return `${verb} -i`;
    if (cut >= 0 && cut === cluster.length - 1) k++; // `-e <code>`: the next word is the flag's argument
  }
  return null;
}
const INLINE_WRITE = /\b(?:file_put_contents|fwrite|fputs|writeFile(?:Sync)?|appendFile(?:Sync)?|createWriteStream|copyFile(?:Sync)?|renameSync|rmSync|unlinkSync|truncateSync|writeTextFile|Bun\.write|write_text|write_bytes|json\.dump|shutil\.(?:copy\w*|move)|os\.(?:replace|rename|remove|unlink)|File\.(?:write|delete|rename)|IO\.write|FileUtils\.\w+)\s*\(|\bopen\s*\([^()]*?,\s*(?:mode\s*=\s*)?['"][rbt]*[wax+][rwxabt+]*['"]|\bFile\.open\s*\([^()]*?,\s*['"][rb]*[wa+]|\bopen\s*(?:\(\s*)?(?:my\s+)?\$?\w+\s*,\s*['"]\+?>|\.open\s*\(\s*(?:mode\s*=\s*)?['"][rbt]*[wax+][rwxabt+]*['"]|\bopenSync\s*\([^()]*?,\s*['"][rs]*(?:[wa]|\+)[xs+]*['"]/;
// A runtime run on a script FILE: what it does sits in a file the guard never reads, so no view can stand in for it
// (review I1: `python3 /tmp/fix.py appsettings.json` became the view, and the script never ran). Inline code (`-c`,
// `-e`, `-p`, `eval`, `-Command`), a module (`python3 -m json.tool`) and stdin (`-`, a heredoc) are judged as before.
const SCRIPT_RUNTIME = /^(?:node|python(?:3(?:\.\d+)?)?|perl|ruby|deno|bun|pwsh|powershell|php)(?:\.exe)?$/i;
function scriptFileRun(stage) {
  const words = shellTokens(stage.replace(PREFIX_WORDS, ''));
  const verb = (words[0] || '').replace(/^['"]|['"]$/g, '').replace(/^.*[\\/]/, '');
  if (!SCRIPT_RUNTIME.test(verb)) return null;
  const kind = verb.toLowerCase().replace(/\.exe$/, '').replace(/^python.*/, 'python').replace(/^powershell$/, 'pwsh');
  for (let k = 1; k < words.length; k++) {
    const w = words[k];
    if (w === '-') return null;
    if (w === '--') { k++; if (k < words.length) return `${verb} ${words[k].replace(/^['"]|['"]$/g, '').replace(/^.*[\\/]/, '')}`; return null; }
    if (w.startsWith('-')) {
      const flag = w.slice(1);
      if (kind === 'python') { if (/^[cm]/.test(flag.replace(/^[bBdEhiIOqsSuvx]+/, ''))) return null; if (/^[WX]$/.test(flag)) k++; continue; }
      if (kind === 'node' || kind === 'bun') { if (/^(?:[ep]|pe|-eval|-print)(?:=|$)/.test(flag)) return null; if (/^(?:r|-require|-import|-loader|-experimental-loader|-input-type)$/.test(flag)) k++; continue; }
      if (kind === 'perl' || kind === 'ruby') { const cut = flag.search(IN_PLACE_STOP[kind]); if (cut >= 0 && /[eE]/.test(flag[cut])) return null; if (cut >= 0 && cut === flag.length - 1 && /[IMmxdDCFVrKWT]/.test(flag[cut])) k++; continue; }
      if (kind === 'pwsh' && /^(?:c|e|ec|command|encodedcommand)$/i.test(flag)) return null;
      if (kind === 'php') { if (/^[rBRE]$/.test(flag)) return null; if (/^[dcz]$/.test(flag)) k++; continue; } // `-f <script>` names it next
      continue; // `pwsh -File <script>` names it next; deno's own flags take `=` values
    }
    if (kind === 'deno' && /^(?:eval|repl)$/.test(w)) return null;
    if ((kind === 'deno' || kind === 'bun') && /^(?:run|x)$/.test(w)) continue;
    return `${verb} ${w.replace(/^['"]|['"]$/g, '').replace(/^.*[\\/]/, '')}`;
  }
  return null;
}
function stageWrites(stage, code) {
  const flag = inPlaceFlag(stage);
  if (flag) return flag;
  const words = shellTokens(stage.replace(PREFIX_WORDS, ''));
  const verb = unq(words[0] || '').replace(/^.*[\\/]/, '');
  if (/^(?:vim?|nvim|gvim|rvim|ex|view|rview)$/i.test(verb) && vimRun(verb, words.slice(1)).writes) return `${verb} (a write command)`;
  const m = (code != null || RUNTIME.test(stage)) && (code != null ? code : stage).match(INLINE_WRITE);
  return m ? m[0].replace(/\s+/g, ' ').slice(0, 40) : null;
}
const CONTROL_LEAD = /^(?:do|then|else|elif|if|while|until|!|\{|\()\s+/;
const CONTROL_ALONE = /^(?:done|fi|esac|else|\}|\)|for\s+\w+\s+in\b.*)$/;
const SELF_READ = /guard-secret-value\.js["']?\s+--(?:presence|redacted(?:-env)?)\b/;
// The first step of `text` that may change something, skipping the stage being rewritten; null when none.
function changingStep(text, skipSeg, skipStage) {
  const segs = splitSegments(stripComments(text));
  for (let i = 0; i < segs.length; i++) {
    const bare = segs[i].replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
    // stdout into a file is a write; /dev/null and a terminal device are not
    if ([...bare.matchAll(REDIRECT_RE)].some((m) => !TERMINAL_DEV.test(m[1]) && m[1] !== '/dev/null')) return segs[i].trim();
    if (/\bsed\s+(?:-\w*i|--in-place)\b/.test(bare)) return segs[i].trim();
    const stages = splitPipes(segs[i]);
    for (let j = 0; j < stages.length; j++) {
      if (i === skipSeg && j === skipStage) continue;
      let step = stages[j].trim();
      if (!step || SELF_READ.test(step) || teesToTerminal(step)) continue;
      for (const m of step.matchAll(/\$\(([^()]*)\)/g)) { const inner = changingStep(m[1], -1, -1); if (inner) return inner; }
      step = step.replace(/^\(+\s*(?=(?:cd|pushd|popd)\b)/, ''); // a subshell's `(cd dir && cat f)` moves only the subshell
      while (CONTROL_LEAD.test(step)) step = step.replace(CONTROL_LEAD, '');
      step = step.replace(/^(?:\w+=(?:"[^"]*"|'[^']*'|\$\([^()]*\)|[^\s;|&]*)\s*)+/, '');
      if (!/^command\s+-v\b/.test(step)) step = step.replace(PREFIX_WORDS, '');
      if (!step || CONTROL_ALONE.test(step)) continue;
      if (!READ_ONLY_STEP.test(step) || inPlaceFlag(step)) return stages[j].trim();
    }
  }
  return null;
}
// Called before every rewrite judgeShell makes. A runtime heredoc body is exempt: the rewrite already stands
// in for the whole script, which no step list can judge.
function refuseDroppedSteps(what) {
  if (!judging) return;
  // The judged stage itself: a heredoc body is judged whole, since its write can sit on another line than its path.
  const own = splitPipes(splitSegments(stripComments(judging.text))[judging.seg] || '')[judging.stage] || '';
  const writes = stageWrites(own, judging.runtime ? judging.text : null);
  const script = !writes && !judging.runtime && scriptFileRun(own);
  if (writes || script) {
    global.BLOCK_DETAIL = { branch: writes ? 'writer' : 'opaque-script', matched: (writes || script).slice(0, 40) };
    block((writes
      ? `Blocked: this command WRITES a file (\`${writes}\`) and names ${what} - nothing ran.\n` +
        `The shell route would replace it with a read-only redacted view, and the write would silently never happen.\n`
      : `Blocked: this command runs a script FILE (\`${script}\`) and names ${what} - nothing ran.\n` +
        `The guard cannot see what the script does, and the redacted view would silently stand in for its edit and its output.\n`) +
      `Make the edit with the Edit tool, old_string anchored on lines that hold no credential - it changes the file\n` +
      `without printing it. Then check it with a count (\`grep -c KEY <file>\`) or the presence read:\n` +
      `  node "${__filename}" --presence <file> [KEY ...]   (A.B.C reads a nested key)\n`);
  }
  if (judging.runtime) return;
  const step = changingStep(judging.text, judging.seg, judging.stage);
  if (!step) return;
  global.BLOCK_DETAIL = { branch: 'dropped-steps', matched: step.split(/\s+/)[0].slice(0, 40) };
  block(`Blocked: this command prints ${what} AND runs a step that changes something - nothing ran.\n` +
    `The shell route would replace the WHOLE command with the redacted form and silently drop that step:\n` +
    `  ${step.slice(0, 160)}\n` +
    `Run the changing steps as their own command (an in-place \`sed -i\` edit and a \`> file\` redirect pass this guard),\n` +
    `then check the result with a count (\`grep -c\`), \`jq '... | length'\`, or the presence read:\n` +
    `  node "${__filename}" --presence <file> [KEY ...]\n`);
}
// A FILTERING read (grep KEY <file>, jq .path <file>, head -5 <file>) asked for a slice, and the whole redacted
// file answered it. Measured: a one-key `grep -n -i '"email"'` came back as the full view (~1.3k tok), three
// times in one session. The filter now runs over the view instead: the file operand leaves the stage and the
// view is piped in. Only when the file is the stage's ONE file operand, spelled once, and not a `<` redirect;
// Bash tool only (the note goes to stderr, which a PowerShell pipe turns into an error record).
const FILTER_VERB = /^(?:grep|egrep|fgrep|rg|jq|head|tail|sed|awk|cut)(?=\s|$)/;
function narrowFilter(stages, tok) {
  const first = stages[0];
  if (!FILTER_VERB.test(first.replace(PREFIX_WORDS, ''))) return null;
  const words = shellTokens(first);
  if (words.filter((w) => w === tok).length !== 1) return null;
  if (words.some((w, k) => k > 0 && w !== tok && !w.startsWith('-') && candidatePaths(w).some((p) => statFile(p)))) return null;
  const at = first.match(new RegExp(`(^|\\s)${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`));
  if (!at || /<\s*$/.test(first.slice(0, at.index + at[1].length))) return null;
  const rest = (first.slice(0, at.index) + first.slice(at.index + at[0].length)).trim();
  return [rest, ...stages.slice(1).map((x) => x.trim())].join(' | ');
}

// A rewrite replaces the WHOLE command, so a compound READ-ONLY command came back as one
// `--redacted <file>` view and its other reads vanished with no note at all (replayed: a 4-part
// read-only command came back as 1 part, and 3 recovery calls followed at ~124k). Only the SEGMENT
// that named the credential file needs the view; every other segment is read-only by the time a
// rewrite is reached, because refuseDroppedSteps blocks a changing one. So the view is SPLICED in
// place and the rest of the command is kept as written. Three shapes keep the whole-command
// rewrite, with the dropped segments NAMED in a note the model reads: a heredoc body (the judged
// text is not the command), a split that fell back to the quote-blind form, and a command whose
// other segments name a credential file of their own or a path this guard cannot resolve - keeping
// those would let an unjudged read run, which is the one thing a rewrite must never do.
function namesCredentialFileIn(part) {
  const asg = part.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\s;|&]*)/);
  if (asg) VARS.set(asg[1], [asg[2].replace(/^(["'])([\s\S]*)\1$/, '$2')]);
  for (const stage of splitPipes(part)) {
    if (SELF_READ.test(stage)) continue; // this guard's own presence / redacted read
    const toks = shellTokens(stage).filter((t) => !t.startsWith('-') && /[\/.~$]/.test(t));
    for (const m of stage.matchAll(/(?:^|[^<])<\s*("[^"]*"|'[^']*'|[^\s;|&<>()]+)/g)) toks.push(m[1]);
    for (const m of stage.matchAll(/(["'`])([^"'`\n]{2,300})\1/g)) toks.push(m[2]);
    for (const tok of toks) {
      if (/\$\{?[A-Za-z_]/.test(tok) && !expandPath(tok)) return true; // unknowable - never kept
      for (const p of candidatePaths(tok)) { const f = statFile(p); if (f && secretInUnlessAllowed(f)) return true; }
    }
  }
  return false;
}
// A step's leading and trailing whitespace, in one linear pass each: the regex it replaces
// (`^(\s*)[\s\S]*?(\s*)$`) retried the trailing run at every character, 7.5s on 40,000 spaces.
function edgeSpace(s) {
  const lead = s.length - s.trimStart().length;
  return lead === s.length ? [s, ''] : [s.slice(0, lead), s.slice(s.trimEnd().length)];
}
function spliceOrWhole(view, file) {
  let parts = null;
  if (judging && judging.main) {
    const seps = [];
    parts = splitSegments(stripComments(judging.text), seps);
    if (seps.length === parts.length - 1 && judging.seg < parts.length) {
      const others = parts.filter((p, i) => i !== judging.seg);
      if (!others.some(namesCredentialFileIn)) {
        // the replaced segment keeps its own surrounding whitespace, so the command reads exactly as
        // the model wrote it with one step swapped
        const pad = [null, ...edgeSpace(parts[judging.seg])];
        let out = '';
        for (let i = 0; i < parts.length; i++) out += (i === judging.seg ? pad[1] + view + pad[2] : parts[i]) + (seps[i] || '');
        return out.trim();
      }
    }
  }
  // Not spliceable: the whole command is replaced, as before - but every step that goes with it is
  // NAMED. The silence was the cost (a 4-part command came back as 1 part and nothing said so), not
  // the replacement. The judged text is the base where it is the command; otherwise (a heredoc in
  // the command, a heredoc body) the command's own segments are, minus the one naming the file.
  const base = parts || splitSegments(stripComments(String(input.command || '')));
  const dropped = [];
  for (let i = 0; i < base.length; i++) {
    const p = base[i].trim().replace(/\s+/g, ' ');
    if (!p || (parts ? i === judging.seg : p.includes(String(file || '\u0000')))) continue;
    dropped.push(p.slice(0, 160));
  }
  if (!dropped.length) return view;
  const note = `# credential guard: ${dropped.length} other step(s) of this command were dropped - `
    + `run them on their own: ${dropped.join(' ; ')}`;
  return IS_PWSH ? `Write-Output ${psSingle(note)}; ${view}` : `echo "${shDouble(note)}"; ${view}`;
}

// ---- Shell matcher ----
// The COMMAND STRINGS a runtime hands to a shell are shell, and are judged as the shell they run: the first string
// argument of a call that runs one (node's exec / execSync, Python's os.system / os.popen / subprocess with a string,
// Ruby's system / Open3, PHP's shell_exec), the string after a shell's `-c` in an argument list, and Ruby or Perl
// backticks, %x{} and qx{}. Found beside the tilde rule (2.1.6): `execSync("cat ~/.aws/credentials")` and
// `os.system('env')` printed the file and the environment unjudged - the scan saw one string, `cat <path>`, no path.
const SHELL_CALL = /\b(?:execSync|exec|execAsync|system|popen|getoutput|getstatusoutput|check_output|check_call|run|call|Popen|capture2e?|capture3|shell_exec|passthru|proc_open)\s*\(\s*(["'])((?:(?!\1)[^\\\n]|\\.){1,300})\1/g;
const SHELL_CALL_NAME = new RegExp(`${SHELL_CALL.source.slice(0, SHELL_CALL.source.indexOf('\\s*\\('))}\\s*$`);
const SHELL_DASH_C =/(["'])(?:ba|z|da|k)?sh\1\s*,\s*(?:\[\s*)?(["'])-c\2\s*,\s*(["'])((?:(?!\3)[^\\\n]|\\.){1,300})\3/g;
const SHELL_BACKTICK = /`([^`\n]{1,300})`|%x\{([^}\n]{1,300})\}|\bqx\s*[{(]([^})\n]{1,300})[})]/g;
const shellStrings = (code, lang) => [
  ...[...code.matchAll(SHELL_CALL)].map((m) => m[2]),
  ...[...code.matchAll(SHELL_DASH_C)].map((m) => m[4]),
  ...(lang === 'ruby' || lang === 'perl' ? [...code.matchAll(SHELL_BACKTICK)].map((m) => m[1] || m[2] || m[3]) : []),
];
const spawnedShell = [];
// SHELL ROUTE: which tools carry a shell command (Bash, PowerShell, Monitor) is shell-writes.js's one list,
// shipped beside this hook on both routes. A copy that runs before it lands judges by the payload's shape - a
// string `command` - so a protective gate never goes quiet for want of a module.
let isShellTool = () => typeof input.command === 'string';
try { ({ isShellTool } = require(pathMod.join(__dirname, 'shell-writes.js'))); } catch { /* see above */ }
const IS_PWSH = payload.tool_name === 'PowerShell';
// A PowerShell single-quoted literal: nothing expands inside it, and `'` doubles.
const psSingle = (s) => `'${String(s).replace(/'/g, "''")}'`;
if (isShellTool(payload.tool_name)) {
  const raw = String(input.command || '');
  // A credential-shaped literal typed into a command is already in the transcript as the call's own
  // input; blocking still keeps it out of a file, a header and a remote, and names the rule. Judged
  // on the RAW text: a heredoc that writes the value into a file is the same leak. The denial names
  // the shape only - the value is never repeated.
  if (!receiptLive && SECRET_SHAPE.test(raw)) {
    block('Blocked: the command carries a credential-shaped literal (a token / key / JWT).\n' +
      'Per alfred-security.md a secret never passes through a tool call or the chat: the user puts it\n' +
      'in the file by hand, or runs a copy-ready command in their own terminal (getpass, not an argument).\n');
  }
  try {
  const code = [];
  const command = stripHeredocsOf(raw, code);
  // A whole-environment dump is replaced WHERE IT STANDS - its filter and every other step kept - and the
  // result is judged like any command, so a credential printed elsewhere still takes its own form.
  // A git command that prints file content gets the stream redactor piped in the same way (redactGitStages).
  const staged = !IS_PWSH && command === raw && !allowAll;
  const envStaged = staged ? redactEnvStages(raw) : raw;
  const inPlace = staged ? redactGitStages(envStaged) : raw;
  if (inPlace !== raw) { judgeShell(inPlace, false, true); rewrite(inPlace, { branch: envStaged !== raw ? 'env-stage' : 'git-stage' }); }
  // `main` says this text IS the command the tool will run - the one text a segment splice may
  // rebuild. A heredoc-blanked command is not (the bodies are spaces by then), and neither is a body.
  judgeShell(command, false, command === raw);
  // The heredoc bodies that ARE commands: a runtime body is judged as inline code, a shell body as
  // the shell it is.
  for (const h of code) {
    verbatimVars = h.runtime && h.verbatim ? envNamesIn(h.body) : null;
    judgeShell(h.body, h.runtime, false, h.lang);
    verbatimVars = null;
  }
  for (let n = 0; n < spawnedShell.length; n++) judgeShell(spawnedShell[n], false);
  } catch (err) {
    if (!(err instanceof JudgeBudget)) throw err;
    global.BLOCK_DETAIL = { branch: 'budget', matched: err.message };
    block(`Blocked: this command is too large or too deeply nested for the credential guard to judge inside its budget\n` +
      `(${err.message === 'depth' ? `brackets nested past ${JUDGE_MAX_DEPTH} levels` : `${JUDGE_WORK.max} characters of judging`}) - nothing ran. A command it cannot judge might print a\n` +
      `credential, so it is judged the safe way. Split it into smaller commands, or flatten the nesting.\n`);
  }
  process.exit(0);
}

// A print of a credential-shaped variable becomes that variable's presence line - the idiom the
// denial used to prescribe, run for the model instead of fed back to it - led by the note.
// On the PowerShell route the same line is spelled in PowerShell - the Bash form is a ParserError in
// pwsh - and reads the environment variable first, then a session variable of that name.
function blockVariable(name) {
  if (allowAll || allowedNames.has(name)) return; // the user's own allowance for this session
  refuseDroppedSteps(`the credential-shaped variable \`${name}\``);
  const note = noteLine(`\`${name}\` is a credential-shaped variable - shown as presence, not printed.`, receipt);
  if (IS_PWSH) {
    rewrite(`Write-Output ${psSingle(note)}; $cgv = [Environment]::GetEnvironmentVariable('${name}'); ` +
      `if (-not $cgv) { $cgv = Get-Variable -Name '${name}' -ValueOnly -ErrorAction SilentlyContinue }; ` +
      `if ($cgv) { Write-Output "${name}=set ($(([string]$cgv).Length) chars)" } else { Write-Output '${name}=absent' }`, { branch: 'variable', name });
  }
  rewrite(`echo "${shDouble(note)}"; [ -n "$${name}" ] && echo "${name}=set (\${#${name}} chars)" || echo "${name}=absent"`, { branch: 'variable', name });
}
// Every stage of `text` that dumps the whole environment, replaced by the masked listing IN PLACE: the rest of
// its pipeline (a filter) and every other step stay exactly as written, so nothing is dropped and a step that
// changes something needs no block. The benchmark pilot's `env | grep -i msbuild; env | grep -i dotnet_cli` was
// blocked - the second `env` read as a changing step - and the old whole-command rewrite dropped both filters.
// A quote-blind split (unbalanced quotes) changes nothing here; the stage-by-stage judge below takes it.
// The shape is blockEnvDump's own, inline: a const here would be in its dead zone when the Bash branch runs.
function redactEnvStages(text) {
  // The dump verb, then only fd redirections that stay on the terminal or go nowhere (`2>&1`, `2>/dev/null`).
  const dump = /^(env|printenv|export\s+-p|export|declare\s+-p|typeset\s+-p|set)((?:\s+\d*>&\d+|\s+\d*>\s*\/dev\/null)*)\s*$/;
  const seps = [];
  const segs = splitSegments(text, seps);
  if (seps.length !== segs.length - 1) return text;
  let changed = false;
  const out = segs.map((seg) => {
    const stages = splitPipes(seg);
    if (stages.join('|') !== seg) return seg;
    // judgeShell's own passes: output into a file never reaches the context, and a names-only reducer
    // (`env | cut -d= -f1`) is the presence read - neither is a dump to replace.
    if (!stages.some(teesToTerminal) && (redirectsToFile(seg) || stages.some(isReducer))) return seg;
    const hits = stages.map((st) => dump.exec(st.replace(PREFIX_WORDS, '').trim()));
    if (!hits.some(Boolean)) return seg;
    changed = true;
    const view = `node "${shDouble(__filename)}" --redacted-env${stages.length > 1 ? ' --note-to-stderr' : ''}`;
    return stages.map((st, i) => { if (!hits[i]) return st; const [lead, trail] = edgeSpace(st); return lead + view + hits[i][2] + trail; }).join('|');
  });
  return changed ? out.map((seg, i) => seg + (seps[i] || '')).join('') : text;
}

// Every stage of `text` that is a git command printing file content, and whose output would carry a credential,
// gets `| node <this file> --redact-stdin` right after it, where it stands - its own filter and every other step
// kept (I2, 2.1.4 audit). Whether it would is PROBED first (gitOutputLeaks): the rewritten call carries a `node`
// stage the permission system has never seen, so an unconditional pipe would make every read-only `git diff`
// ask. Left as written: a stage whose output goes into a file or a reducer (the env pass's own rule), a summary
// form (`--stat`, `--name-only`), and `--quiet` / `--exit-code`, where git's exit status IS the answer and a pipe
// would replace it with the redactor's - a stated ceiling: `git diff --exit-code` prints unmasked. Bash-family
// only, like the env pass: PowerShell re-encodes what it pipes to a native command.
function redactGitStages(text) {
  const REDACT = /guard-secret-value\.js["']?\s+--redact-stdin\b/;
  const seps = [];
  const segs = splitSegments(text, seps);
  if (seps.length !== segs.length - 1) return text;
  let changed = false;
  // The probe runs NOW, before any step of the command, so it reads the wrong tree once an earlier step moves
  // the shell (`cd`) or changes what git sees (`git add -N .` - the security-review diff's own first step, which
  // printed a new file's credential unmasked; final review IM1). changingStep's allowlist decides the second.
  let moved = false;
  const out = segs.map((seg, n) => {
    if (/^\s*(?:\(\s*)?(?:cd|pushd|popd)\b/.test(seg) || (n > 0 && changingStep(segs[n - 1], -1, -1))) moved = true;
    const stages = splitPipes(seg);
    if (stages.join('|') !== seg || stages.some((st) => REDACT.test(st))) return seg;
    if (!stages.some(teesToTerminal) && (redirectsToFile(seg) || stages.some(isReducer))) return seg;
    const hits = stages.map((st) => gitPrintsContent(st) && (moved || gitOutputLeaks(st)));
    if (!hits.some(Boolean)) return seg;
    changed = true;
    const view = `node "${shDouble(__filename)}" --redact-stdin`;
    return stages.map((st, i) => (hits[i] ? `${st.replace(/\s+$/, '')} | ${view}${st.match(/\s*$/)[0]}` : st)).join('|');
  });
  return changed ? out.map((seg, i) => seg + (seps[i] || '')).join('') : text;
}
// True for a git stage whose output carries file CONTENT: `diff` and `show` unless a summary or no-patch form
// asks for less, `log` / `whatchanged` / `stash show` only with a patch flag, `cat-file` with `-p` / a type. Git's own options before the
// subcommand (`-C <dir>`, `-c <k=v>`, `--no-pager`) are skipped.
function gitPrintsContent(stage) {
  const w = shellTokens(stage.replace(PREFIX_WORDS, '').trim()).map((t) => t.replace(/^(['"])([\s\S]*)\1$/, '$2'));
  if (!/^git(?:\.exe)?$/i.test(w[0] || '')) return false;
  let i = 1;
  while (i < w.length && w[i].startsWith('-')) i += /^(?:-C|-c|--git-dir|--work-tree|--namespace|--exec-path|--config-env)$/.test(w[i]) ? 2 : 1;
  const sub = w[i];
  const args = w.slice(i + 1);
  if (args.some((a) => /^(?:--quiet|--exit-code|--no-patch|-s)$/.test(a))) return false;
  const patch = args.some((a) => /^(?:-p|--patch|-u|-U\d*|--unified(?:=\d+)?|--patch-with-stat|--patch-with-raw|-L.+)$/.test(a));
  const summary = args.some((a) => /^(?:--stat(?:=.*)?|--numstat|--shortstat|--name-only|--name-status|--summary|--dirstat(?:=.*)?|--raw|--check)$/.test(a));
  if (sub === 'diff' || sub === 'show') return patch || !summary;
  if (sub === 'log' || sub === 'whatchanged') return patch;
  if (sub === 'stash') return args[0] === 'show' && patch;
  if (sub === 'cat-file') return args.some((a) => /^(?:-p|blob|--textconv|--filters)$/.test(a)); // prints a blob whole (seam m5)
  return false;
}
// Would this git stage print something lineRedactor masks? It is run here the way the stack's other guards read
// git (argv, never a shell; 3s and 8MB at most; no optional locks), with every hook a repository can attach to a
// read switched off (`--no-ext-diff`, `--no-textconv`, `core.fsmonitor=false`). What it cannot run as written -
// a word the shell would expand, config given on the command line, a flag that writes (`--output`) - or a run
// that fails, times out or overflows, counts as a leak, so that stage is piped unprobed: the safe side.
function gitOutputLeaks(stage) {
  const raw = shellTokens(stage.replace(PREFIX_WORDS, '').trim());
  if (raw.some((t) => !/^'[^']*'$/.test(t) && (/[$`*?[{\\]/.test(t) || /^~/.test(t)))) return true;
  const w = raw.map((t) => t.replace(/^(['"])([\s\S]*)\1$/, '$2'));
  let i = 1;
  while (i < w.length && w[i].startsWith('-')) {
    if (/^(?:-c|--config-env|--exec-path)(?:=|$)/.test(w[i])) return true;
    i += /^(?:-C|--git-dir|--work-tree|--namespace)$/.test(w[i]) ? 2 : 1;
  }
  const at = w[i] === 'stash' ? i + 2 : i + 1;
  if (w.slice(at).some((a) => /^--output(?:=|$)/.test(a))) return true;
  if (w[i] === 'cat-file' && w.some((a) => /^--(?:textconv|filters)$/.test(a))) return true; // runs a repository's own driver
  const argv = ['-c', 'core.fsmonitor=false', ...w.slice(1, at), ...(w[i] === 'cat-file' ? [] : ['--no-ext-diff', '--no-textconv', '--no-color']), ...w.slice(at)];
  const r = require('child_process').spawnSync('git', argv, {
    cwd: (payload && payload.cwd) || process.env.CLAUDE_PROJECT_DIR || process.cwd(), timeout: 3000, maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat', PAGER: 'cat' },
  });
  // Exit 1 is `diff --no-index`'s 'the files differ', with the diff on stdout.
  if (r.error || (r.status !== 0 && r.status !== 1)) return true;
  const red = lineRedactor();
  for (const l of String(r.stdout || '').split('\n')) red.line(l);
  return red.masked() > 0;
}

// A declaration, not a const: judgeShell runs from the Bash branch ABOVE these lines, so an arrow
// bound here would still be in its temporal dead zone and the gate would throw instead of judging.
// A whole-environment dump becomes the masked listing.
function blockEnvDump() {
  if (allowAll) return; // only `*` covers every variable at once
  refuseDroppedSteps('the whole environment');
  rewrite(IS_PWSH ? `node ${psSingle(__filename)} --redacted-env` : `node "${shDouble(__filename)}" --redacted-env`, { branch: 'env' });
}

// PowerShell prints a value four ways Bash does not: a bare expression statement (`$env:NAME`,
// `"$env:NAME"`, `[Environment]::GetEnvironmentVariable('NAME')`), a Write-* cmdlet, the env: drive
// (`Get-Item env:NAME`, `Get-ChildItem env:` - the whole environment), and the .NET listing
// `[Environment]::GetEnvironmentVariables()`. A USE - `if ($env:NAME)`, `$env:NAME.Length`, a header
// argument to curl.exe - prints nothing, the same line the Bash branch draws for `curl -d "$TOKEN"`.
// Declarations only inside: the shell branch runs ABOVE this point, so a top-level const here would
// still be in its temporal dead zone.
function judgePwshStage(stage) {
  const PS_ENV_REF = /\$\{?env:([A-Za-z_][A-Za-z0-9_]*)\}?/gi;
  const PS_GETENV = /\[(?:System\.)?Environment\]::GetEnvironmentVariable\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/gi;
  const s = stage.trim();
  const secretOf = (re, text) => [...text.matchAll(re)].map((m) => m[1]).find((n) => SECRET_KEY_RE.test(n));
  // env: drive - a named item prints that variable, anything else lists the environment.
  const drive = s.match(/^\(?\s*(?:get-item|gi|get-childitem|gci|dir|ls)\s+(?:-path\s+|-literalpath\s+)?['"]?env:\\?([^\s'")|]*)/i);
  if (drive) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(drive[1])) { if (SECRET_KEY_RE.test(drive[1])) blockVariable(drive[1]); } else blockEnvDump();
  }
  if (/^\[(?:System\.)?Environment\]::GetEnvironmentVariables\(\s*\)/i.test(s)) blockEnvDump();
  // A bare expression statement is printed by the host.
  const bare = s.match(/^"?\$\{?(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}?"?$/i) || s.match(/^\[(?:System\.)?Environment\]::GetEnvironmentVariable\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\)$/i);
  if (bare && SECRET_KEY_RE.test(bare[1])) blockVariable(bare[1]);
  // The print verbs, PowerShell's own included.
  if (/^(?:echo|write-output|write-host|write-information|write|out-host)\b/i.test(s)) {
    const hit = secretOf(PS_ENV_REF, s) || secretOf(PS_GETENV, s);
    if (hit) blockVariable(hit);
  }
}

// A first-flag `sed -i` is an edit, not a dump - unless its script writes to a terminal stream, runs a command, or
// sits in a file the guard cannot read (review M1: `sed -i '' 's/TOKEN.*/&/w /dev/stdout' <file>` printed the
// credential line). Such a segment is judged like any other, so its in-place flag blocks it on a credential file.
// Loose on purpose: a false hit costs only an Edit-tool denial on a credential file. The patterns live inside the
// function because judgeShell runs above this line, before a module-level const would be initialised.
function sedScriptLeaks(seg) {
  const terminalWrite = /[wW]\s*\/(?:dev\/(?:std(?:out|err)|tty|fd\/[12])|proc\/self\/fd\/[12])\b/;
  const exec = /(?:^|[;{}\n'"])\s*(?:\d+|\$)?(?:\s*,\s*(?:\d+|\$))?\s*!?\s*e(?=[\s;}'"]|$)|[^\w\s\\;{}'"-]\s*[gpiImM0-9]*e[gpiImM0-9]*(?=[\s;}'"]|$)/;
  const scriptFile = /\s(?:-[a-zA-Z]*f\b|--file\b)/;
  return terminalWrite.test(seg) || exec.test(seg) || scriptFile.test(seg);
}

// The bare operands of a stage whose COMMAND is a dump verb (`cat credentials`), and the directory `env -C` runs it in.
// A pattern-first verb's first operand is its pattern or script, never a file (`grep -n credentials notes`), unless
// -e / -f gave it; a flag's value is skipped where the flag takes one. A dump verb merely NAMED in the stage
// (`find . -type f`) makes no operand.
function bareOperands(words) {
  let k = 0;
  let dir = null;
  if (/^env$/i.test(words[0] || '')) {
    for (k = 1; k < words.length; k++) {
      const w = words[k];
      if (/^(?:-C|--chdir)$/.test(w)) { dir = words[++k] || null; continue; }
      if (/^--chdir=/.test(w)) { dir = w.slice(8); continue; }
      if (/^-C./.test(w)) { dir = w.slice(2); continue; }
      if (/^(?:-u|--unset|-S|--split-string)$/.test(w)) { k++; continue; }
      if (w.startsWith('-') || /^[A-Za-z_]\w*=/.test(w)) continue;
      break;
    }
  }
  const verb = String(words[k] || '').replace(/^["']|["']$/g, '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '');
  if (FILE_ROUTE.test(verb)) return { dir, names: routeFiles(verb, words.slice(k + 1)) };
  const hit = DUMP_VERB.exec(verb);
  if (!hit || hit[0].length !== verb.length) return { dir, names: [] };
  const v = verb.toLowerCase();
  // The short options of each dump verb that take a value (`head -n 20`, `cut -d , -f 1`), so the value is no operand;
  // grep's, sed's and awk's e / f and jq's f carry the pattern or script. A verb missing here reads every short
  // option as a flag, and a value it then takes for an operand is only one more name tried as a file.
  const VALUE_FLAGS = {
    head: 'nc', tail: 'ncs', grep: 'efmABCdD', rg: 'efmABCtTgM', sed: 'efl', awk: 'efvF', jq: 'fL', cut: 'dfcb',
    sort: 'ktoST', uniq: 'fsw', fold: 'w', od: 'tjNAw', xxd: 'lscgo', base64: 'w', nl: 'bdfhilnsvw', strings: 'not',
    paste: 'd', column: 'sc', bat: 'lrHm', tac: 's', hexdump: 'efns', pr: 'hlowWsSNe', comm: '', diff: 'UCLIxX', sdiff: 'owWI',
  };
  if (v === 'tee') return { dir, names: [] }; // its operands are the files it WRITES
  const patternFirst = /^(?:grep|egrep|fgrep|rg|sed|[gmn]?awk|jq)$/.test(v);
  const takes = VALUE_FLAGS[v.replace(/^[gmn](?=awk$)|^[ef](?=grep$)/, '')] || '';
  let patternGiven = !patternFirst;
  const names = [];
  for (k++; k < words.length; k++) {
    const w = words[k];
    if (w === '--') continue;
    if (/^--/.test(w)) {
      if (/^--(?:regexp|file|from-file)$/.test(w)) { patternGiven = true; k++; } else if (/^--(?:regexp|file|from-file)=/.test(w)) patternGiven = true;
      else if (/^--(?:arg|argjson|slurpfile|rawfile)$/.test(w)) k += 2;
      else if (/^--(?:max-count|after-context|before-context|context|lines|bytes|indent|glob|type|type-not|delimiter|fields|key|field-separator|width)$/.test(w)) k++;
      continue;
    }
    if (/^-./.test(w) && !/^-\d/.test(w)) {
      // a short bundle: the first letter that takes a value takes the rest of the bundle, or else the next word
      for (let i = 1; i < w.length; i++) {
        if (!takes.includes(w[i])) continue;
        if (patternFirst && /[ef]/.test(w[i])) patternGiven = true;
        if (i + 1 === w.length) k++;
        break;
      }
      continue;
    }
    if (!patternGiven) { patternGiven = true; continue; }
    if (!/[\/.~$]/.test(w)) names.push(w.replace(/^\(+/, '').replace(/(?<!\))\)+$/, ''));
  }
  return { dir, names };
}

function judgeShell(text, forceRuntime, main, bodyLang) {
  cwdAnchor = null;
  // a heredoc body binds a path statements before it reads it, so its built paths come from the whole body
  const builtInBody = forceRuntime ? builtPaths([text]) : null;
  if (forceRuntime) spawnedShell.push(...shellStrings(text, bodyLang));
  const segments = splitSegments(stripComments(text));
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    // A `NAME=value` assignment, or a `for NAME in <list>`, binds the path the NEXT segment dumps.
    const asg = seg.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\s;|&]*)/);
    if (asg) VARS.set(asg[1], [asg[2].replace(/^(["'])([\s\S]*)\1$/, '$2')]);
    const loop = seg.match(/^\s*for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^\n;]+)/);
    if (loop) VARS.set(loop[1], shellTokens(loop[2]).filter((t) => t !== 'do').slice(0, 20));
    const cd = seg.match(/^\s*(?:\(\s*)?(?:cd|pushd)\s+("[^"]*"|'[^']*'|[^\s;|&()]+)/); // a subshell's `(cd dir && ...)` too
    if (cd) {
      const d = expandPath(cd[1]);
      if (d && d !== '-') cwdAnchor = pathMod.isAbsolute(d) ? d : pathMod.join(cwdAnchor || anchorDirs()[0] || '.', d);
    }

    const stages = splitPipes(seg);
    // A tee to a terminal device prints the file whatever the pipeline does next, so neither the
    // redirect skip nor the presence exemption applies to a segment carrying one.
    if (!stages.some(teesToTerminal)) {
      if (redirectsToFile(seg)) continue; // output into a file never reaches the context
      if (stages.some(isReducer)) continue;
    }
    if (/\bsed\s+(?:-\w*i|--in-place)\b/.test(seg) && !sedScriptLeaks(seg)) continue; // an edit, not a dump

    for (let sj = 0; sj < stages.length; sj++) {
      const stage = stages[sj];
      judgeTick(1 + stage.length);
      judging = { text, seg: si, stage: sj, runtime: forceRuntime, main };
      // The sanctioned read is exempt by name - it is this file - and only in its OWN stage: the
      // exemption used to cover the whole segment, so `--presence <file> | cat <file>` passed.
      if (/guard-secret-value\.js["']?\s+--(?:presence|redacted(?:-env)?|redact-stdin)\b/.test(stage)) continue;
      if (!forceRuntime && !IS_PWSH) spawnedShell.push(...shellRunStrings(stages, sj));

      // Printing a credential-shaped VARIABLE: echo / printf with $NAME or ${NAME...}, printenv NAME.
      // `${#NAME}` is a length - the presence idiom - and `[ -n "$NAME" ]` is a test, so only the
      // arguments of a PRINT verb are judged - and only within the verb's own pipeline STAGE: a
      // variable in a later `grep -v "$X"` stage is not printed, and a `curl -d "$TOKEN"` stage is a
      // use, not a print (the value never enters the transcript). EVERY print verb in the stage is
      // judged, not just the first - the arguments of `echo` swallowed `$(printenv NAME)` whole.
      const verbs = [...stage.matchAll(/(?:^|[\s(])(echo|printf|printenv)\b/g)];
      for (let i = 0; i < verbs.length; i++) {
        const args = stage.slice(verbs[i].index + verbs[i][0].length, i + 1 < verbs.length ? verbs[i + 1].index : stage.length);
        const names = [...args.matchAll(/\$\{?(?!#)([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
        if (verbs[i][1] === 'printenv') {
          names.push(...shellTokens(args).map((w) => w.replace(/[^A-Za-z0-9_]/g, '')).filter((w) => /^[A-Za-z_]\w*$/.test(w)));
        }
        const hit = names.find((n) => SECRET_KEY_RE.test(n));
        if (hit) blockVariable(hit);
      }
      if (IS_PWSH) judgePwshStage(stage);
      // `declare -p NAME` / `typeset -p NAME` print one variable's value, like printenv NAME.
      const dp = stage.replace(PREFIX_WORDS, '').match(/^(?:declare|typeset)\s+-p\s+([^\n|]+)/);
      if (dp) { const hit = shellTokens(dp[1]).find((n) => SECRET_KEY_RE.test(n)); if (hit) blockVariable(hit); }

      // A whole-environment dump prints every exported credential. `env` as a command PREFIX
      // (`env FOO=bar cmd`) runs a command; only a bare dump verb (or one piped onward) dumps - and a
      // prefix word of its own (`sudo env`, `command printenv`, `FOO=bar env`) changes nothing. The
      // shell's OWN listings (`set`, `export`, `declare -p`) print the same values and passed every
      // probe until the review; their argument-carrying forms (`set -e`, `export FOO=x`) do not match.
      if (!forceRuntime && /^(?:env|printenv|export\s+-p|export|declare\s+-p|typeset\s+-p|set)\s*(?:(?:\d*>&\d+|\d*>\s*\/dev\/null)\s*)*(?:\||$)/.test(stage.replace(PREFIX_WORDS, ''))) blockEnvDump();

      // A runtime reading the environment - `node -e "console.log(process.env.SENTRY_ACCESS_TOKEN)"`
      // is `echo $SENTRY_ACCESS_TOKEN` with more syntax. The denial names the VARIABLE, never a value.
      const isRuntime = forceRuntime || RUNTIME.test(stage);
      if (isRuntime) {
        const stageLang = forceRuntime ? bodyLang : runtimeLang(shellTokens(stage.replace(PREFIX_WORDS, '').trim())[0] || '');
        const own = ENV_OF[stageLang];
        if (!forceRuntime) for (const script of inlineScripts(stage)) spawnedShell.push(...shellStrings(script, stageLang));
        for (const re of own ? own.named : ENV_NAMED) for (const m of stage.matchAll(re)) if (SECRET_KEY_RE.test(m[1])) blockVariable(m[1]);
        if ((own ? own.bare : ENV_BARE).test(stage.replace(ENV_REDUCED, ' keys ')) && RUNTIME_PRINT.test(stage)) blockEnvDump();
      }

      // A stage whose only verb PRINTS reads no file: `printf '%s\n' '<a rotation one-liner>'`
      // emits a snippet for the USER to run, and the runtime word inside the quoted string is DATA,
      // not an execution. Measured: this guard rewrote the credential-ROTATION command the stack had
      // just asked the user to run into a `--redacted` dump of the settings file, so the snippet
      // never reached them and the exposed token stayed live - and at HEAD the substitution was
      // SILENT, which is worse than the visible block it replaced. The credential-literal scan (well
      // above, on the whole command) and the variable and env-dump scans (earlier in this stage)
      // have already run, so this skips the file-candidate scan alone: `echo $SECRET` and a
      // credential typed into the command are still caught, a stage merely QUOTING a path is not.
      if (/^(?:echo|printf)\b/.test(stage.replace(PREFIX_WORDS, '')) && !/\$\{?[A-Za-z_]/.test(stage)) continue;
      // ...and a runtime stage that prints only a KEY LIST is the sanctioned presence read, so it
      // passes through as written rather than becoming a whole-file redacted dump.
      if (isRuntime && printsKeysOnly(stage)) continue;

      // What flows INTO the stream redactor comes out masked, so the stage feeding it reads no file here - its
      // printed variables and environment dumps were judged above, and the redactor masks by line, not by file.
      if (/guard-secret-value\.js["']?\s+--redact-stdin\b/.test(stages[sj + 1] || '')) continue;
      // A dump verb or a runtime read on a file that HOLDS a credential - judged by content, not path.
      homeAnchor = isRuntime && /homedir|expanduser|USERPROFILE|HOME/.test(stage);
      const candidates = [];
      if (DUMP_VERB.test(stage) || isRuntime) for (const tok of shellTokens(stage)) if (!tok.startsWith('-') && /[\/.~$]/.test(tok)) candidates.push(tok.replace(/^\(+/, '').replace(/(?<!\))\)+$/, ''));
      // A BARE operand of a dump verb is a file name too (review B2 of 2.1.6: `cd ~/.aws && cat credentials` passed while
      // `cat ~/.aws/credentials` was rewritten) - tried against where the shell stands: a `cd` / `pushd` before it,
      // `env -C <dir>` in the stage, the session's own directory. The command word itself is no operand.
      const stageAnchor = cwdAnchor;
      if (!isRuntime) {
        const bare = bareOperands(shellTokens(stage.replace(PREFIX_WORDS, '').replace(/^\s*\(+/, '')));
        if (bare.dir) { const d = expandPath(bare.dir); if (d) cwdAnchor = pathMod.isAbsolute(d) ? d : pathMod.join(cwdAnchor || anchorDirs()[0] || '.', d); }
        candidates.push(...bare.names);
      }
      // A runtime spells the path inside its own code - single, double or backtick quoted. No runtime expands `~` on its
      // own, so a `~/` string there is text (documentation between backticks, a message) unless the code expands the tilde
      // or the runtime is PowerShell, whose provider paths do; a body whose language has no row keeps it.
      const tildeRead = !isRuntime || TILDE_EXPANDER.test(stage) || /\b(?:pwsh|powershell)\b/i.test(stage) || (forceRuntime && !bodyLang);
      if (isRuntime) for (const m of stage.matchAll(/(["'`])([^"'`\n]{2,300})\1/g)) if (tildeRead || !m[2].startsWith('~')) candidates.push(m[2]);
      // ... or builds it from a directory it reads at run time (builtPaths)
      if (isRuntime) candidates.push(...(builtInBody || builtPaths(inlineScripts(stage))));
      // `< file` feeds the file to whatever the stage runs, `while read` and `done < file` included -
      // the same read as `cat file`, which is why `cat < file` already blocked.
      for (const m of stage.matchAll(/(?:^|[^<])<\s*("[^"]*"|'[^']*'|[^\s;|&<>()]+)/g)) candidates.push(m[1]);
      for (const tok of candidates) {
        for (const p of candidatePaths(tok)) {
          const file = statFile(p);
          if (!file) continue;
          const key = secretInUnlessAllowed(file);
          if (!key) continue;
          // The FIRST credential file wins and the whole call becomes its redacted view - the rest of
          // a compound command is dropped rather than spliced, so the rewritten call is always one the
          // model can read back whole; a dropped step that CHANGES something blocks instead.
          refuseDroppedSteps(`${file}, which holds a credential under \`${key}\``);
          const view = IS_PWSH ? `node ${psSingle(__filename)} --redacted ${psSingle(file)}` : `node "${shDouble(__filename)}" --redacted "${shDouble(file)}"`;
          const narrow = !IS_PWSH && !isRuntime && sj === 0 && narrowFilter(stages, tok);
          rewrite(spliceOrWhole(narrow ? `${view} --note-to-stderr | ${narrow}` : view, file), { branch: 'file', file: pathMod.basename(file) });
        }
      }
      cwdAnchor = stageAnchor; // `env -C` moves only its own stage
    }
  }
}

// ---- Read matcher ----
// The settings.json permissions.deny already stops a Read of the ACCOUNT files by path; this is the
// content-judged complement for everything the path list cannot name - a project settings.json
// holding a misplaced token, a dotenv, an appsettings.json.
if (payload.tool_name === 'Read') {
  const file = resolveFile(String(input.file_path || ''));
  const key = file && secretInUnlessAllowed(file);
  if (key) block(`Blocked: Read of ${file}, which holds a credential under \`${key}\`.\n` + presenceHint(file));
}

// The Grep TOOL is the third read route onto the same file, and it was ungated: measured live, a
// Bash read of a project settings.json was blocked and eight seconds later a Grep with
// `output_mode: content` on the SAME path returned its lines - nothing leaked only because the
// pattern happened to select non-credential keys. Only the CONTENT mode prints values;
// `files_with_matches` (the default) and `count` return a path or a number and are never blocked,
// which keeps 'does this file mention SENTRY_SLUG' a free question.
if (payload.tool_name === 'Grep') {
  // The Bash route blocks a credential-shaped LITERAL typed into the command; the Grep tool takes
  // the same literal in `pattern` and nothing judged it, so the value the shell route refuses was
  // free through the search tool. The pattern is the call's own input and lands in the transcript
  // whatever the search returns - judged here by the same shape test, in every output mode.
  if (!receiptLive && SECRET_SHAPE.test(String(input.pattern || ''))) {
    block('Blocked: the Grep pattern carries a credential-shaped literal (a token / key / JWT).\n'
      + 'Per alfred-security.md a secret never passes through a tool call or the chat, and a search\n'
      + 'pattern is a tool input like any other - it is in the transcript before the first match is.\n'
      + 'Search for the KEY NAME instead, or ask presence:\n'
      + `  node "${__filename}" --presence <file> [KEY ...]\n`);
  }
  if (String(input.output_mode || 'files_with_matches') === 'content') {
    const target = String(input.path || '');
    // Only a NAMED file is judged. A directory target, and a search with no path at all, is a tree
    // walk this guard does not judge - a known gap, not a covered case: the pattern would have to be
    // matched against every credential-bearing file the walk reaches. The Read and shell routes still
    // gate every named read of those files.
    const roots = target ? [target] : [];
    for (const r of roots) {
      const file = resolveFile(r);
      if (!file) continue;
      let st = null;
      try { st = fs.statSync(file); } catch { st = null; }
      if (st && st.isDirectory()) continue;
      const key = secretInUnlessAllowed(file);
      if (key) {
        block(`Blocked: Grep -> content of ${file}, which holds a credential under \`${key}\`.\n` +
          `A content-mode Grep PRINTS the matching lines, so it is the same value read the Read and\n` +
          `shell routes already block - just spelled as a search. Use \`output_mode: "count"\` or\n` +
          `\`"files_with_matches"\` to ask whether the key is there, or the presence route for what it holds.\n` +
          presenceHint(file));
      }
    }
  }
}
process.exit(0);
