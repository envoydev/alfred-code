'use strict';
// The mode file (layout.modeFile): its trust test and its one writer (mode commands v2, stage 3). It requires the layout and
// JSON readers alone, never the prelude, which requires it - fresh-session.js, which loads the prelude, is required in the call.
const fs = require('node:fs');
const path = require('node:path');
const layout = require('./layout.js');
const { parseJson, formatOf, stringifyLike } = require('./json-file.js');

// git's exit status in the folder holding `.claude` (fsmonitor off, no optional locks, no inherited GIT_*); null when it cannot run.
function localGitStatus(file, args = ['ls-files', '--error-unmatch', '--', ':(icase).claude/settings.local.json']) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));
  const r = require('node:child_process').spawnSync('git', ['-c', 'core.fsmonitor=false', ...args],
    { cwd: path.dirname(path.dirname(file)), env: { ...env, GIT_OPTIONAL_LOCKS: '0' }, stdio: 'ignore', timeout: 3000, windowsHide: true });
  return r.error || r.status === null ? null : r.status;
}
// 'tracked', 'own' (no repository, or git finds no match) or 'unknown' (a linked `.claude` or one holding a `.git`; git odd).
function localTrust(file, status = localGitStatus) {
  const claude = path.dirname(file);
  try { const st = fs.lstatSync(claude, { throwIfNoEntry: false });
    if (st && (st.isSymbolicLink() || fs.existsSync(path.join(claude, '.git')))) return 'unknown'; } catch { return 'unknown'; }
  return !layout.gitTopOf(path.dirname(claude)) ? 'own' : ({ 0: 'tracked', 1: 'own' })[status(file)] || 'unknown';
}
const [AUTO_RUN, COMPACT] = ['ALFRED_CODE_AUTO_RUN', 'ALFRED_CODE_AUTO_COMPACT'];
const WHY = { unreadable: 'the file is not valid JSON', tracked: 'git tracks the file', unvouched: 'git cannot say the file is yours alone',
  unwritable: 'the file cannot be written' };
const plain = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const readObj = (file) => { try { return parseJson(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const windowOf = (o, id) => (plain(o) && plain(o.modelSettings) && plain(o.modelSettings[id]) ? o.modelSettings[id].autoCompactWindow : undefined);
// One model's window row; `undefined` takes it out, with the entry and the modelSettings it leaves empty.
function setWindow(data, id, value) {
  const ms = plain(data.modelSettings) ? data.modelSettings : (data.modelSettings = {});
  if (value !== undefined) ms[id] = { ...ms[id], autoCompactWindow: value };
  else if (plain(ms[id]) && delete ms[id].autoCompactWindow && !Object.keys(ms[id]).length) delete ms[id];
  if (!Object.keys(ms).length) delete data.modelSettings;
}
// The tier triggers the windows are seeded from: the mode file's own folder's, when the file is another folder's (a session
// started in a sub-folder or a worktree reads its start folder's variables, which hold none of them) - so the command typed
// there writes the bytes the top's own write and the installer's refresh give (Task 10's matrix, M12).
const realOr = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
function tierEnv(root, file, env) {
  const owner = path.dirname(path.dirname(file));
  if (realOr(root) === realOr(owner)) return env;
  const values = layout.variablesOf(owner, { env }).values;
  return { ...env, ...Object.fromEntries(Object.entries(values).filter(([k]) => k.startsWith('ALFRED_CODE_CONTEXT_WINDOW_'))) };
}
// Step 4: Claude Code's own two keys, from ALFRED_CODE_AUTO_COMPACT once the updates are in (spec 3.4's table).
function compactStep(data, file, updates, env, out) {
  const models = (readObj(path.join(__dirname, 'model-windows.json')) || {}).models || {};
  if (updates[COMPACT] === null) return void (delete data.autoCompactEnabled, Object.keys(models).forEach((id) => setWindow(data, id)));
  const value = (data.env || {})[COMPACT];
  if (value === '0' && updates[COMPACT] === '0') data.autoCompactEnabled = false;
  if (value !== '1') return;
  if (![undefined, true].includes(data.autoCompactEnabled)) out.replaced.push(`replaced autoCompactEnabled ${data.autoCompactEnabled}`);
  data.autoCompactEnabled = true;
  const others = [[path.dirname(file), '.claude/settings.json'], [env.CLAUDE_CONFIG_DIR || path.join(require('node:os').homedir(), '.claude'),
    'the account settings.json']].map(([dir, name]) => [readObj(path.join(dir, 'settings.json')), name]);
  const top = [[data, '.claude/settings.local.json'], ...others].find(([o]) => plain(o) && o.autoCompactWindow !== undefined);
  if (top) return void out.left.push(`window for every model left to ${top[1]}`);
  const seeds = require('./fresh-session.js').compactWindowSeeds(models, env);
  for (const id of Object.keys(models)) {
    const named = others.find(([o]) => windowOf(o, id) !== undefined);
    if (named) { out.left.push(`window for ${id} left to ${named[1]}`); continue; }
    if (![undefined, seeds[id]].includes(windowOf(data, id))) out.replaced.push(`replaced autoCompactWindow ${windowOf(data, id)} for ${id}`);
    setWindow(data, id, seeds[id]);
    if (seeds[id]) out.windows[id] = seeds[id];
  }
}
// The one writer: `updates` maps MODE_KEYS to a value, or null to remove it; a `why` means nothing was written.
function writeModes(root, updates = {}, env = process.env) {
  const refuse = (why) => ({ changed: false, why, windows: {}, replaced: [], left: [], unignored: false });
  const file = layout.modeFile(root);
  let [text, data] = [null, {}];
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') return refuse('unwritable'); }
  try { if (text !== null) data = parseJson(text); } catch { data = null; }
  if (!plain(data) || (Object.hasOwn(data, 'env') && !plain(data.env))) return refuse('unreadable');
  const trust = localTrust(file);
  if (trust === 'tracked' || (trust !== 'own' && updates[AUTO_RUN] === '1')) return refuse(trust === 'tracked' ? 'tracked' : 'unvouched');
  const [out, block] = [refuse(''), data.env || {}];
  let emptied = false;
  for (const key of layout.MODE_KEYS.filter((k) => Object.hasOwn(updates, k)))
    if (updates[key] !== null) block[key] = String(updates[key]);
    else if (Object.hasOwn(block, key)) emptied = delete block[key] && !Object.keys(block).length;
  if (Object.keys(block).length) data.env = block;
  else if (emptied) delete data.env;
  compactStep(data, file, updates, (data.env || {})[COMPACT] === '1' ? tierEnv(root, file, env) : env, out);
  const next = stringifyLike(data, formatOf(text ?? ''));
  if (next === text || (text === null && !Object.keys(data).length)) return out;
  const target = (() => { try { return fs.realpathSync.native(file); } catch { return file; } })();   // a link keeps its target
  const tmp = path.join(path.dirname(target), `.settings.local.json.${process.pid}.tmp`);
  try { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(tmp, next); fs.renameSync(tmp, target); }
  catch { try { fs.unlinkSync(tmp); } catch { /* none made */ } return refuse('unwritable'); }
  out.unignored = text === null && Boolean(layout.gitTopOf(path.dirname(path.dirname(file))))
    && localGitStatus(file, ['check-ignore', '-q', '--', '.claude/settings.local.json']) === 1;
  return { ...out, changed: true };
}
// '' unless the mode file's env holds ALFRED_CODE_AUTO_RUN '1'; then its trust - only 'own' is a standing auto-run.
const autoRunHeld = (root, file = layout.modeFile(root), data = readObj(file)) =>
  (plain(data) && plain(data.env) && data.env[AUTO_RUN] === '1' ? localTrust(file) : '');
const said = (r) => [...r.replaced, ...r.left].map((n) => ` - ${n}`).join('')
  + (r.unignored ? ' - .claude/settings.local.json was created and git does not ignore it here: add it to .gitignore' : '');

module.exports = { localGitStatus, localTrust, writeModes, WHY, autoRunHeld, said };
