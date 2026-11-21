#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// The data-class guard's judges: pure functions, no effects. A Read of a data dump or a business document asks the
// user; an outside query that carries project code is refused with the exact tokens to remove.
'use strict';

const DUMP_MIN_BYTES = 102400;
const PII_MIN = 20;
const HEAD_BYTES = 512 * 1024;
const EGRESS_DEADLINE_MS = 4000;
const DATA_EXTS = ['.sql', '.dump', '.bak', '.csv', '.tsv', '.jsonl', '.ndjson', '.parquet', '.avro', '.db', '.sqlite', '.sqlite3', '.xlsx', '.xls'];
const TEXT_DATA_EXTS = ['.csv', '.tsv', '.json', '.jsonl', '.ndjson', '.txt', '.log', '.sql', '.xml', '.yaml', '.yml', ''];
const DOC_EXTS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.rtf', '.pages', '.numbers', '.key'];
const PUBLIC_NAMES = ['getServerSideProps', 'getStaticProps', 'getStaticPaths', 'generateMetadata', 'generateStaticParams',
  'mapStateToProps', 'mapDispatchToProps', 'componentDidMount', 'componentDidUpdate', 'componentWillUnmount', 'ngOnInit', 'ngOnDestroy',
  'ngOnChanges', 'ngAfterViewInit', 'ConfigureServices', 'OnModelCreating', 'setUp', 'tearDown', 'setUpClass', 'tearDownClass', 'beforeEach',
  'afterEach'];
const DOC_SERVERS = ['context7'];

const PUBLIC_SET = new Set(PUBLIC_NAMES);
const QUERY_FIELDS = ['query', 'question', 'q', 'search', 'searchQuery', 'topic', 'text'];
const RESERVED_TLDS = new Set(['example', 'test', 'invalid', 'localhost']);
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org'];
const DUMP_WORD = /(?:^|[^A-Za-z0-9])(prod|production|backup|export|dump|snapshot)(?=[^A-Za-z0-9]|$)/i;
const MARKER = /=>|===|!==|[{};]/g;
const SPLIT = /[\s"'`()[\]{},;]+/;
const LIST_FILE = '.alfred/.sensitive-paths';

const isLocal = (c) => /[A-Za-z0-9._%+-]/.test(c);
const isDomain = (c) => /[A-Za-z0-9.-]/.test(c);

function reservedDomain(domain) {
  if (domain === 'localhost') return true;
  if (RESERVED_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d))) return true;
  return RESERVED_TLDS.has(domain.slice(domain.lastIndexOf('.') + 1));
}

function emailsIn(text) {
  const found = new Set();
  let at = text.indexOf('@');
  while (at !== -1) {
    let start = at;
    while (start > 0 && at - start < 64 && isLocal(text[start - 1])) start--;
    let end = at + 1;
    while (end < text.length && end - at < 256 && isDomain(text[end])) end++;
    const local = text.slice(start, at);
    const domain = text.slice(at + 1, end).replace(/[.-]+$/, '').toLowerCase();
    const labels = domain.split('.');
    if (local && labels.length > 1 && labels.every((l) => l) && /^[a-z]{2,}$/.test(labels[labels.length - 1]) && !reservedDomain(domain)) {
      found.add(local.toLowerCase() + '@' + domain);
    }
    at = text.indexOf('@', at + 1);
  }
  return found.size;
}

function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function mod97(iban) {
  if (iban.length < 15 || iban.length > 34) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const code = ch.charCodeAt(0);
    const n = code >= 65 ? code - 55 : code - 48;
    rem = n > 9 ? (rem * 100 + n) % 97 : (rem * 10 + n) % 97;
  }
  return rem === 1;
}

function piiCounts(text) {
  const src = String(text);
  const ibans = new Set();
  const cards = new Set();
  const phones = new Set();
  const compact = /(?<![A-Za-z0-9])[A-Z]{2}\d{2}[A-Z0-9]{11,30}(?![A-Za-z0-9])/g;
  const grouped = /(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?: [A-Z0-9]{4}){2,7}(?: [A-Z0-9]{1,3})?(?![A-Za-z0-9])/g;
  let rest = src.replace(compact, (m) => {
    if (!mod97(m)) return m;
    ibans.add(m);
    return ' ';
  });
  rest = rest.replace(grouped, (m) => {
    let cut = m;
    while (cut.length >= 15) {
      if (mod97(cut.replace(/ /g, ''))) {
        ibans.add(cut.replace(/ /g, ''));
        return ' ' + m.slice(cut.length);
      }
      const i = cut.lastIndexOf(' ');
      if (i < 0) break;
      cut = cut.slice(0, i);
    }
    return m;
  });
  for (const m of rest.matchAll(/(?<![\w+])\d(?:[ -]?\d){12,18}(?!\w)/g)) {
    const digits = m[0].replace(/[ -]/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) cards.add(digits);
  }
  for (const m of rest.matchAll(/(?<![\w+])\+\d{10,15}(?!\d)/g)) phones.add(m[0]);
  const emails = emailsIn(src);
  return { emails, cards: cards.size, ibans: ibans.size, phones: phones.size, total: emails + cards.size + ibans.size + phones.size };
}

function parseSensitivePaths(text) {
  const listed = [];
  const cleared = [];
  if (typeof text !== 'string') return { listed, cleared };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('!')) {
      const rest = line.slice(1).trim();
      if (rest) cleared.push(rest);
    } else {
      listed.push(line);
    }
  }
  return { listed, cleared };
}

function globMatch(glob, rel) {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\/]/g, '\\$&');
    }
  }
  return new RegExp(re + '$', 'i').test(rel);
}

function pathState(rel, lists) {
  if (rel === null || rel === undefined) return null;
  const usable = (g) => !g.includes('..') && !g.startsWith('/');
  const hit = (globs) => (globs || []).filter(usable).some((g) => globMatch(g, rel));
  if (hit(lists && lists.cleared)) return 'cleared';
  if (hit(lists && lists.listed)) return 'listed';
  return null;
}

function counts(c) {
  const parts = [];
  if (c.emails) parts.push(c.emails + (c.emails === 1 ? ' email' : ' emails'));
  if (c.cards) parts.push(c.cards + (c.cards === 1 ? ' card' : ' cards'));
  if (c.ibans) parts.push(c.ibans + (c.ibans === 1 ? ' IBAN' : ' IBANs'));
  if (c.phones) parts.push(c.phones + (c.phones === 1 ? ' phone' : ' phones'));
  return parts.join(', ');
}

function dumpVerdict({ base, ext, bytes, tracked, head }) {
  const e = String(ext || '').toLowerCase();
  if (DATA_EXTS.includes(e)) {
    const word = DUMP_WORD.exec(String(base || ''));
    if (word) return { branch: 'dump-name', why: `name says '${word[1].toLowerCase()}'` };
    if (bytes > DUMP_MIN_BYTES && !tracked) return { branch: 'dump-size', why: `${Math.round(bytes / 1024)} KB ${e}` };
  }
  if (TEXT_DATA_EXTS.includes(e) && typeof head === 'string') {
    const c = piiCounts(head);
    if (c.total >= PII_MIN) return { branch: 'dump-pii', why: `${c.total} personal-data values: ${counts(c)}` };
  }
  return null;
}

function documentVerdict({ ext, tracked, listed }) {
  const e = String(ext || '').toLowerCase();
  if (listed) return { branch: 'document-listed', kind: `listed in ${LIST_FILE}` };
  if (DOC_EXTS.includes(e) && !tracked) return { branch: 'document-untracked', kind: `an untracked ${e}` };
  return null;
}

function serverOf(toolName) {
  const m = /^mcp__(.+?)__.+$/.exec(String(toolName || ''));
  if (!m) return null;
  const server = m[1];
  if (server.startsWith('plugin_')) {
    const rest = server.slice('plugin_'.length);
    return rest.slice(rest.lastIndexOf('_') + 1) || null;
  }
  return server;
}

function judgedTexts(toolName, input, extraServers) {
  const inp = input && typeof input === 'object' ? input : {};
  if (toolName === 'WebSearch') return typeof inp.query === 'string' && inp.query ? [inp.query] : [];
  if (toolName === 'WebFetch') {
    if (typeof inp.url !== 'string') return [];
    let url;
    try {
      url = new URL(inp.url);
    } catch {
      return [];
    }
    const values = [];
    for (const v of url.searchParams.values()) if (v) values.push(v);
    return values;
  }
  const server = serverOf(toolName);
  if (!server) return null;
  const known = DOC_SERVERS.concat(extraServers || []).map((s) => String(s).toLowerCase());
  if (!known.includes(server.toLowerCase())) return null;
  return QUERY_FIELDS.filter((f) => typeof inp[f] === 'string' && inp[f]).map((f) => inp[f]);
}

function tokensOf(text) {
  const out = [];
  for (const raw of String(text).split(SPLIT)) {
    if (!raw) continue;
    out.push(raw.replace(/:\d+(?::\d+)?$/, ''));
    if (out.length >= 400) break;
  }
  return out;
}

function pathCandidates(tokens) {
  const out = [];
  for (const t of tokens) {
    if (!t.includes('/') || !/\.[A-Za-z0-9]+$/.test(t)) continue;
    if (/[*?[\]{}\\]|:\(/.test(t)) continue;
    const c = t.startsWith('./') ? t.slice(2) : t;
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

function trackedArgv(file) {
  const parts = String(file).split(/[\\/]/);
  return ['ls-files', '--error-unmatch', '--', parts[parts.length - 1]];
}

function pathsArgv(candidates) {
  return ['ls-files', '-z', '--'].concat(candidates.map((c) => ':(glob)**/' + c));
}

function namesArgv(candidates) {
  const argv = ['grep', '-o', '-h', '-I', '-E'];
  for (const raw of candidates) {
    const c = raw.replace(/\$/g, '\\$');
    argv.push('-e', `(function|class|def|interface|type|enum|struct|record|func|fn|module|namespace)[[:space:]]+${c}([^[:alnum:]_$]|$)`);
    argv.push('-e', `(^|[^[:alnum:]_$.])${c}[[:space:]]*[:=][[:space:]]*(async[[:space:]]+)?(function|\\()`);
  }
  return argv;
}

function pathsFound(lsOutput, candidates) {
  const listed = String(lsOutput).split('\0').filter(Boolean);
  return candidates.filter((c) => listed.some((p) => p === c || p.endsWith('/' + c)));
}

function wholeWord(line, name) {
  const escaped = name.replace(/\$/g, '\\$');
  return new RegExp('(?:^|[^A-Za-z0-9_$])' + escaped + '(?:[^A-Za-z0-9_$]|$)').test(line);
}

function namesFound(grepOutput, candidates) {
  const lines = String(grepOutput).split(/\r?\n/).filter(Boolean);
  return candidates.filter((c) => lines.some((l) => wholeWord(l, c)));
}

function codeLines(text) {
  const src = String(text);
  if (src.length < 40) return 0;
  let total = 0;
  let dense = false;
  let withMarker = 0;
  for (const line of src.split(/\r?\n/)) {
    const n = (line.match(MARKER) || []).length;
    if (n) withMarker++;
    if (n >= 2) dense = true;
    total += n;
  }
  return dense || total >= 3 ? withMarker : 0;
}

function egressFindings(text, found) {
  const paths = (found && found.paths) || [];
  const names = (found && found.names) || [];
  const lines = codeLines(text);
  return { paths: paths.slice(), names: names.slice(), codeLines: lines, any: paths.length > 0 || names.length > 0 || lines > 0 };
}

function nameCandidates(tokens) {
  const out = [];
  for (const t of tokens) {
    for (const part of t.split('.')) {
      if (out.length >= 12) return out;
      if (part.length < 5 || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(part)) continue;
      if (!/.[A-Z]/.test(part) && !/[A-Za-z]_[A-Za-z]/.test(part)) continue;
      if (PUBLIC_SET.has(part) || out.includes(part)) continue;
      out.push(part);
    }
  }
  return out;
}

function rewriteBrief({ tool, text, paths, names, codeLines: lines }) {
  const removed = paths.concat(names);
  if (lines > 0) removed.push(lines === 1 ? '1 code line' : `${lines} code lines`);
  const pathSet = new Set(paths);
  const nameSet = new Set(names);
  const kept = String(text)
    .split(/\r?\n/)
    .filter((l) => !(lines > 0 && /=>|===|!==|[{};]/.test(l)))
    .join(' ')
    .split(/\s+/)
    .filter((w) => {
      if (!w) return false;
      return !tokensOf(w).some((t) => pathSet.has(t.replace(/^\.\//, '')) || t.split('.').some((p) => nameSet.has(p)));
    });
  const example = kept.length >= 2 ? ` e.g. "${kept.join(' ')}",` : '';
  return [
    `Blocked: this ${tool} query sends project code to a third-party service.`,
    `Remove: ${removed.join(', ')}.`,
    'Keep: the language and its version, public library and API names, the error type and its generic message, the behaviour.',
    `Search again in general terms,${example} then apply the answer to the local code.`,
    'The code itself never leaves this session.',
  ].join('\n');
}

function askText(route, path, detail) {
  if (route === 'document') {
    return `Read of ${path}: it is a business document (${detail}) - price lists, HR files and contracts belong only in an AI cleared for them. Allow only if this document is cleared for this AI; a '!${path}' line in ${LIST_FILE} clears it for good.`;
  }
  return `Read of ${path}: it looks like a data dump (${detail}). Real personal or production records should not enter this transcript - use a synthetic or anonymized sample. Allow only if this data is cleared for this AI; a '!${path}' line in ${LIST_FILE} clears it for good.`;
}

function denyText(route, path, detail) {
  const what = route === 'document' ? `it is a business document (${detail})` : `it looks like a data dump (${detail})`;
  return `Blocked: Read of ${path}: ${what}, and nobody is here to clear it. Work from a synthetic sample, or leave this read to the user.`;
}

module.exports = {
  DUMP_MIN_BYTES, PII_MIN, HEAD_BYTES, EGRESS_DEADLINE_MS, PUBLIC_NAMES, DOC_SERVERS, DATA_EXTS, TEXT_DATA_EXTS, DOC_EXTS,
  piiCounts, parseSensitivePaths, globMatch, pathState, dumpVerdict, documentVerdict, serverOf, judgedTexts,
  tokensOf, pathCandidates, trackedArgv, pathsArgv, namesArgv, pathsFound, namesFound, egressFindings, nameCandidates,
  codeLines, rewriteBrief, askText, denyText,
};
