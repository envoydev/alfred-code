#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// alfred-security.md's rule that a credential is read for its PRESENCE, never its value - mechanized. Measured: the
// rule held only as prose, and a session checking whether SENTRY_ACCESS_TOKEN was set printed the whole env block on
// its first attempt. Since swap 1 of the complexity audit (2026-11-11) secrets are judged by what a command PRINTED:
//   PostToolUse (Bash)         - THE OUTPUT MASKER: each credential value this run can name comes back as
//                                <set (N chars)>; a failed call and a Cursor payload are observed only
//   PreToolUse (the shell)     - a credential-shaped literal, a copy of the store, and a print no mask can cover
//                                (a comparison, an encoder, a print that is not alone) are refused; where no masker
//                                runs, any command whose words name a credential file is (the deny-on-name core)
//   PreToolUse (Read, Grep, a filesystem server's reads) - a credential file is refused
// The sanctioned reads are this file's own CLI modes, so a denial always names a route that exists wherever the guard does:
//   node guard-secret-value.js --presence <file> [KEY ...]   ->   KEY=set (N chars) | KEY=empty (present, no value) | KEY=absent
//   node guard-secret-value.js --redacted <file>            ->   the file, credential values masked
//   node guard-secret-value.js --redacted-env               ->   the environment, the same way
// exit 2 = block (stderr fed back); exit 0 = allow, or the masker's JSON answer on stdout.
'use strict';
const fs = require('fs');
const os = require('os');
const pathMod = require('path');

// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them, never inlined in every
// hook. Fail-open on purpose - no prelude, no project dir or a malformed settings file all leave
// this hook running.
let envOf = (env, suffix) => env[`ALFRED_CODE_${suffix}`];
// R86: a repo never set up keeps this guard live but gets no block row (R54) - false fails open to logging.
let unsetRepo = false;
let twinYield = null;
if (require.main === module) {
  let off = false;
  try {
    const prelude = require('./hook-prelude.js');
    envOf = prelude.envOf;
    // The twin yield waits for the payload's session (E-batch final review M1): a twin wired mid-session never stands it down.
    off = prelude.standDown('guard-secret-value', undefined, undefined, { twin: false });
    twinYield = (session) => prelude.yieldToCopiedTwin('guard-secret-value', undefined, { session });
    unsetRepo = prelude.neverSetUp();
  } catch { /* an install without the prelude runs the hook unchanged */ }
  // Outside the try: the shell-guard dispatcher runs this file in-process, where that catch would swallow the exit.
  if (off) process.exit(0);
}
// The docs root: <data root>/docs - a leftover ALFRED_CODE_DOCS_PATH (retired in 2.8.0) read first (hook-prelude.js envOf).
// data-root-reader (meta/shared-rules.json): the data root is always .alfred. An absolute ALFRED_CODE_DATA_PATH is a
// harness's scratch and is kept; anything else is .alfred.
const dataRoot = (env = process.env) => { const raw = String(envOf(env, 'DATA_PATH') || '').trim().replace(/\\/g, '/'); return /^(?:\/|[A-Za-z]:\/)/.test(raw) ? raw.replace(/\/+$/, '') || '.alfred' : '.alfred'; };
const docsRootEnv = () => envOf(process.env, 'DOCS_PATH') || `${dataRoot()}/docs`;

// Keys whose value is a credential - the SAME string as meta/environment.json `secret_key_pattern`
// (npm run lint fails when the two differ), matched case-insensitively so `apiKey` and `API_KEY`
// judge alike. The hook ships without meta/, hence the copy.
const SECRET_KEY_SOURCE = '(TOKEN|SECRET|KEY|PASSWORD|PASSWD|DSN|CREDENTIAL|AUTH)$';
const SECRET_KEY_RE = new RegExp(SECRET_KEY_SOURCE, 'i');
// The value shapes the stack's credentials take - copied from guard-stop-contract.js; keep identical.
const SECRET_SHAPE = /\b(sntryu_[0-9a-f]{16,}|ctx7sk-[0-9a-f-]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|glpat-[0-9A-Za-z_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/;
// A credential file is small - a settings.json is under 10 KB - so the cap costs this gate nothing
// on the files it exists for. Past it a file is judged by its FIRST MAX_BYTES, and a Read naming
// `offset` / `limit` by the lines it asks for (audit 2026-10-30 HK-07: a 600KB dotenv and a 910KB
// terraform state holding a DB password passed every route) - scanning megabytes on every Bash call
// would cost every session for that one shape. The stated ceiling: a credential past the first
// MAX_BYTES of a file printed whole (no window) is not seen.
const MAX_BYTES = 512 * 1024;
// The Grep tool's tree walk ceilings (walkCredentialFile); past one a walk is unjudged.
const WALK_FILES = 4000;
const WALK_BYTES = 32 * 1024 * 1024;
const WALK_ENTRIES = 100000;
const WALK_LAST = /^(?:\.venv|venv|\.tox|\.nox|__pycache__|vendor|target|dist|build|out|bin|obj|\.next|\.nuxt|\.gradle|\.terraform|Pods|bower_components|\.cache|site-packages)$/;

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
// A companion catalog's `auth` / `noKey` mode values say HOW a server authenticates, not a credential (SG1 D1).
// Exact and case-sensitive: a new word is one entry, and anything not listed stays guarded (fails closed).
const MODE_WORDS = new Set(['token', 'oauth', 'optional-token']);
// A value that IS an identifier NAME names a credential, it is not one: SCREAMING_SNAKE with at
// least one underscore, no lower case, nothing else in it. Measured: this stack's OWN catalogs are
// lists of variable names under a field literally called `key`, so `meta/environment.json`
// (`env.0.key` = `ALFRED_CODE_DOCS_VERSIONING`) and `meta/migrations.json`
// (`detect.settings_env_key` = `ALFRED_CODE_FRESH_SESSION_PCT`) were read as credential files - on the Read
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
// A field named exactly `key` is most often an IDENTIFIER - measured: a Confluence page's `space.key = "SD"` blocked
// its Read. There the value must look like a credential: a known shape, or 16+ characters, no whitespace, at least two
// character classes. `apiKey`, `api_key`, `SECRET_KEY` are judged as before. A YAML or INI pair arrives under its
// dotted path (`space.key`), so the last segment is the name.
const BARE_KEY = /(?:^|[.:])key$/i;
// A lowercase name in short separated words (`customfield_10010`, `team-alpha-board`) is an identifier, not a token.
const IDENTIFIER = /^[a-z][a-z0-9]{0,15}(?:[_.-][a-z0-9]{1,12})+$/;
const credentialLike = (s) => SECRET_SHAPE.test(s)
  || (s.length >= 16 && !/\s/.test(s) && !IDENTIFIER.test(s) && [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(s)).length >= 2);
const isSampleValue = (key, v) => {
  const s = String(v).trim();
  if (PEM_PRIVATE.test(s)) return false;
  if (MODE_WORDS.has(s)) return true;
  if (BARE_KEY.test(String(key)) && !credentialLike(s)) return true;
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
// A `Bearer <token>` under any key (SG1 Change 1; RFC 6750 section 2.1's b64token): the space excused the whole value
// as a sample, so the token alone is judged - a known shape, or a credential-like token with no sample tell.
const EMBEDDED_BEARER = /(\bBearer +)([A-Za-z0-9\-._~+/]+=*)(?![A-Za-z0-9\-._~+/=$%{#])/gi;
const bearerToken = (t) => isLive(t) && (SECRET_SHAPE.test(t) || (credentialLike(t) && holdsCredential('password', t)));
const embeddedCredential = (v) => typeof v === 'string'
  && ([...v.matchAll(EMBEDDED_PAIR), ...v.matchAll(EMBEDDED_URL)].some((m) => holdsCredential('password', m[2]))
    || [...v.matchAll(EMBEDDED_BEARER)].some((m) => bearerToken(m[2])));
const maskBearer = (v, mask) => v.replace(EMBEDDED_BEARER, (all, head, tok) => (bearerToken(tok) ? head + mask(tok) : all));
const maskEmbedded = (v, mask) => maskBearer(v
  .replace(EMBEDDED_PAIR, (all, head, val) => (holdsCredential('password', val) ? head + mask(val) : all))
  .replace(EMBEDDED_URL, (all, head, val) => (holdsCredential('password', val) ? head + mask(val) : all)), mask);
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
    } else {
      // Claude Code's own feature-flag cache in `~/.claude.json` names flag fields, never a credential: its
      // `...impressionKey` read as a camelCase `Key` and refused a read-only loop over config files (audit 2026-10-20
      // C17, 5417afad). The cache alone - a credential anywhere else in the file still counts.
      if (k === 'cachedGrowthBookFeatures') continue;
      const hit = secretKeyIn(v, here, depth + 1, labels, k);
      if (hit) return hit;
    }
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
// The project's secret store has two names (item 3, 2026-10-25): `.secrets` from this release, `.sensitive-data` until
// every install has moved (stack/mcp/data-root.js, pinned as secret-file-names). `.sensitive-data` is the store by its
// name alone; `.secrets` only directly under the data root (isDataRootSecrets), since a project keeps a `.secrets` of
// its own too - the file nektos/act reads.
const SECRET_FILES = Object.freeze(['.secrets', '.sensitive-data']);
const [SECRETS_FILE, LEGACY_SECRETS_FILE] = SECRET_FILES;
// a companion plugin's key file: every value is a credential (SG1 D2). Not a SECRET_FILES store: --with-sensitive never reads it.
const KEY_FILE = '.mcps-secrets';
// A dotenv is `sensitive` by name too (swap 1 ruling 14): the masker shows every value of one a command names.
const DOTENV_FILE = /^\.env(?:\..+)?$/i;
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
  if (b === LEGACY_SECRETS_FILE || b === KEY_FILE || (b === SECRETS_FILE && isDataRootSecrets(file))) return 'sensitive';
  if (DOTENV_FILE.test(b) && !TEMPLATE_FILE.test(b)) return 'sensitive';
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
// The project's own secret store (`<data root>/.secrets`, `.sensitive-data` before; the user's ruling of 2026-10-13): a dotenv whose EVERY
// value is a credential, whatever its key is called - DB_HOST and API_URL included, since the user put them there.
const sensitivePairs = (lines) => lines.map((l) => l.match(DOTENV_LINE)).filter(Boolean).map((m) => [m[1], unquote(m[2]), 'always']);
const READERS = {
  sensitive: sensitivePairs, ini: iniPairs, netrc: netrcPairs, urls: urlPairs, pgpass: pgpassPairs, htpasswd: htpasswdPairs, spaced: spacedPairs,
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
// The first `bytes` of a file (HK-07: past MAX_BYTES only the head is read).
function headBytes(file, bytes) {
  const fd = fs.openSync(file, 'r');
  try { const buf = Buffer.alloc(bytes); return buf.subarray(0, fs.readSync(fd, buf, 0, bytes, 0)); } finally { fs.closeSync(fd); }
}
// UTF-16's byte order ('le-bom', 'be-bom', 'le', 'be'), or null for UTF-8.
function wideOf(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return 'le-bom';
  if (buf[0] === 0xfe && buf[1] === 0xff) return 'be-bom';
  const head = buf.subarray(0, 64);
  if (head.length >= 4) {
    let even = 0; let odd = 0;
    for (let i = 0; i < head.length; i++) if (head[i] === 0) { if (i % 2) odd++; else even++; }
    const half = head.length >> 1;
    if (even === 0 && odd >= half * 0.9) return 'le';
    if (odd === 0 && even >= half * 0.9) return 'be';
  }
  return null;
}
function decodeText(buf) {
  const wide = wideOf(buf);
  if (wide === 'le-bom') return buf.subarray(2).toString('utf16le');
  if (wide === 'be-bom') return swap16(buf.subarray(2)).toString('utf16le');
  if (wide === 'le') return buf.toString('utf16le');
  if (wide === 'be') return swap16(buf).toString('utf16le');
  return buf.toString('utf8').replace(/^\uFEFF/, '');
}
function readText(file, bytes = Infinity) { return decodeText(bytes === Infinity ? fs.readFileSync(file) : headBytes(file, bytes)); }
// The lines a Read window asks for (1-based `offset`, `limit` lines; Claude Code's Read takes 2000 by default), read in
// chunks up to MAX_BYTES of them; a window past WINDOW_SCAN bytes into the file is not reached (null). UTF-8 only: a
// UTF-16 file is judged by its head.
const WINDOW_SCAN = 64 * 1024 * 1024;
function windowText(file, window) {
  const from = Math.max(1, Math.floor(Number(window.offset) || 1));
  const count = Math.max(1, Math.floor(Number(window.limit) || 2000));
  const fd = fs.openSync(file, 'r');
  try {
    const chunk = Buffer.alloc(64 * 1024);
    const out = [];
    let kept = 0;
    let line = 1;
    let start = from === 1 ? 0 : -1; // where the window's bytes start in the current chunk
    for (let pos = 0; pos < WINDOW_SCAN;) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, pos);
      if (!n) break;
      let i = 0;
      for (; i < n; i++) {
        if (chunk[i] !== 10) continue;
        line++;
        if (line === from) start = i + 1;
        if (line === from + count) break;
      }
      if (start >= 0) {
        const part = chunk.subarray(start, Math.min(i + 1, n));
        out.push(Buffer.from(part));
        kept += part.length;
        start = 0;
      }
      if (line >= from + count || kept >= MAX_BYTES) return Buffer.concat(out).subarray(0, MAX_BYTES).toString('utf8');
      pos += n;
    }
    return out.length ? Buffer.concat(out).subarray(0, MAX_BYTES).toString('utf8') : null;
  } finally { fs.closeSync(fd); }
}
// A JSON document cut at MAX_BYTES (or a window inside one) no longer parses: its `"key": "value"` pairs are judged one by
// one, the way the whole document's would be (HK-07: a 910KB terraform state's `"password"`).
const JSON_PAIR_RE = /("((?:[^"\\\n]|\\.){1,200})"\s*:\s*")((?:[^"\\\n]|\\.){0,4000})"/g;
// A JSON string's escapes read as the parser reads them; a malformed escape keeps the raw text.
const jsonUnescape = (raw) => { try { return JSON.parse(`"${raw}"`); } catch { return raw; } };
// Every `"key": "value"` pair on one line, [key, value] - the reading of a JSON no parser takes (SG1-F2).
const jsonPairs = (text) => [...String(text).matchAll(JSON_PAIR_RE)].map((m) => [jsonUnescape(m[2]), jsonUnescape(m[3])]);
function jsonPairIn(text, labels) {
  for (const [k, v] of jsonPairs(text)) if (labels ? SECRET_SHAPE.test(v) : pairHoldsCredential(k, v)) return k;
  return null;
}
// SG1-F2 (3.12): a `.json` / `.jsonc` the strict parser rejects - JSONC's `//` and `/* */` comments (a tsconfig,
// `.vscode/settings.json`, a devcontainer), a trailing comma, a truncated file - was judged by no reader, so a credential
// in one passed the Read, Grep and MCP routes, `--presence` said `absent` and `--redacted` printed it. Such a file is
// read leniently (`jsonDoc`), and one no lenient read parses (a truncated file) by its `"key": "value"` pairs.
// `.code-workspace` is VS Code's workspace file, JSONC like `.vscode/settings.json` (review of bb686875, I2).
const JSONISH_FILE = /\.(?:jsonc?|json5|code-workspace)$/i;
// JSONC's comments and trailing commas removed OUTSIDE strings. Two string-aware passes, so a `//` or `/*` inside a
// string (`"https://..."`) and a `,}` inside one stay text. A string ends at its closing quote or, unterminated, at
// the line's end (JSON allows no raw newline in one), so a torn string swallows no later line. The result may still not
// parse (a truncated file); the caller then reads the pairs.
function stripJsonc(text) {
  const stringEnd = (s, i) => { let j = i + 1; while (j < s.length && s[j] !== '"' && s[j] !== '\n') j += s[j] === '\\' ? 2 : 1; return Math.min(j + 1, s.length); };
  let bare = '';
  for (let i = 0; i < text.length;) {
    if (text[i] === '"') { const j = stringEnd(text, i); bare += text.slice(i, j); i = j; continue; }
    if (text.startsWith('//', i)) { const j = text.indexOf('\n', i); i = j < 0 ? text.length : j; continue; } // the newline stays
    if (text.startsWith('/*', i)) { const j = text.indexOf('*/', i + 2); bare += ' '; i = j < 0 ? text.length : j + 2; continue; }
    bare += text[i++];
  }
  let out = '';
  for (let i = 0; i < bare.length;) {
    if (bare[i] === '"') { const j = stringEnd(bare, i); out += bare.slice(i, j); i = j; continue; }
    // a comma whose next non-blank character closes an object or array is a trailing comma
    if (bare[i] === ',') {
      let j = i + 1;
      while (j < bare.length && /\s/.test(bare[j])) j++;
      if (bare[j] === '}' || bare[j] === ']') { i++; continue; }
    }
    out += bare[i++];
  }
  return out;
}
// The document a JSON text holds - strict first, then, for a `.json` / `.jsonc` file only, the lenient read - or
// undefined when neither parses (`null` is a document: the text `null`).
function jsonDoc(text, file) {
  try { return JSON.parse(text); } catch { /* not strict JSON */ }
  if (!JSONISH_FILE.test(String(file))) return undefined;
  try { return JSON.parse(stripJsonc(text)); } catch { return undefined; }
}
// `window`: a Read's { offset, limit } - judged on its own lines when the file is past MAX_BYTES.
function secretIn(file, window = null) {
  let text;
  let cut = false;
  if (TEMPLATE_FILE.test(pathMod.basename(String(file)))) return null;
  try {
    const size = fs.statSync(file).size;
    if (size > 0 && isKeyStore(file)) return KEY_STORE;
    cut = size > MAX_BYTES;
    const raw = cut ? headBytes(file, MAX_BYTES) : fs.readFileSync(file);
    text = cut && window && !wideOf(raw) ? windowText(file, window) : decodeText(raw);
    if (text == null) return null;
  } catch { return null; }
  const labels = TRANSLATION_PATH.test(String(file));
  const doc = jsonDoc(text, file);
  if (doc !== undefined) return secretKeyIn(doc, '', 0, labels);
  // not JSON, cut at MAX_BYTES, or a `.json` / `.jsonc` no lenient read parses (SG1-F2: a truncated file): its pairs
  if (cut || JSONISH_FILE.test(String(file))) { const hit = jsonPairIn(text, labels); if (hit) return hit; }
  const other = otherPairs(text, file);
  if (other) for (const p of other.pairs) if (pairCounts(p)) return p[0];
  return dotenvShaped(text, file) ? secretLineIn(text) : null;
}

// Git Bash / MSYS spell a Windows path in POSIX mount form (`/c/Users/...`), which node on win32
// resolves against the CURRENT drive instead. Translate before resolving; off Windows the spelling
// is a real POSIX path and is never touched.
// The translation is shell-writes.js's one home (2.1.5 M8); without the module a path is taken as written.
let nativePath = (p) => String(p);
// homeDir: os.homedir() throws on Windows under an empty USERPROFILE, which crashed this guard at load (exit 1, open).
const homeDir = () => { try { return os.homedir() || process.env.HOME || ''; } catch { return nativePath(process.env.HOME || ''); } };
// The module itself too: its one variable reader (`shellVars`, audit 2026-10-30 a0) expands what KNOWN_VARS does not bind.
let shellWrites = null;
try { shellWrites = require(pathMod.join(__dirname, 'shell-writes.js')); ({ nativePath } = shellWrites); } catch { /* an install without it */ }
const HOME = homeDir();
const accountDir = () => process.env.CLAUDE_CONFIG_DIR || pathMod.join(HOME, '.claude');
// The variables a credential path is spelled with: `~`, $HOME, $USERPROFILE (the Windows spelling of the same
// directory - without it the account file on a Windows install was never judged), $CLAUDE_PROJECT_DIR and
// $CLAUDE_CONFIG_DIR, also in the `${VAR:-default}` form, and `$PWD`: where the shell stands, the payload's cwd
// moved by a `cd` this guard followed (HK-04). Any other `$` is an unexpanded variable this guard cannot judge - the
// word is skipped rather than guessed at. A function: the lets it reads are set by the time the shell branch runs.
const KNOWN_VARS = () => ({ HOME, USERPROFILE: process.env.USERPROFILE || HOME, CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR || '',
  CLAUDE_CONFIG_DIR: accountDir(), PWD: cwdAnchor || (payload && typeof payload.cwd === 'string' && payload.cwd) || process.cwd() });
// The shell's quote removal over one word: `"$PWD"/.env` is the word `$PWD/.env` (HK-04). A quote left open keeps the
// word as written. Backslashes stay - a Windows path is spelled with them.
function unquoteWord(word) {
  let out = '';
  let q = null;
  for (const c of String(word)) {
    if (q) { if (c === q) q = null; else out += c; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    out += c;
  }
  return q ? String(word) : out;
}
// `$(pwd)` / a backtick `pwd` is where the shell stands, and `$(git rev-parse --show-toplevel)` the work tree holding it
// (final review 2026-10-25: `cat "$(pwd)/.env"` printed the file - no `$(...)` resolved). Any other substitution keeps its
// `$` and the token is skipped, as before. The work tree is found by walking up to a `.git` - no git spawned per call.
const PWD_SUBST = /\$\(\s*pwd(?:\s+-[LP])?\s*\)|`\s*pwd(?:\s+-[LP])?\s*`/g;
const GIT_TOP_SUBST = /\$\(\s*git\s+rev-parse\s+--show-toplevel(?:\s+2>\s*\/dev\/null)?\s*\)/g;
function gitTop(dir) {
  for (let d = pathMod.resolve(String(dir)); ; d = pathMod.dirname(d)) {
    try { fs.statSync(pathMod.join(d, '.git')); return d; } catch { /* up one */ }
    if (pathMod.dirname(d) === d) return null;
  }
}
// shellVars' input for one word: no command around it, so no assignment of its own and no cd - cwdAnchor carries that.
const NO_COMMAND = { command: '', assignEvents: [], cds: [] };
function expandPath(token) {
  const known = KNOWN_VARS(); // PWD included: where the shell stands
  // the substitutions first: a backtick `pwd` opening the word is no stray quote to strip
  let p = unquoteWord(token).replace(PWD_SUBST, () => known.PWD).replace(GIT_TOP_SUBST, (m) => gitTop(known.PWD) || m);
  p = p.replace(/^["'`]|["'`]$/g, '').replace(/^~(?=\/|$)/, HOME);
  p = p.replace(/\$\{(\w+)(?::-[^}]*)?\}|\$(\w+)/g, (m, a, b) => (known[a || b] != null ? known[a || b] : m));
  // what is left goes through the one shared reader (`${PWD:?}`, `${HOME:=x}`, `$env:USERPROFILE`)
  if (/\$/.test(p) && shellWrites && shellWrites.shellVars) {
    try { p = shellWrites.shellVars(NO_COMMAND, { cwd: known.PWD, home: HOME, project: process.env.CLAUDE_PROJECT_DIR || null }).expand(p, 0); } catch { /* left as written */ }
  }
  // `my\ dir/settings.json` is one token the shell hands over with the space intact.
  return /\$/.test(p) ? null : nativePath(p.replace(/\\ /g, ' '));
}
let payload; // set below; resolveFile reads its cwd
// A `cd` earlier in the command moves the anchor for the words after it (namedBy, storeCarry: shell-writes.js anchorAt).
// The default anchors stay in the list - a cd this guard cannot follow leaves the judgement exactly where it was.
let cwdAnchor = null;
// The anchors a relative path is tried against. A payload field is attacker-shaped input, not a
// promise: a non-string `cwd` reached pathMod.join and threw ERR_INVALID_ARG_TYPE, and a hook that
// exits 1 fails OPEN - the dump it was judging ran (review finding, reproduced with `"cwd": 5`).
const anchorDirs = () => [...new Set([cwdAnchor, process.env.CLAUDE_PROJECT_DIR, payload && payload.cwd, process.cwd()]
  .filter((d) => typeof d === 'string' && d))]; // deduped - the project dir and the cwd are usually one directory, listed once

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
  // `/**` globs the filesystem root, never the project (audit 2026-10-10: it matched a project's credential file)
  const dirPart = idx > 0 ? p.slice(0, idx) : idx === 0 ? p.slice(0, 1) : '';
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
// One token -> every path it can name: its brace alternatives and glob matches.
function candidatePaths(token) {
  const p = expandPath(token);
  return p ? expandBraces(p).flatMap((b) => (GLOB_CHARS.test(b) ? globPaths(b) : b ? [b] : [])) : [];
}
function statFile(p) {
  const cands = pathMod.isAbsolute(p) ? [p] : anchorDirs().map((d) => pathMod.join(d, p));
  for (const c of cands) { try { if (fs.statSync(c).isFile()) return c; } catch { /* next anchor */ } }
  return null;
}
function resolveFile(token) {
  for (const p of candidatePaths(token)) { const f = statFile(p); if (f) return f; }
  return null;
}

// The native realpath first, as secret-chain.js and layout.js take it (a Windows 8.3 short name in one spelling and the
// long name in the other matched no store); `realStrict` throws where the path does not exist.
const realStrict = (p) => { try { return fs.realpathSync.native(p); } catch { return fs.realpathSync(p); } };
const realOf = (p) => { try { return realStrict(p); } catch { return pathMod.resolve(p); } };
// The first line of a redacted view: what it is. No receipt opens the value any more (swap 1) - the user opens the file.
const noteLine = (what) => `# credential guard: ${what} A value never enters the chat.`;
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
  const keyLine = (line) => { count(line.trim()); return `${indentOf(line)}<private key line>`; };
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
    if (k === 'pem' && GPG_PRIVATE.test(line)) { gpg = true; count(line.replace(/^\s*(?:Key:\s*)?/, '')); return line.replace(/^(\s*(?:Key:\s*)?).*$/, '$1<private key line>'); }
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
    // In the project's .sensitive-data every live value is masked, whatever its key is called.
    if (m && (kind === 'sensitive' ? isLive(unquote(m[2])) : maskable(m[1], unquote(m[2])))) return `${m[1]}=${mask(unquote(m[2]))}`;
    if (m) { const v = unquote(m[2]); const inPlace = maskEmbedded(v, mask); if (inPlace !== v) return `${m[1]}=${inPlace}`; }
    // a URL on a line of its own (a git-credentials store); a dotenv pair was judged by its value above - `PWD=/home` is no password
    return (m ? line : maskEmbedded(line, mask)).replace(SECRET_SHAPE_G, (x) => mask(x));
  });
  return out.join('\n');
}


// ---- the project's sensitive data: where it is, and the run that uses it -------------------------
// `<data root>/.secrets`, else `.sensitive-data` (the data root is .alfred) in the checkout the command runs in, else in the
// main worktree beside it - a gitignored file a new worktree does not have. Its values are kept out of the chat by accident:
// a Read is blocked and a shell dump is masked (the 'sensitive' kind above), and a command that needs them runs through
// --with-sensitive, which puts them in that command's environment and masks each one's EXACT text in its output - an
// encoded, split or reversed print is not caught, so this is leak protection, never a wall against a deliberate read.
// The data root as the settings name it: relative and `..`-free, else `.alfred`.
function dataRootRel() { return dataRoot(); }
// A `.secrets` is the store when it sits directly in a folder whose path ends in the data root (`.alfred/.secrets`, a
// custom root's `var/data/.secrets`) - by the path as written, a diff header's or a walk's line included, or by its real
// path. A project's own `.secrets` beside its sources is not. In any letter case (final review 2026-10-25 C2): a
// case-insensitive disk - macOS, Windows - opens the store as `.alfred/.SECRETS` or `.ALFRED/.secrets` too.
// A workspace ancestor's `.secrets` at its own data root is the store too (release 2), by real path - only a file of that
// name reads the chain.
function isDataRootSecrets(file) {
  const tail = `${dataRootRel()}/${SECRETS_FILE}`.toLowerCase();
  const ends = (p) => { const s = String(p).replace(/\\/g, '/').toLowerCase(); return s === tail || s.endsWith(`/${tail}`); };
  if (ends(file)) return true;
  let real;
  try { real = realStrict(file); } catch { return false; }
  if (ends(real)) return true;
  if (baseOf(real).toLowerCase() !== SECRETS_FILE) return false;
  const at = real.toLowerCase();
  return sensitiveStores().some((s) => s.toLowerCase() === at);
}
function sensitiveFile(start = process.cwd()) {
  const root = dataRootRel();
  let places = [start];
  try {
    const { projectRootOf } = require(pathMod.join(__dirname, 'layout.js'));
    const r = projectRootOf(start);
    places = [...new Set([r.checkout, r.project])];
  } catch { /* no layout.js beside the hook: the start directory alone */ }
  // the checkout's own store before its main worktree's, `.secrets` before `.sensitive-data` in each
  const at = places.flatMap((p) => SECRET_FILES.map((name) => pathMod.join(p, ...root.split('/'), name)));
  return at.find((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } }) || at[0];
}
// The workspace chain (release 2): secret-chain.js beside the hook reads the project's own store and each linked
// ancestor's at its own data root; without it (an older copy route) the project's own store alone.
function secretChain() {
  if (secretChain.mod === undefined) {
    try { secretChain.mod = require(pathMod.join(__dirname, 'secret-chain.js')); } catch { secretChain.mod = null; }
  }
  return secretChain.mod;
}
const isStoreFile = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
// The values a run in `start` gets: { values, from: { KEY: rel }, files: { rel: file } } - '.' is the project's own store,
// '..' and up an ancestor's; the nearest value of a key wins.
function sensitiveChain(start = process.cwd()) {
  const mod = secretChain();
  if (mod) {
    try {
      const c = mod.chainOf(start, { env: process.env });
      return { values: c.values, from: c.from, files: Object.fromEntries(c.stores.map((s) => [s.rel, s.file])) };
    } catch { /* the project's own store below */ }
  }
  const file = sensitiveFile(start);
  if (!isStoreFile(file)) return { values: {}, from: {}, files: {} };
  let values = {};
  try { values = sensitiveValues(file); } catch { /* unreadable: no values */ }
  return { values, from: Object.fromEntries(Object.keys(values).map((k) => [k, '.'])), files: { '.': file } };
}
// Every store a deny covers, from where the call runs: the project's own and each linked ancestor's, whatever the kill
// switch says - it stops the values, never the deny. [{ file, root, real }], read once per run.
function denyStores() {
  if (denyStores.list) return denyStores.list;
  let start = process.cwd();
  try { if (payload && typeof payload.cwd === 'string' && payload.cwd) start = payload.cwd; } catch { /* a CLI mode */ }
  let list = null;
  const mod = secretChain();
  if (mod) { try { list = mod.storesOf(start, { env: process.env, forDeny: true }); } catch { list = null; } }
  if (!list) {
    const f = sensitiveFile(start);
    list = isStoreFile(f) ? [{ file: f, root: null, real: realOf(f) }] : [];
  }
  return (denyStores.list = list);
}
// Those stores as real paths - what a tree-taking verb on a folder above one, or a find reaching one, carries.
function sensitiveStores() {
  return [...new Set(denyStores().map((s) => s.real))];
}
// The data roots those stores sit under, relative to their own project ('.alfred', 'var/data') - the mention pass's words.
function sensitiveRoots() {
  const out = new Set();
  for (const s of denyStores()) {
    if (!s.root) continue;
    const rel = pathMod.relative(s.root, pathMod.dirname(s.file)).split(pathMod.sep).join('/');
    if (rel && !rel.startsWith('..') && !pathMod.isAbsolute(rel)) out.add(rel);
  }
  return [...out];
}
function sensitiveValues(file) {
  const out = {};
  for (const line of readText(file).split(LINES)) {
    const m = line.match(DOTENV_LINE);
    if (m && !COMMENT_LINE.test(line)) out[m[1]] = unquote(m[2]);
  }
  return out;
}
// The shortest value masked in a run's output: a value under 4 characters (PORT=80, DEBUG=1) would mask every match of
// it in the output and say nothing a guess would not.
const MASK_MIN = 4;
// `node guard-secret-value.js --with-sensitive -- "<command line>"` - the command runs in this shell (sh, or cmd.exe on
// Windows) with every KEY of the project's .sensitive-data in its environment (the file's value wins over one already
// set: the run asked for the project's), and every value of MASK_MIN or more characters is printed as <KEY> in its
// stdout and stderr, line by line. Several words after `--` are one command line, quoted for the shell. The exit code
// is the command's.
if (process.argv[2] === '--with-sensitive') {
  const rest = process.argv.slice(3);
  const words = rest[0] === '--' ? rest.slice(1) : rest;
  if (!words.length) {
    process.stderr.write('usage: node guard-secret-value.js --with-sensitive -- "<command line>"\n');
    process.exit(2);
  }
  const quote = (w) => (process.platform === 'win32' ? (/[\s"&|<>^]/.test(w) ? `"${w.replace(/"/g, '\\"')}"` : w) : (/^[\w@%+=:,./-]+$/.test(w) ? w : `'${w.replace(/'/g, `'\\''`)}'`));
  const line = words.length === 1 ? words[0] : words.map(quote).join(' ');
  // the workspace chain's values, nearest first (release 2, AC20) - a parent's value is masked like the project's own
  const chain = sensitiveChain(process.cwd());
  const values = chain.values;
  if (!Object.keys(chain.files).length) process.stderr.write(`# with-sensitive: ${sensitiveFile()} not found - the command runs without it\n`);
  const keys = Object.keys(values);
  const masks = Object.entries(values).filter(([, v]) => v.length >= MASK_MIN).sort((a, b) => b[1].length - a[1].length);
  const maskLine = secretChain() ? secretChain().masker(values, MASK_MIN) : (s) => masks.reduce((acc, [k, v]) => acc.split(v).join(`<${k}>`), s);
  const sources = Object.keys(chain.files).map((rel) => [rel, keys.filter((k) => chain.from[k] === rel)]).filter(([, ks]) => ks.length);
  if (sources.length === 1 && sources[0][0] === '.') process.stderr.write(`# with-sensitive: ${keys.length} value(s) from ${chain.files['.']} in the environment (${keys.join(', ')}), each shown as <KEY> in this output\n`);
  else if (sources.length) {
    const shown = (f) => pathMod.relative(realOf(process.cwd()), realOf(f)).split(pathMod.sep).join('/');
    process.stderr.write(`# with-sensitive: ${keys.length} value(s) in the environment (${sources.map(([rel, ks]) => `${shown(chain.files[rel])}: ${ks.join(', ')}`).join('; ')}), each shown as <KEY> in this output\n`);
  }
  const { spawn } = require('child_process');
  const child = spawn(line, { shell: true, env: { ...process.env, ...values }, stdio: ['inherit', 'pipe', 'pipe'] });
  const pipe = (from, to) => {
    const { StringDecoder } = require('string_decoder');
    const decoder = new StringDecoder('utf8');
    let carry = '';
    from.on('data', (chunk) => {
      const text = carry + decoder.write(chunk);
      const cut = text.lastIndexOf('\n');
      carry = cut < 0 ? text : text.slice(cut + 1);
      if (cut >= 0) to.write(maskLine(text.slice(0, cut + 1)));
    });
    return () => { const tail = carry + decoder.end(); if (tail) to.write(maskLine(tail)); };
  };
  const flushOut = pipe(child.stdout, process.stdout);
  const flushErr = pipe(child.stderr, process.stderr);
  child.on('error', (err) => { process.stderr.write(`# with-sensitive: could not start the command - ${err.message}\n`); process.exit(1); });
  child.on('close', (code, signal) => { flushOut(); flushErr(); process.exitCode = signal ? 1 : (code ?? 0); });
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { try { child.kill(signal); } catch { /* gone */ } });
  return;
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
  // strict, else - a `.json` / `.jsonc` - the lenient read (SG1-F2)
  const j = text != null ? jsonDoc(text, file) : undefined;
  if (j !== undefined) {
    doc = j && typeof j === 'object' ? j : null;
    entries = (j && typeof j.env === 'object' && j.env) ? j.env : (j && typeof j === 'object' && !Array.isArray(j) ? j : {});
  } else if (text != null) {
    // SG1-F2: a `.json` / `.jsonc` no lenient read parses (a truncated file) answers by its `"key": "value"` pairs
    if (JSONISH_FILE.test(String(file))) for (const [k, v] of jsonPairs(text)) if (!Object.prototype.hasOwnProperty.call(entries, k)) entries[k] = v;
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
    if (v === undefined) return `${k}=absent`;
    // A key written with no value is not a missing key: both read `absent`, and a seat filed a finished handoff as open
    // on it (audit 2026-10-10, session f24eb967).
    if (v === null || (typeof v === 'string' && v.trim() === '')) return `${k}=empty (present, no value)`;
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
// `node guard-secret-value.js --redacted <file>` - the value-free view a refusal names: the file with every credential value replaced by `<set (N chars)>` and the rest as written
// (the hook wiring a session inspects in a settings.json, the non-secret keys of a dotenv), led by a
// note saying so and naming the route to the value. JSON is re-emitted from its parse; a dotenv is
// masked line by line, and a credential SHAPE anywhere in the text is masked whatever surrounds it.
// `--note-to-stderr` is the form for a pipe (`--redacted <file> --note-to-stderr | grep KEY`): the note leaves the
// pipe, so the filter reads only the masked file.
if (process.argv[2] === '--redacted') {
  const fileArg = String(process.argv[3] || '');
  const filtered = process.argv[4] === '--note-to-stderr';
  const file = nativePath(fileArg.replace(/^~(?=\/|$)/, HOME));
  let text = null;
  let out = '';
  try {
    const size = fs.statSync(file).size;
    if (size > 0 && isKeyStore(file)) {
      out = noteLine(`redacted view of ${file} - a binary key store, judged by its kind and never printed.` +
        ` Presence: node "${__filename}" --presence "${file}".`) + `\n<binary key store, ${size} bytes>\n`;
    } else if (size > MAX_BYTES) {
      // past the cap no view is built (HK-07: the guard judges such a file by its first MAX_BYTES, and a dump of
      // one is rewritten here only when that head holds a credential)
      out = `# ${fileArg}: larger than ${MAX_BYTES} bytes - no redacted view is built at this size. Presence of one key:`
        + ` node "${__filename}" --presence "${file}" KEY; read the other lines with a Read window (offset / limit) or a`
        + ` bounded grep that names no credential key.\n`;
    } else text = readText(file);
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
      // strict, else - a `.json` / `.jsonc` - the lenient read, re-emitted without its comments (SG1-F2)
      const doc = jsonDoc(text, file);
      if (doc === undefined) throw new Error('no JSON document');
      body = JSON.stringify(walk(doc), null, 2) + '\n';
    } catch {
      // SG1-F2: a `.json` / `.jsonc` no lenient read parses (a truncated file) - each `"key": "value"` pair's value masked
      // in place as the walk above masks a leaf by its key; the format pass then masks shapes and embedded passwords
      const pairsMasked = JSONISH_FILE.test(String(file))
        ? text.replace(JSON_PAIR_RE, (all, head, k, raw) => (maskable(jsonUnescape(k), jsonUnescape(raw)) ? `${head}${mask(jsonUnescape(raw))}"` : all))
        : text;
      body = maskFormatText(pairsMasked, file, mask, () => { masked++; });
    }
    // The runnable presence command, absolute: the guard ships inside the plugin, and pilot 3's first presence call
    // guessed `.claude/hooks/`, where only the docs and history engines are copied.
    const note = noteLine(`redacted view of ${file} - ${masked} credential value(s) shown as <set (N chars)>, everything else as written` +
      (filtered ? '; piped through the command\'s own filter, so line numbers count the view, not the file.' : '.') +
      ` Presence of one key: node "${__filename}" --presence "${file}" KEY (A.B.C reads a nested key).`);
    if (filtered) { process.stderr.write(note + '\n'); out = body; } else out = note + '\n' + body;
  }
  process.stdout.write(out);
  process.exit(0);
}
// `node guard-secret-value.js --redacted-env` - the environment for a model that needs its names: every
// variable as env prints it, a credential-shaped NAME holding a credential (or any value of a known
// credential shape) as `<set (N chars)>`. Accepted gap, stated: a credential under a name this
// pattern does not match and with no known shape prints as env would print it.
// `--note-to-stderr` is the filtered form (`--redacted-env --note-to-stderr | grep KEY`), as for a file.
// `-0` keeps env's NUL separator (`env -0 | xargs -0 ...`, HK-05).
if (process.argv[2] === '--redacted-env') {
  const filtered = process.argv.slice(3).includes('--note-to-stderr');
  const sep = process.argv.slice(3).includes('-0') ? '\0' : '\n';
  const lines = [];
  let masked = 0;
  for (const k of Object.keys(process.env).sort()) {
    const v = String(process.env[k]);
    if (maskable(k, v)) { masked++; lines.push(`${k}=<set (${v.length} chars)>`); } else lines.push(`${k}=${maskEmbedded(v, (x) => { masked++; return `<set (${x.length} chars)>`; })}`);
  }
  const note = noteLine(`the environment with ${masked} credential value(s) shown as <set (N chars)>, everything else as env prints it`
    + (filtered ? '; piped through the command\'s own filter.' : '.'));
  if (filtered) process.stderr.write(note + '\n');
  process.stdout.write((filtered ? '' : note + '\n') + lines.join(sep) + sep);
  process.exit(0);
}

// The line masker the stream redactor below runs, and the shell route's git probe runs over the same text. One
// per stream: it carries the file a diff section is about (from its header) and whether it is inside a PEM
// private key. Masked: a credential-shaped key's value in a JSON pair, a dotenv line, a YAML pair or an INI /
// properties / .npmrc pair - in a config
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
  const INI_STREAM_PAIR = /^(\s*)([A-Za-z_][\w.-]*|\/\/[^=\s]+)(\s*=\s*)(.*?)\s*$/;
  const NONE = new Set();
  let file = null;
  let kind = null;
  let pem = false;
  let gpg = false;
  let ppk = 0;
  const reset = (f) => { file = f; kind = f ? kindByName(f) : null; pem = false; gpg = false; ppk = 0; };
  const keyLine = (pre, cr) => { masked++; return `${pre}<private key line>${cr}`; };
  // A line of the project's `.sensitive-data` (audit 2026-10-20 H3: a diff of it or a walk through it printed every value
  // raw, though the start line says a printed value is masked): every live value whatever its key, and a line that is no
  // `KEY=value` pair whole - the store is the user's, its format no promise.
  const SENSITIVE_PAIR = /^(\s*(?:export\s+)?[A-Za-z_][\w.-]*\s*=\s*)(.*?)\s*$/;
  const SENSITIVE_PREFIX = /^(?:[A-Za-z]:)?(?:[^\s:]*:)?(?:[^\s:]*[\\/])?(\.sensitive-data|\.secrets|\.env(?:\.[^\s:\\/]+)?)(?::\d+){0,2}[:-]/;
  const sensitiveBody = (body) => {
    if (!body.trim() || COMMENT_LINE.test(body)) return body;
    const p = body.match(SENSITIVE_PAIR);
    if (p) return isLive(unquote(p[2])) && !/^<set \(\d+ chars\)>$/.test(unquote(p[2])) ? p[1] + mask(unquote(p[2])) : body; // the masker's own form stays
    masked++;
    return '<sensitive-data line>';
  };
  const line = (raw) => {
    const cr = raw.endsWith('\r') ? '\r' : '';
    const text = cr ? raw.slice(0, -1) : raw;
    if (/^commit [0-9a-f]{7,}\b/.test(text)) { reset(null); return raw; }
    const header = text.match(/^(?:\+\+\+ b\/|diff --git a\/.* b\/)(.+)$/);
    if (header) { reset(header[1]); return raw; }
    // a search's line out of the store (`<path>/.sensitive-data:12:...`, `git grep`'s `HEAD:<path>:...`) is masked by its
    // path, whatever it holds (H3)
    const sp = SENSITIVE_PREFIX.exec(text);
    if (sp && !TEMPLATE_FILE.test(sp[1])) return `${sp[0]}${sensitiveBody(text.slice(sp[0].length))}${cr}`;
    const [, pre, body] = text.match(/^((?:[+\- ]|[<>] )?)([\s\S]*)$/);
    if (kind === 'sensitive') return `${pre}${sensitiveBody(body)}${cr}`;
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
      // an INI / properties / .npmrc pair the passes above never read - a dotted, dashed or registry-path key
      // (`spring.datasource.password=`, `client-secret = `, `//registry.npmjs.org/:_authToken=`): `git diff` and
      // `git show HEAD:.npmrc` printed them raw, the probe judging them clean (audit 2026-10-08, replayed). `=` only,
      // so a search's `path:12:` prefix is never read as a key.
      const i = !d && !y && !e && kind !== 'hcl' && kind !== 'xml' && out.match(INI_STREAM_PAIR);
      if (i && maskable(i[2], unquote(i[4]))) out = `${i[1]}${i[2]}${i[3]}${mask(unquote(i[4]))}`;
      out = kind === 'hcl' ? maskQuotedEmbedded(out, mask) : maskEmbedded(out, mask);
    } else {
      out = maskBearer(out.replace(EMBEDDED_URL, (all, head, val) => (holdsCredential('password', val) ? head + mask(val) : all)), mask);
    }
    out = out.replace(SECRET_SHAPE_G, (x) => mask(x));
    if (PEM_PRIVATE.test(out) && !PEM_END.test(out)) pem = true;
    return `${pre}${out}${cr}`;
  };
  // A search prints `path:12:text` (or `path:text`, or `path-12-text` around a match): the pair rules read the text, so
  // a line the whole-line pass left alone is tried again past its prefix - unless that pass moved the reader's state
  // (a header, a PEM or key-block opening): the second try would read the opening line as the block's first line.
  const GREP_PREFIX = /^(?:[A-Za-z]:)?[^\s:]+(?::\d+){0,2}[:-]/;
  const state = () => `${file}\n${pem}${gpg}${ppk}`;
  const grepLine = (raw) => {
    const was = state();
    const first = line(raw);
    const m = first === raw && was === state() && GREP_PREFIX.exec(raw);
    if (!m) return first;
    const rest = raw.slice(m[0].length);
    const masked2 = line(rest);
    return masked2 === rest ? raw : m[0] + masked2;
  };
  return { line: grepLine, masked: () => masked };
}

// Any other `--` mode is no mode (swap 1 ruling 8: the stream mode left with the rewrite that piped into it).
if (require.main === module && /^--/.test(process.argv[2] || '')) {
  process.stderr.write('usage: guard-secret-value.js --presence <file> [KEY ...] | --redacted <file> | --redacted-env | --with-sensitive -- "<command>"\n');
  process.exit(2);
}

try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0); // unparseable stdin - don't block
}
if (!payload || typeof payload !== 'object') process.exit(0); // a JSON scalar/null - nothing to judge
let yields = false;
try { yields = Boolean(twinYield && twinYield(payload.session_id)); } catch { yields = false; }
if (yields) process.exit(0);
// SessionStart: the project's sensitive data by KEY only, and the run that uses it - nothing when there is none.
if (payload.hook_event_name === 'SessionStart') {
  const cwd = payload.cwd || process.cwd();
  // the workspace chain's KEYS by source (release 2): '<own store> holds A; from ..: B; from ../..: C', the project's own
  // first, an ancestor's by its folder; never a value
  const chain = sensitiveChain(cwd);
  const keys = Object.keys(chain.values);
  if (keys.length) {
    const file = chain.files['.'];
    const rel = file ? pathMod.relative(cwd, file).split(pathMod.sep).join('/') : null;
    const holds = Object.keys(chain.files).map((at) => [at, keys.filter((k) => chain.from[k] === at)]).filter(([, ks]) => ks.length)
      .map(([at, ks]) => (at === '.' ? `${rel} holds ${ks.join(', ')}` : `from ${at}: ${ks.join(', ')}`)).join('; ');
    // The data root's own .gitignore covers the file; one a user wrote elsewhere, or tracked by hand, is said here -
    // a commit would publish every value. git's status 1 is 'not ignored' (a tracked file too); 128 is no repository.
    let exposed = '';
    try {
      if (file) {
        const r = require('child_process').spawnSync(...require('./hook-prelude.js').gitSafe(['check-ignore', '-q', '--', pathMod.basename(file)], { cwd: pathMod.dirname(file), timeout: 5000, stdio: 'ignore' }));
        if (r.status === 1) exposed = ` WARNING: git does not ignore ${rel} (or it is tracked) - a commit publishes every value; tell the user to add it to .gitignore, and to untrack it with git rm --cached if it is tracked.`;
      }
    } catch { /* no git: nothing to commit it with */ }
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext:
      `Sensitive data: ${holds} - kept out of the chat: a Read is blocked and a printed value is masked, but only its exact text, so never print one in another form (encoded, split, reversed) and never ask the user to paste one. A command that needs them: node "${__filename}" --with-sensitive -- "<command line>" - they are in its environment, and each prints as <KEY> in its output.${exposed}` } }));
  }
  process.exit(0);
}
// A cwd that is not a path is no anchor: the probes handed `cwd: 5` to spawnSync, which threw, and a throwing guard
// fails open in the dispatcher - the dump it was judging ran (audit 2026-10-08).
if (payload.cwd != null && (typeof payload.cwd !== 'string' || !payload.cwd)) delete payload.cwd;

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
        const dir = (() => { try { return require('./layout.js').statsPath(root, ['hook-blocks']); } catch { return path.resolve(root, docsRootEnv(), 'hook-blocks'); } })();
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(path.join(dir, `${String(payload.session_id || 'nosession').replace(/[^\w.-]/g, '_')}.jsonl`), JSON.stringify({
          ts: new Date().toISOString(),
          hook: path.basename(__filename),
          event: payload.hook_event_name || payload.tool_name || '',
          tool: payload.tool_name || '',
          // WHO was blocked and on which call: a seat's block is its own row (audit 2026-10-10 C07, 0498718d - seat
          // blocks read as the main session's), and the call id joins the row to the transcript without a clock.
          agent: payload.agent_id || null,
          tool_use_id: payload.tool_use_id || null,
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

// One MEASUREMENT row (2.1.5 M17), which the analyzer reads as a probe and never as a block: the masker's `mask` and
// `probe` rows. Tool, branch, key names and a file's BASENAME only - never a value. A repo never set up gets none
// (R54), like a block. Best-effort - a lost row is a lost measurement, never a changed verdict. The payload's
// `permission_mode` rides along (audit 2026-10-10 C09), with the actor, the call id and, on a Cursor payload, `host: 'cursor'`.
let onCursor = false;
try { onCursor = Boolean(require('./hook-prelude.js').cursorHost(payload)); } catch { /* no prelude: Claude Code */ }
function ledgerRow(mode, detail) {
  if (unsetRepo) return;
  if (typeof payload.permission_mode === 'string' && payload.permission_mode) detail = { ...detail, permissionMode: payload.permission_mode };
  try {
    const dir = (() => { try { return require('./layout.js').statsPath(process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd(), ['hook-blocks']); } catch { return pathMod.resolve(process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd(), docsRootEnv(), 'hook-blocks'); } })();
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(pathMod.join(dir, `${String(payload.session_id || 'nosession').replace(/[^\w.-]/g, '_')}.jsonl`), JSON.stringify({
      ts: new Date().toISOString(), hook: pathMod.basename(__filename), event: payload.hook_event_name || payload.tool_name || '',
      tool: payload.tool_name || '', agent: payload.agent_id || null, tool_use_id: payload.tool_use_id || null,
      mode, reason: `${mode}: ${detail.branch || detail.kind}`, detail, ...(onCursor ? { host: 'cursor' } : {}),
    }) + '\n');
  } catch { /* never throws */ }
}

// ---- the output masker (swap 1 of the complexity audit) ----
// PostToolUse on Bash: what the command printed goes back to the model with every credential value this run can name
// shown as <set (N chars)>. The values are read AFTER the run, from four sources: the files the command's text names
// (every value of a dotenv or a store, every env / headers string of a JSON config - ruling 14), the well-known
// credential files (credential verdicts only), the stores and the key file, and credential-named variables. Then the
// stream masker's shape pass reads each line, so a file a walk reached and nobody named is masked past its `path:N:`
// prefix. Only a value's exact text (and its JSON-escaped spelling) is caught - leak protection, never a wall. Past
// MASK_BUDGET_MS the output is withheld. A failed call and a Cursor payload are only observed (an `exposure` row of
// credential verdicts): PostToolUseFailure takes no replacement output - a stated ceiling - and Cursor replaces
// output for MCP tools alone.
const msOr = (v, d) => (Number.isFinite(v) ? v : d);
const MASK_BUDGET_MS = msOr(global.MASK_BUDGET_MS, 5000);
const MASK_SLOW_MS = msOr(global.MASK_SLOW_MS, 1000);
const WITHHELD = 'output withheld: the masker ran out of time';
const spentMs = () => Math.round(process.uptime() * 1000);
const JSON_CONFIG = /(?:^|[\\/])(?:\.mcp\.json|\.claude[\\/]settings[^\\/]*\.json)$/i;
const WELL_KNOWN = Object.freeze([
  ...['.aws/credentials', '.netrc', '.git-credentials', '.npmrc', '.pypirc', '.pgpass', '.docker/config.json', '.kube/config', '.config/gh/hosts.yml'].map((rel) => ({ at: 'home', rel })),
  ...['settings.json', '.credentials.json'].map((rel) => ({ at: 'config', rel })),
  ...['.env*', '.mcp.json', '.claude/settings.json', '.claude/settings.local.json'].map((rel) => ({ at: 'project', rel })),
  { at: 'project', rel: `${dataRootRel()}/${LEGACY_SECRETS_FILE}`, kind: 'sensitive' },
]);
// Cursor spells the event `postToolUse` (ruling 15)
const eventIs = (p, name) => { const e = String(p.hook_event_name || ''); return e.charAt(0).toUpperCase() + e.slice(1) === name; };
// Observation of names, never a parse: script strings are included, and the 201st fragment is not read.
const pathFragments = (command) => String(command).split(/[\s"'`=:;|&<>(),]+/).filter((f) => /[/.~]/.test(f)).slice(0, 200);
// What a print of one file would carry: [{ key, value }]. `every`: the command named the file.
function valuesOf(file, { every = false } = {}) {
  const out = [];
  const put = (key, value) => { out.push({ key: String(key), value: String(value) }); return ''; };
  if (TEMPLATE_FILE.test(baseOf(file)) || isKeyStore(file)) return out;
  let text;
  try { text = readText(file, MAX_BYTES); } catch { return out; }
  if (kindByName(file) === 'sensitive') {
    // the store and the key file give every live value; a dotenv only when named, else its credential verdicts
    const all = every || !DOTENV_FILE.test(baseOf(file));
    for (const line of text.split(LINES)) {
      const m = COMMENT_LINE.test(line) ? null : line.match(DOTENV_LINE);
      if (!m) continue;
      const v = unquote(m[2]);
      if (all ? isLive(v) : maskable(m[1], v)) put(m[1], v); else maskEmbedded(v, (x) => put(m[1], x));
    }
    return out;
  }
  // strict, else - a `.json` / `.jsonc` - the lenient read (SG1-F2)
  const json = jsonDoc(text, file);
  const open = every && (JSON_CONFIG.test(String(file)) || realOf(file) === realOf(pathMod.join(accountDir(), 'settings.json')));
  const labels = TRANSLATION_PATH.test(String(file));
  const walk = (node, key, parent, all) => {
    if (typeof node === 'string') {
      if (all ? isLive(node) : (!labels && (maskable(key, node) || hostCredential(parent, key, node))) || SECRET_SHAPE.test(node) || PEM_PRIVATE.test(node)) put(key, node);
      else maskEmbedded(node, (x) => put(key, x));
    } else if (Array.isArray(node)) node.forEach((x) => walk(x, all ? key : '', parent, all));
    else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, k, key, all || (open && /^(?:env|headers)$/.test(k)));
  };
  if (json === undefined) {
    // SG1-F2: a `.json` / `.jsonc` no lenient read parses (a truncated file) - each `"key": "value"` pair is judged as the
    // walk judges a leaf, so the bare value is masked wherever it prints; the format pass below adds what it finds
    if (JSONISH_FILE.test(String(file))) for (const [k, v] of jsonPairs(text)) walk(v, k, '', false);
    const hit = secretIn(file); // source code, a doc, a translation bundle: nothing
    if (!hit) return out;
    const names = new Map(((otherPairs(text, file) || {}).pairs || []).map(([k, v]) => [String(v), k]));
    for (const l of text.split(LINES)) { const m = l.match(DOTENV_LINE); if (m) names.set(unquote(m[2]), m[1]); }
    maskFormatText(text, file, (v) => put(names.get(v) || hit, v), (v) => v && put(hit, v));
    return out;
  }
  walk(json, '', '', false);
  return out;
}
// { values: Map<value, { key, source, file }>, files: the files read }. `every` is false for the observe-only
// branches, where a named dotenv's PORT is no exposure.
function collectValues(p, every = true) {
  const values = new Map();
  const files = new Set();
  const cwd = typeof p.cwd === 'string' && p.cwd ? p.cwd : process.cwd();
  const project = process.env.CLAUDE_PROJECT_DIR || cwd;
  const command = String((p.tool_input || {}).command || '');
  const add = (key, value, source, file, all) => {
    // an every-value read (the store, a named dotenv or config) keeps a value whatever it looks like
    if (value.length < MASK_MIN || isPlaceholder(value) || (!all && isSampleValue(key, value))) return;
    for (const v of new Set([value, JSON.stringify(value).slice(1, -1)])) if (!values.has(v)) values.set(v, { key, source, file: file ? baseOf(file) : null });
  };
  const take = (file, all, source) => {
    let id;
    try { if (spentMs() > MASK_BUDGET_MS || !fs.statSync(file).isFile()) return; id = `${realOf(file)}\n${all}`; } catch { return; }
    if (files.has(id)) return;
    files.add(id);
    for (const { key, value } of valuesOf(file, { every: all })) add(key, value, source, file, all);
  };
  // 1. the files the command names, at the cwd, the project, each directory it names and each directory a cd leaves
  let dirs = [cwd, project];
  try { const P = shellWrites.parseShell(command); dirs.push(...P.cds.map((c) => shellWrites.anchorAt(P.cds, c.index + 1, cwd))); } catch { /* no parse: the cwd and the project */ }
  const named = pathFragments(command).flatMap((f) => { try { return candidatePaths(f); } catch { return []; } });
  const isDir = (d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } };
  for (const n of named) for (const d of [cwd, project]) { const at = pathMod.resolve(d, n); if (dirs.length < 16 && isDir(at)) dirs.push(at); }
  dirs = [...new Set(dirs.filter(Boolean))];
  for (const n of named) for (const d of pathMod.isAbsolute(n) ? [''] : dirs) take(pathMod.resolve(d, n), every, 'named');
  // 2. the well-known files, 3. the stores and the key file, 4. credential-named variables
  const base = { home: HOME, config: accountDir(), project };
  for (const row of WELL_KNOWN) {
    let rels = [row.rel];
    if (row.rel === '.env*') { try { rels = fs.readdirSync(project).filter((n) => /^\.env/i.test(n)); } catch { rels = []; } }
    if (base[row.at]) for (const rel of rels) take(pathMod.resolve(base[row.at], rel), Boolean(row.kind), row.kind ? 'store' : 'well-known');
  }
  let stores = [];
  try { stores = denyStores().map((s) => s.file); } catch { /* no chain reader */ }
  for (const f of stores.concat([project, cwd].flatMap((d) => [d, pathMod.resolve(d, dataRootRel())]).concat(HOME, accountDir()).filter(Boolean).map((d) => pathMod.join(d, KEY_FILE)))) take(f, true, 'store');
  for (const [k, v] of Object.entries(process.env)) if (SECRET_KEY_RE.test(k) && holdsCredential(k, v)) add(k, v, 'env', null);
  return { values, files: [...files] };
}
// Longest value first, then the stream masker's shape pass line by line (its search form reads past a `path:N:` prefix).
function maskText(text, values) {
  const hits = [];
  let out = String(text);
  const list = [...values.keys()].sort((a, b) => b.length - a.length);
  if (list.length) out = out.replace(new RegExp(list.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g'), (v) => { hits.push(values.get(v)); return `<set (${v.length} chars)>`; });
  const shapes = lineRedactor();
  out = out.split('\n').map((l) => shapes.line(l)).join('\n');
  return { text: out, count: hits.length + shapes.masked(), hits };
}
const posted = eventIs(payload, 'PostToolUse');
if (posted || eventIs(payload, 'PostToolUseFailure')) {
  const res = payload.tool_response;
  const shaped = Boolean(res) && typeof res === 'object' && typeof res.stdout === 'string' && typeof res.stderr === 'string';
  const uniq = (list) => [...new Set(list.filter(Boolean))];
  let files = 0;
  const done = () => { const ms = spentMs(); if (ms > MASK_SLOW_MS) ledgerRow('probe', { kind: 'mask-slow', ms, files }); process.exit(0); };
  const observe = (text) => {
    const got = collectValues(payload, false);
    files = got.files.length;
    const { hits } = maskText(text, got.values);
    if (hits.length) ledgerRow('probe', { kind: 'exposure', keys: uniq(hits.map((h) => h.key)).slice(0, 8), count: hits.length, files: uniq(hits.map((h) => h.file)) });
    done();
  };
  if (onCursor) {
    // the second tool name is taken here alone: the shell route's names are decision 17's
    if (posted && /^(?:Bash|Shell)$/.test(payload.tool_name)) observe(shaped ? `${res.stdout}\n${res.stderr}` : String(typeof res === 'string' ? res : payload.tool_output || ''));
    done();
  }
  if (payload.tool_name !== 'Bash') done();
  if (!posted) { if (typeof payload.error === 'string') observe(payload.error); done(); }
  if (res && res.isImage === true) done();
  if (!shaped) {
    const type = res === null ? 'null' : Array.isArray(res) ? 'array' : typeof res;
    ledgerRow('probe', { kind: 'mask-shape', type, keys: type === 'object' ? Object.keys(res).slice(0, 12) : [] });
    done();
  }
  if (!res.stdout && !res.stderr) done();
  const got = collectValues(payload);
  files = got.files.length;
  const answer = (stdout, stderr) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: { ...res, stdout, stderr } } }));
  if (spentMs() > MASK_BUDGET_MS) { ledgerRow('probe', { kind: 'mask-withheld' }); answer(WITHHELD, ''); done(); }
  const out = maskText(res.stdout, got.values);
  const err = maskText(res.stderr, got.values);
  const count = out.count + err.count;
  if (count) { // the masker answers only when it masked something
    const hits = out.hits.concat(err.hits);
    ledgerRow('mask', { branch: 'output', count, sources: uniq(hits.map((h) => h.source).concat(count > hits.length ? ['shape'] : [])), files: uniq(hits.map((h) => h.file)), ms: spentMs() });
    answer(out.text, `${err.text}${err.text && !err.text.endsWith('\n') ? '\n' : ''}# credential guard: ${count} credential value(s) in this output shown as <set (N chars)>. Presence of one key: node "${__filename}" --presence <file> KEY\n`);
  }
  done();
}

const input = payload.tool_input || {};
// A refusal ends in no ask: no receipt opens one (swap 1). The one ask left is the host's, on a Read (askOrDeny).
const refuse = (msg) => { process.stderr.write(msg); process.exit(2); };
const presenceHint = (file) =>
  `Read it for PRESENCE: node "${__filename}" --presence "${file}" [KEY ...]  ->  KEY=set (N chars) | empty | absent.\n` +
  `Every value masked: node "${__filename}" --redacted "${file}". The user sets values by hand; a value a .mcp.json\n` +
  `expands (\`\${NAME}\`) belongs in the ACCOUNT settings file (~/.claude/settings.json), never a project one.\n`;
// SHELL ROUTE: which tools carry a shell command (Bash, PowerShell, Monitor) is shell-writes.js's one list,
// shipped beside this hook on both routes. A copy that runs before it lands judges by the payload's shape - a
// string `command` - so a protective gate never goes quiet for want of a module.
let isShellTool = () => typeof input.command === 'string';
try { ({ isShellTool } = require(pathMod.join(__dirname, 'shell-writes.js'))); } catch { /* see above */ }
// SHORT-LIVED LINKS (hook-prelude.js shortLivedLinks, the user's ruling 2026-10-14): a token in a link's query whose
// link states an hour or less - a Jira media `?token=<JWT>`, an S3 presigned URL - is that link's own capability, and a
// FETCH of it sends it only to the host that issued it. So a command whose every step naming such a token is a fetch OF
// that link - the step's first URL carries it, so `curl https://other -d 'u=<link>'` is no such fetch - passes the
// literal check below, and only when no other credential shape is left once those tokens are blanked out (a bearer
// header keeps the block). Without the prelude nothing is short-lived: the check blocks as it always did.
let shortLivedLinks = () => [];
let withoutShortLived = (text) => text;
try { ({ shortLivedLinks, withoutShortLived } = require(pathMod.join(__dirname, 'hook-prelude.js'))); } catch { /* blocks as before */ }
const FETCH_STEP_RE = /^\s*(?:[A-Za-z_]\w*=\S*\s+)*(?:(?:sudo|nohup|time|command|exec|timeout\s+\S+)\s+)*(?:curl|wget|xh|https?|Invoke-WebRequest|iwr|Invoke-RestMethod|irm)(?:\.exe)?(?=\s)/i;
function shortLivedFetch(raw) {
  const links = shortLivedLinks(raw);
  if (!links.length || SECRET_SHAPE.test(withoutShortLived(raw))) return null;
  const steps = raw.split(/\r?\n|;|&&|\|\||\|/);
  const target = (step) => (/https?:\/\/[^\s'"`<>\\]+/i.exec(step) || [''])[0];
  return steps.every((step) => {
    const named = links.filter((l) => step.includes(l.token));
    return !named.length || (FETCH_STEP_RE.test(step) && named.every((l) => target(step).includes(l.token)));
  }) ? links : null;
}
// One MEASUREMENT row per passed fetch: the host, the seconds left and the kind - never the token.
function shortLivedRow(links) {
  if (unsetRepo) return;
  try {
    const dir = (() => { try { return require('./layout.js').statsPath(process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd(), ['hook-blocks']); } catch { return pathMod.resolve(process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd(), docsRootEnv(), 'hook-blocks'); } })();
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(pathMod.join(dir, `${String(payload.session_id || 'nosession').replace(/[^\w.-]/g, '_')}.jsonl`), JSON.stringify({
      ts: new Date().toISOString(), hook: pathMod.basename(__filename), event: payload.hook_event_name || payload.tool_name || '',
      tool: payload.tool_name || '', mode: 'probe', kind: 'short-lived-link', reason: 'probe: a fetch of a short-lived link passed the literal check',
      detail: { links: links.map((l) => ({ host: l.host, seconds: l.seconds, kind: l.kind, key: l.key })) },
    }) + '\n');
  } catch { /* never throws */ }
}
// ---- THE SHELL ROUTE (swap 1 of the complexity audit, 2026-11-11) ----------------------------------------------------
// Nothing is judged by what a command MIGHT print, and nothing is rewritten: above the masker's floor a foreground Bash
// call runs as written and its OUTPUT comes back masked (the PostToolUse branch above). Before the run this route keeps
// the literal check, the store check, three denies for prints no mask can cover (a comparison, an encoder, a print
// that is not alone) and, where no masker runs, the deny-on-name core.
// THE FLOOR (ruling 4): the client's version is the transcript's newest `version` row, compared numerically per part;
// no transcript, no version row, a torn last row or anything unparsable is no version.
const MASKER_FLOOR = '2.1.322';
function clientVersion(p) {
  try { return typeof p.transcript_path === 'string' && p.transcript_path ? require('./hook-prelude.js').transcriptField(p.transcript_path, 'version') : null; } catch { return null; }
}
function atFloor(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version));
  const floor = MASKER_FLOOR.split('.').map(Number);
  for (let i = 0; m && i < 3; i++) if (Number(m[i + 1]) !== floor[i]) return Number(m[i + 1]) > floor[i];
  return Boolean(m);
}
// CORE MODE (ruling 3) - no masker covers this call: a Cursor payload (first, so no transcript is read: Cursor cannot
// replace shell output), PowerShell (its output shape is unmeasured), Monitor (its output streams as notices), a
// background Bash (its output is read later), a client under the floor or naming no version.
const coreMode = (p) => onCursor || p.tool_name !== 'Bash' || (p.tool_input || {}).run_in_background === true || !atFloor(clientVersion(p));
// The names the core refuses beside a file holding a credential: the store under either name, the key file, an engine.
const ENGINE_NAMES = ['secrets-run', 'secret-chain'];
const isEngine = (f) => ENGINE_NAMES.includes(baseOf(f).replace(/\.js$/i, ''));
const isStoreName = (f) => { const b = baseOf(f); return b === LEGACY_SECRETS_FILE || b === KEY_FILE || (b === SECRETS_FILE && isDataRootSecrets(f)); };
// One command's words, read once by shell-writes.js's own readers: its command words in order, each with the text and
// parse it stands in (`sh`, where its redirects and cd anchors come from). A SHELL's inline script - `bash -c '...'`, a
// heredoc or here-string into a shell, `eval`, behind any wrapper - is commands too (`carriedScripts`, one level; a
// runtime's is not read). No script file is read. Without the module, or when the reader fails, nothing is named (the seam).
function shellEntries(command, cwd) {
  const out = [];
  const read = (raw, dir) => {
    const scan = shellWrites.scanShell(raw, { cwd: dir, files: false });
    // `expand`: a word as the shared reader expands it where it stands - a name the command assigned a literal, `$PWD` after a cd
    const sh = { text: scan.command, P: shellWrites.parseShell(scan.command), cwd: dir, expand: scan.expandVars };
    for (const e of shellWrites.commandWords(sh.text, sh.P)) out.push(Object.assign(e, { sh, argv: e.argv.map(String) }));
  };
  try {
    read(command, cwd);
    for (const s of shellWrites.carriedScripts(command, { cwd, files: false })) read(s.text, s.cwd || cwd);
  } catch { /* what was read stands */ }
  return out;
}
// The directory an earlier `cd` / `pushd` of the same text leaves at this command word; a cd it cannot follow
// (`cd -`, an unexpanded variable) is no anchor, so the judgement stays where it was.
function anchorFor(entry, cwd) {
  try { const a = shellWrites.anchorAt(entry.sh.P.cds, entry.at, entry.sh.cwd) || entry.sh.cwd; return a && a !== cwd ? a : null; } catch { return null; }
}
// The credential files one command word's own words name: each argv word (an option's `=value` side and a `rev:path`'s path too) and each
// input redirect's target, resolved through candidatePaths at the default anchors and the cd's. `left` is the
// command's budget of 64 words. The guard's own value-free modes are the routes every refusal names: never refused.
const OWN_MODES = ['--presence', '--redacted', '--redacted-env', '--with-sensitive'];
function namedBy(entry, cwd, left) {
  const argv = entry.argv;
  if (baseOf(argv[0] || '') === pathMod.basename(__filename) && OWN_MODES.includes(argv[1])) return [];
  const words = argv.slice();
  for (const r of entry.cmd.redirs) if (r.op === '<' && r.target) words.push(shellWrites.dequote(entry.sh.text.slice(r.target.s, r.target.e)));
  // On Windows a relative path's backslash is the separator the model meant (`.claude\settings.json`): Git Bash drops
  // it, and the shared reader keeps it only for a drive or UNC path - so each such word is tried as written too.
  if (process.platform === 'win32') {
    const asWritten = (raw) => { const w = String(raw || '').replace(/^["']|["']$/g, ''); if (w.includes('\\') && !words.includes(w)) words.push(w); };
    for (const t of entry.cmd.words) asWritten(t.raw);
    for (const r of entry.cmd.redirs) if (r.op === '<' && r.target) asWritten(entry.sh.text.slice(r.target.s, r.target.e));
  }
  const out = [];
  cwdAnchor = anchorFor(entry, cwd);
  for (const w of words) {
    if (left.n-- <= 0) break;
    const cut = w.search(/[=:]/); // an option's `=value` side, a `rev:path`
    const x = entry.sh.expand(w, entry.at);
    for (const t of [w, ...(cut > 0 ? [w.slice(cut + 1)] : []), ...(x !== w ? [x] : [])]) {
      const f = resolveFile(t) || (ENGINE_NAMES.includes(baseOf(t)) ? resolveFile(`${t}.js`) : null);
      if (f && (isStoreName(f) || isEngine(f) || secretIn(f))) out.push(f);
    }
  }
  cwdAnchor = null;
  return out;
}
// THE STORE CHECK (ruling 6): the store stays model-blind. A copy, move, link, archive or `git add` NAMING it is
// refused - by what the operand resolves to, or by its text - and so is a tree verb over a folder above it with no
// exclusion naming it (the owner's tree ruling of 2026-10-16). A destination and an extract carry nothing. A read
// passes: its output is masked, every store value at 4+ characters. Per verb: `sub` - what its first word must be,
// `tree` - the flags that make it take a whole folder, `dest` - its last operand (or `-t`'s value) is where it writes,
// `x` - its `-x` opens a list of exclusions (zip). An exclusion lifts the tree rule alone, and only by naming a folder
// or file on the way to the store (`--exclude .alfred`, `-x '.alfred/*'`): a glob that merely covers it is not read.
const TREE = /^(?:-[A-Za-z]*[rRa][A-Za-z]*|--recursive|--archive)$/;
const STORE_CARRIERS = Object.freeze({
  cp: { tree: TREE, dest: true }, ditto: { tree: /^/, dest: true }, mv: { dest: true }, ln: { dest: true }, install: { dest: true }, rsync: { tree: TREE, dest: true }, scp: { tree: TREE, dest: true },
  tar: { sub: /^(?:-?[A-Za-z]*c[A-Za-z]*|--create)$/, tree: /^/ }, zip: { tree: TREE, x: true }, '7z': { sub: /^a$/, tree: /^/ },
  git: { sub: /^add$/, tree: /^(?:-[A-Za-z]*f[A-Za-z]*|--force)$/ },
});
function storeCarry(command, cwd, sh = shellEntries(command, cwd)) {
  for (const e of sh) {
    const spec = Object.prototype.hasOwnProperty.call(STORE_CARRIERS, e.name) ? STORE_CARRIERS[e.name] : null;
    const argv = e.argv;
    if (!spec || (spec.sub && !spec.sub.test(argv[0] || ''))) continue;
    const t = argv.findIndex((w) => w === '-t' || w === '--target-directory');
    const excluded = [];
    let ops = [];
    let list = 0; // 1: the next word is an exclusion's value; 2: every word up to the next option is (zip's -x)
    argv.forEach((w, i) => {
      if (w.startsWith('--exclude=')) excluded.push(w.slice(10));
      else if (w === '--exclude' || (spec.x && w === '-x')) list = w === '-x' ? 2 : 1;
      else if (w.startsWith('-')) list = 0;
      else if (list) { excluded.push(w); list = list === 2 ? 2 : 0; }
      else if (i >= (spec.sub ? 1 : 0) && (t < 0 || i !== t + 1)) ops.push(w);
    });
    if (spec.dest && t < 0 && ops.length > 1) ops = ops.slice(0, -1);
    const tree = Boolean(spec.tree) && argv.some((w) => spec.tree.test(w));
    const left = excluded.map((x) => x.replace(/^\.\//, '').replace(/\/?\**$/, '')).filter(Boolean);
    cwdAnchor = anchorFor(e, cwd);
    const paths = (op) => { try { return candidatePaths(op).flatMap((p) => (pathMod.isAbsolute(p) ? [p] : anchorDirs().map((d) => pathMod.join(d, p)))); } catch { return []; } };
    let hit = null;
    for (const op of ops.flatMap((w) => { const x = e.sh.expand(w, e.at); return x !== w ? [w, x] : [w]; })) {
      hit = storeNameTests(op).MENTION.test(op) ? op : paths(op).find((p) => {
        const real = realOf(p);
        if (isStoreName(p) || isStoreName(real)) return true;
        const top = real.endsWith(pathMod.sep) ? real : real + pathMod.sep;
        return tree && sensitiveStores().some((s) => s.startsWith(top) && !left.some((x) => `/${s.slice(top.length).split(pathMod.sep).join('/')}/`.includes(`/${x}/`)));
      });
      if (hit) break;
    }
    cwdAnchor = null;
    if (hit) return baseOf(realOf(hit)) === KEY_FILE ? `Blocked: this command copies or moves a key file (${KEY_FILE}) - every value in it is a credential, and a copy\nputs them where the chat can read.\n${presenceHint(realOf(hit))}` : storeRefusal();
  }
  return null;
}
// THE THREE DENIES above the floor (ruling 2) - prints the masker cannot cover. A COMPARISON exits non-zero whenever
// its operands differ, and a failed call's output takes no replacement. An ENCODER's output is the content transformed,
// which no exact-text mask matches: each name is a PRINT_VERBS row. A print that is NOT ALONE - another operand, or a
// step after its pipeline in the same list - can fail the same way; a step before it and a filter piped after it leave
// the read's exit status its own. PRINT_VERBS holds no filter verb: `grep K .env && false` is the stated ceiling.
const COMPARE_VERBS = new Set(['diff', 'sdiff', 'cmp']);
const ENCODE_VERBS = new Set(['base64', 'xxd', 'od', 'hexdump', 'rev', 'fold']);
const isCompare = (e) => COMPARE_VERBS.has(e.name) || (e.name === 'git' && e.argv.includes('diff') && e.argv.includes('--no-index'));
if (isShellTool(payload.tool_name)) {
  const raw = String(input.command || '');
  // A credential-shaped literal typed into a command is already in the transcript as the call's own
  // input; blocking still keeps it out of a file, a header and a remote, and names the rule. Judged
  // on the RAW text: a heredoc that writes the value into a file is the same leak. The denial names
  // the shape only - the value is never repeated. A fetch of a short-lived link passes (above).
  const fetched = SECRET_SHAPE.test(raw) ? shortLivedFetch(raw) : null;
  if (fetched) shortLivedRow(fetched);
  if (!fetched && SECRET_SHAPE.test(raw)) {
    refuse('Blocked: the command carries a credential-shaped literal (a token / key / JWT).\n' +
      'Per alfred-security.md a secret never passes through a tool call or the chat: the user puts it\n' +
      'in the file by hand, or runs a copy-ready command in their own terminal (getpass, not an argument).\n');
  }
  const cwd = payload.cwd || process.cwd();
  const sh = shellEntries(raw, cwd);
  const carried = storeCarry(raw, cwd, sh);
  if (carried) { global.BLOCK_DETAIL = { branch: 'store-carry' }; refuse(carried); }
  const left = { n: 64 };
  const named = new Map();
  const namedOf = (e) => { if (!named.has(e)) named.set(e, namedBy(e, cwd, left)); return named.get(e); };
  const deny = (branch, file, why) => { global.BLOCK_DETAIL = { branch, matched: baseOf(file) }; refuse(`Blocked: ${why}\n${presenceHint(file)}`); };
  if (coreMode(payload)) {
    for (const e of sh) {
      const f = namedOf(e)[0];
      if (f) deny('core', f, `this command names a credential file (${baseOf(f)}) on a route whose output cannot be masked - Cursor, PowerShell, Monitor,\na background run, or a Claude Code under ${MASKER_FLOOR}. Nothing ran.`);
    }
    process.exit(0);
  }
  for (const e of sh) {
    const print = shellWrites.printedFiles(e.name, e.argv);
    const encodes = ENCODE_VERBS.has(e.name);
    if (!print && !encodes && !isCompare(e)) continue;
    // an encoder reads what an earlier stage of its own pipeline prints
    const f = (encodes ? sh.filter((o) => o === e || (o.sh === e.sh && o.cmd.elem === e.cmd.elem && o.cmd.stage < e.cmd.stage)) : [e]).map((o) => namedOf(o)[0]).find(Boolean);
    if (!f) continue;
    if (isCompare(e)) deny('compare', f, 'a comparison exits non-zero when its files differ, and a failed call\'s output cannot be masked.\nCompare with `--presence`, or print each file alone - its output comes back masked.');
    if (encodes) deny('encode', f, 'an encoded print cannot be masked - print the file plain (its output comes back masked), use `--presence`,\nor have the user run the encoder.');
    if (print.files.length > 1 || sh.some((o) => o.sh === e.sh && o.cmd.index > e.cmd.index && o.cmd.elem !== e.cmd.elem)) {
      deny('alone', f, 'a credential print beside another file, or before another step, can fail - and a failed call\'s output cannot be masked.\nRun the read alone - its output comes back masked.');
    }
  }
  process.exit(0);
}
function storeRefusal() {
  return 'Blocked: this command names the project\'s sensitive data (.secrets under the data root, .sensitive-data before). Its values never\n' +
    'enter a shell or a file the chat can read - a source, a copy or a print would put them there. Its keys:\n' +
    `  node "${__filename}" --presence <that file>\n` +
    'A command that needs the values gets them in its own environment, each printed as <KEY>:\n' +
    `  node "${__filename}" --with-sensitive -- "<command line>"\n` +
    'The file itself is the user\'s to edit, by hand.\n';
}
// The store's names as text, one build for both readers: MENTION anywhere, BARE `.secrets` only beside a ROOT_WORD naming
// the data root. Each workspace ancestor's data root counts as well, read only when the text names a store at all.
function storeNameTests(text) {
  const roots = [...new Set([dataRootRel(), ...(/\.(?:secrets|sensitive-data)/i.test(text) ? sensitiveRoots() : [])])];
  const ROOT = `(?:${roots.map((r) => r.split('/').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\\\/]')).join('|')})`;
  return { MENTION: new RegExp(`(?:^|[^\\w.-])(?:\\.sensitive-data|${ROOT}[\\\\/]\\.secrets)(?![\\w.-])`, 'i'),
    BARE: /(?:^|[^\w.-])\.secrets(?![\w.-])/i, ROOT_WORD: new RegExp(`(?:^|[^\\w.-])${ROOT}(?![\\w.-])`, 'i') };
}

// A Read of a credential file is the host's to ask about (swap 1, ruling 5): the user sees which file and what allowing
// costs, and answers once per Read. Where nobody can answer - bypassPermissions, dontAsk, an unattended run, a Cursor
// payload (its preToolUse takes 'ask' and does not enforce it) - the Read is refused with the same reason. The ask row
// is what the stop contract reads as the consent to that call's value being in the transcript (askedExposure).
function askOrDeny(file, key) {
  const what = `holds a credential under \`${key}\``;
  const presence = `node "${__filename}" --presence "${file}" [KEY ...]`;
  let nobody = onCursor || /^(?:bypassPermissions|dontAsk)$/.test(String(payload.permission_mode || ''));
  try { nobody = nobody || require('./hook-prelude.js').unattended(payload, process.env); } catch { /* no prelude: the mode alone */ }
  if (nobody) refuse(`Blocked: Read of ${file}, which ${what} - nobody can answer an ask here, and the value would enter the transcript permanently. Presence: ${presence}; the user opens the file.\n`);
  ledgerRow('ask', { branch: 'read', file: pathMod.basename(file) });
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask',
    permissionDecisionReason: `Read of ${file}: it ${what}. Allowing it puts the value in this transcript permanently. Presence only: ${presence}` } }));
  process.exit(0);
}
// ---- Read matcher ----
// The settings.json permissions.deny already stops a Read of the ACCOUNT files by path; this is the
// content-judged complement for everything the path list cannot name - a project settings.json
// holding a misplaced token, a dotenv, an appsettings.json.
if (payload.tool_name === 'Read') {
  const file = resolveFile(String(input.file_path || ''));
  // a window (`offset` / `limit`) of a file past MAX_BYTES is judged on its own lines (HK-07); a smaller file whole
  const window = input.offset != null || input.limit != null ? { offset: input.offset, limit: input.limit } : null;
  const key = file && secretIn(file, window);
  // The store under both names and the key file are the model's never (ruling 6): a plain deny, by identity.
  if (key && isStoreName(realOf(file))) refuse(`Blocked: Read of ${file}, which holds a credential under \`${key}\`.\n` + presenceHint(file));
  if (key) askOrDeny(file, key);
}
// The FIFTH read route (audit 2026-10-30 HK-26): a filesystem server the user registers returns a file's text to the model
// - `read_text_file` (and the older `read_file`) by `path`, with an optional `head` line count, `read_media_file` by `path` (O2:
// base64 of any file, a `.env` included), and `read_multiple_files` by `paths` (the server's README). Each path takes the Read judgement, a `head` as a window from line 1; matched by the tool's
// name under any registration, since the stack ships no server. A listing or a file's facts print no content.
const FS_READ_TOOL = /^mcp__.+__(?:read_file|read_text_file|read_multiple_files|read_media_file)$/;
if (FS_READ_TOOL.test(String(payload.tool_name || ''))) {
  const many = /__read_multiple_files$/.test(String(payload.tool_name));
  const paths = many ? (Array.isArray(input.paths) ? input.paths : []) : [input.path];
  const head = Number(input.head);
  const window = !many && Number.isInteger(head) && head > 0 ? { offset: 1, limit: head } : null;
  for (const p of paths.slice(0, 50)) {
    const file = resolveFile(String(p || ''));
    const key = file && secretIn(file, window);
    if (key) {
      global.BLOCK_DETAIL = { branch: 'mcp-file-read', matched: pathMod.basename(file).slice(0, 40) };
      refuse(`Blocked: ${String(payload.tool_name).replace(/^mcp__.+__/, '')} of ${file}, which holds a credential under \`${key}\` - a`
        + ` filesystem server returns the file's text to the chat, the same value read a Read is refused.\n` + presenceHint(file));
    }
  }
}

// The first credential file a content-mode Grep over `root` would print a line of: a file the (glob / type) filters let the
// search reach, whose text the pattern matches and whose CONTENT holds a credential. Breadth-first in name order, so the same
// tree gives the same answer and a shallow `.env` is read before a deep dependency tree; the folders a dependency manager or a
// build fills (`.venv`, `vendor`, `target`, ...) are walked last, never skipped. A tree past WALK_FILES files the filters let
// through, WALK_BYTES bytes or WALK_ENTRIES entries seen is left unjudged - the count was taken before the filters, so 4,000
// files of a `.venv` ended the walk before a credential file past it (audit 2026-10-08). Hidden and git-ignored files are
// walked too (the search may reach them), and `.git` / `node_modules` are not.
const GREP_TYPES = { js: 'js|mjs|cjs|jsx', ts: 'ts|tsx|mts|cts', py: 'py|pyi', yaml: 'ya?ml', md: 'md|markdown|mdx', cs: 'cs|csx', json: 'jsonc?|json5', sh: 'sh|bash|zsh', rust: 'rs', java: 'java', go: 'go' };
// The Grep tool's pattern is ripgrep's syntax. What JavaScript reads differently is translated - a leading inline flag
// group (`(?i)`, `(?s)`, `(?m)`) and the anchors `\A` / `\z` (a line's ends, the input's in multiline mode; JavaScript
// read `\z` as a literal `z`) - and a pattern that still does not compile matches every line: the file is then judged by
// its content alone, never passed unjudged (`(?i)api_token` passed, audit 2026-10-08).
function grepRegex(pattern, tool) {
  let src = String(pattern || '');
  let flags = `m${tool['-i'] ? 'i' : ''}${tool.multiline ? 's' : ''}`;
  const lead = src.match(/^\(\?([imsx]+)\)/);
  if (lead && !lead[1].includes('x')) { src = src.slice(lead[0].length); for (const f of lead[1]) if (!flags.includes(f)) flags += f; }
  const [start, end] = tool.multiline ? ['(?<![\\s\\S])', '(?![\\s\\S])'] : ['^', '$'];
  src = src.replace(/(^|[^\\])((?:\\\\)*)\\A/g, (all, a, b) => a + b + start).replace(/(^|[^\\])((?:\\\\)*)\\z/g, (all, a, b) => a + b + end);
  try { return new RegExp(src, flags); } catch { return { test: () => true }; }
}
function walkCredentialFile(root, tool) {
  const re = grepRegex(tool.pattern, tool);
  const glob = typeof tool.glob === 'string' && tool.glob && !tool.glob.startsWith('!') ? tool.glob : '';
  const globRes = glob ? expandBraces(glob).map((g) => new RegExp('^' + g.replace(/[.+^$()|\\]/g, '\\$&').replace(/\*\*\//g, '(?:.*/)?').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$')) : [];
  const typeRe = typeof tool.type === 'string' && tool.type ? new RegExp(`\\.(?:${GREP_TYPES[tool.type] || tool.type.replace(/\W/g, '')})$`, 'i') : null;
  const queue = [root];
  const later = [];
  let files = 0;
  let bytes = 0;
  let seen = 0;
  for (let q = 0; q < queue.length || later.length; q++) {
    if (q >= queue.length) { queue.push(...later.splice(0)); }
    const dir = queue[q];
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    entries.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
    for (const e of entries) {
      if (++seen > WALK_ENTRIES) return null;
      const full = pathMod.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== '.git' && e.name !== 'node_modules') (WALK_LAST.test(e.name) ? later : queue).push(full); continue; }
      if (!e.isFile()) continue;
      if (typeRe && !typeRe.test(e.name)) continue;
      const rel = pathMod.relative(root, full).split(pathMod.sep).join('/');
      if (globRes.length && !globRes.some((g) => g.test(glob.includes('/') ? rel : e.name))) continue;
      if (++files > WALK_FILES) return null;
      let size;
      try { size = fs.statSync(full).size; } catch { continue; }
      // a file past MAX_BYTES is searched and judged by its first MAX_BYTES, as secretIn judges it (HK-07)
      bytes += Math.min(size, MAX_BYTES);
      if (bytes > WALK_BYTES) return null;
      let text;
      try { text = size > MAX_BYTES ? readText(full, MAX_BYTES) : readText(full); } catch { continue; }
      if (re.test(text) && secretIn(full)) return full;
    }
  }
  return null;
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
  if (SECRET_SHAPE.test(String(input.pattern || ''))) {
    refuse('Blocked: the Grep pattern carries a credential-shaped literal (a token / key / JWT).\n'
      + 'Per alfred-security.md a secret never passes through a tool call or the chat, and a search\n'
      + 'pattern is a tool input like any other - it is in the transcript before the first match is.\n'
      + 'Search for the KEY NAME instead, or ask presence:\n'
      + `  node "${__filename}" --presence <file> [KEY ...]\n`);
  }
  if (String(input.output_mode || 'files_with_matches') === 'content') {
    const target = String(input.path || '');
    // A NAMED file is judged by its own content. A directory target, or no path at all, is a tree walk: judged by what it
    // would PRINT - a credential file under it holding a line the pattern matches (walkCredentialFile). The walk is capped
    // by files and bytes, never by time; past a cap it stays unjudged.
    const file = target ? resolveFile(target) : null;
    let dir = null;
    if (target && !file) {
      for (const p of candidatePaths(target)) {
        for (const c of pathMod.isAbsolute(p) ? [p] : anchorDirs().map((d) => pathMod.join(d, p))) { try { if (!dir && fs.statSync(c).isDirectory()) dir = c; } catch { /* next anchor */ } }
      }
    }
    if (file) {
      const key = secretIn(file);
      if (key) {
        refuse(`Blocked: Grep -> content of ${file}, which holds a credential under \`${key}\`.\n` +
          `A content-mode Grep PRINTS the matching lines, so it is the same value read the Read and\n` +
          `shell routes already block - just spelled as a search. Use \`output_mode: "count"\` or\n` +
          `\`"files_with_matches"\` to ask whether the key is there, or the presence route for what it holds.\n` +
          presenceHint(file));
      }
    } else if (!target || dir) {
      const hit = walkCredentialFile(dir || (typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.env.CLAUDE_PROJECT_DIR || process.cwd()), input);
      if (hit) {
        refuse(`Blocked: Grep -> content over a directory reaches ${hit}, which holds a credential under \`${secretIn(hit)}\`, and the pattern matches a line of it.\n` +
          `A content-mode Grep PRINTS the matching lines, so this is the same value read the Read and shell routes\n` +
          `already block - spelled as a tree search. Use \`output_mode: "count"\` or \`"files_with_matches"\` to ask which files\n` +
          `mention it, narrow the pattern or \`glob\` away from that file, or the presence route for what it holds.\n` +
          presenceHint(hit));
      }
    }
  }
}
process.exit(0);
