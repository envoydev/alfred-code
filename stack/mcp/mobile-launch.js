#!/usr/bin/env node
'use strict';
// THE MOBILE SERVER'S LAUNCHER - mobile-control (appium-mcp): drives Android and iOS apps on an emulator, a
// simulator or a real device through Appium's embedded UiAutomator2 and XCUITest drivers.
//
//   node mobile-launch.js --package appium-mcp@<ver> [--before <cut-off>] [-- <more server arguments>]
//
// `--before` is the pin's own dependency cut-off (refresh-mcp-pins.js 'an npm row's own day'), handed to npx as
// npm_config_before (audit 2026-10-14, PL4): appium-mcp pins only itself, its 17 dependencies are caret ranges, and npx
// honours `before` for the whole tree it resolves (measured on npm 11.6.1). A npm_config_before the user set - the shell
// in any case, then the three settings files - is theirs and wins; an empty one means no cut-off.
//
// It exists for three things a plugin entry cannot do:
// - the SDK paths. appium-mcp reads ANDROID_HOME (the Android SDK) and JAVA_HOME (a JDK) from its environment. A
//   value set in the shell or in a settings file's `env` is the answer (settingFrom - the shell first, then the
//   project's settings.local.json and settings.json, then the account's). Only an UNSET one is looked up: the
//   Android SDK at ANDROID_SDK_ROOT, then the place Android Studio installs it; the JDK through macOS's
//   /usr/libexec/java_home, then Android Studio's bundled JBR. A Claude Code started from the dock or an IDE often
//   has neither variable. iOS needs Xcode, which Appium finds through xcode-select (DEVELOPER_DIR when set) - not
//   touched here.
// - the output dirs. Screenshots, recordings and saved page sources land under the project's data root
//   (<data root>/mobile-control, a PROJECT setting a plugin entry never sees), not the system temp dir.
// - the safe defaults, each only where nothing sets the variable: NO_UI=true (no HTML UI payloads, fewer tokens),
//   ALLOW_REMOTE_APP_URLS=false (an app installs from a local path, never a download), and a
//   REMOTE_SERVER_URL_ALLOW_REGEX that admits a local Appium server only. Setting the variable lifts its default.
// Node 22 is appium-mcp's floor (its package.json engines): an older Node is refused with that line instead of a
// failure inside npx.
//
// The copy route registers no launcher: the same defaults and dirs reach its registration at install time
// (copyRouteEnv), and the SDK paths come from the environment Claude Code starts with.
//
// stdout is the MCP stream: nothing is written to it here, diagnostics go to stderr. The spawn is the installer's
// Windows-safe one (scripts/install/runtime.js): npx is a batch file on Windows.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dataRoot = require('./data-root.js');
const { settingFrom } = require('./uv-python.js');

const NODE_FLOOR = 22;
// A local Appium server only: localhost, 127.0.0.1 or [::1], any port, any path - the whole URL is matched
// (appium-mcp utils/url.ts validateRemoteServerUrl), so a host that only starts with 'localhost' is refused.
const LOCAL_ONLY = '^https?://(localhost|127\\.0\\.0\\.1|\\[::1\\])(:[0-9]+)?(/[^?#]*)?$';
const DEFAULTS = Object.freeze({ NO_UI: 'true', ALLOW_REMOTE_APP_URLS: 'false', REMOTE_SERVER_URL_ALLOW_REGEX: LOCAL_ONLY });
// appium-mcp fails its start on a value other than true / false (utils/env.ts readBooleanEnv).
const BOOLEAN = new Set(['NO_UI', 'ALLOW_REMOTE_APP_URLS']);
// The keys appium-mcp documents (its 1.97.1 README: the 'Environment Variables' table, and ANDROID_HOME from the setup
// steps) - the only ones the project's sensitive data hands it (audit 2026-10-14 PL2). Another key there (a login, a
// token for some other tool) stays out of the server's environment.
const DOCUMENTED = Object.freeze(['ANDROID_HOME', 'CAPABILITIES_CONFIG', 'SCREENSHOTS_DIR', 'PAGE_SOURCES_DIR', 'NO_UI', 'APPIUM_MCP_APPS_ENABLED',
    'APPIUM_MCP_ON_CLIENT_DISCONNECT', 'APPIUM_MCP_WDA_APP_PATH', 'REMOTE_SERVER_URL_ALLOW_REGEX', 'REMOTE_SERVER_ENABLE_DIRECT_CONNECT',
    'ALLOW_REMOTE_APP_URLS', 'AI_VISION_ENABLED', 'AI_VISION_API_BASE_URL', 'AI_VISION_API_KEY', 'AI_VISION_MODEL', 'AI_VISION_COORD_TYPE',
    'AI_VISION_IMAGE_MAX_WIDTH', 'AI_VISION_IMAGE_QUALITY', 'APPIUM_MCP_DOCS_ENABLED', 'SENTENCE_TRANSFORMERS_MODEL',
    'APPIUM_MCP_PERSIST_REMOTE_SESSIONS_PATH', 'APPIUM_MCP_EVIDENCE', 'APPIUM_MCP_OTEL_ENABLED', 'APPIUM_MCP_OTEL_INCLUDE_ARGUMENT_VALUES',
    'OTEL_SERVICE_NAME', 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', 'OTEL_TRACES_SAMPLER', 'OTEL_RESOURCE_ATTRIBUTES']);

const exists = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// Where Android Studio puts the SDK on each OS (its default; the SDK Manager can move it).
// Each place is spelled for the platform it names (path.posix / path.win32), never the host's: found by the Windows
// gate leg, where the darwin case came back with backslashes.
function defaultSdk({ platform, home, env })
{
    if (platform === 'darwin') return path.posix.join(home, 'Library', 'Android', 'sdk');
    if (platform === 'win32') return env.LOCALAPPDATA ? path.win32.join(env.LOCALAPPDATA, 'Android', 'Sdk') : null;
    return path.posix.join(home, 'Android', 'Sdk');
}

// The JDK Android Studio bundles (jbr), on each OS's default install place.
function studioJbr({ platform, home, env })
{
    if (platform === 'darwin') return ['/Applications/Android Studio.app/Contents/jbr/Contents/Home', path.posix.join(home, 'Applications', 'Android Studio.app', 'Contents', 'jbr', 'Contents', 'Home')];
    if (platform === 'win32') return [env.ProgramFiles && path.win32.join(env.ProgramFiles, 'Android', 'Android Studio', 'jbr')].filter(Boolean);
    return ['/opt/android-studio/jbr', path.posix.join(home, 'android-studio', 'jbr')];
}

// macOS's own JDK lookup; '' when none is installed or the tool is absent.
function javaHomeTool()
{
    try { return require('node:child_process').execFileSync('/usr/libexec/java_home', [], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim(); }
    catch { return ''; }
}

// { value, from } for ANDROID_HOME: 'set' (the environment or a settings file), 'ANDROID_SDK_ROOT', 'default', or
// value '' when nothing was found.
function androidHome({ env = process.env, projectDir, platform = process.platform, home = os.homedir(), isDir = exists } = {})
{
    const own = settingFrom({ env, projectDir, key: 'ANDROID_HOME' });
    if (own) return { value: own, from: 'set' };
    const legacy = settingFrom({ env, projectDir, key: 'ANDROID_SDK_ROOT' });
    if (legacy) return { value: legacy, from: 'ANDROID_SDK_ROOT' };
    const place = defaultSdk({ platform, home, env });
    return place && isDir(place) ? { value: place, from: 'default' } : { value: '', from: null };
}

// { value, from } for JAVA_HOME: 'set', 'java_home' (macOS), 'studio' (Android Studio's JBR), or value ''.
function javaHome({ env = process.env, projectDir, platform = process.platform, home = os.homedir(), isDir = exists, tool = javaHomeTool } = {})
{
    const own = settingFrom({ env, projectDir, key: 'JAVA_HOME' });
    if (own) return { value: own, from: 'set' };
    if (platform === 'darwin')
    {
        const found = tool();
        if (found && isDir(found)) return { value: found, from: 'java_home' };
    }
    const jbr = studioJbr({ platform, home, env }).find((p) => isDir(p));
    return jbr ? { value: jbr, from: 'studio' } : { value: '', from: null };
}

// A safe default's value: the user's own where set (the shell or a settings file), else the default. A boolean the
// server would refuse to start on is said and the default kept.
function safeValue(key, { env, projectDir, log = () => {} })
{
    const own = settingFrom({ env, projectDir, key });
    if (!own) return DEFAULTS[key];
    if (BOOLEAN.has(key) && !/^(true|false)$/i.test(own))
    {
        log(`${key}=${own} is not true or false, which appium-mcp refuses to start on - using ${DEFAULTS[key]}`);
        return DEFAULTS[key];
    }
    return own;
}

// The environment the server starts with: the launcher's own, plus each value above. Output dirs are ABSOLUTE
// under the project's data root unless the user set their own.
function mobileEnv({ env = process.env, projectDir, platform = process.platform, home = os.homedir(), isDir = exists, tool = javaHomeTool, log = () => {} })
{
    const { root, source, why } = dataRoot.dataRootOf({ env, projectDir });
    if (source === 'invalid') log(`mobile-launch: ALFRED_CODE_DATA_PATH refused (${why}) - using ${root}`);
    const out = { ...env };
    const sdk = androidHome({ env, projectDir, platform, home, isDir });
    if (sdk.value) out.ANDROID_HOME = sdk.value;
    if (sdk.from && sdk.from !== 'set') log(`mobile-launch: ANDROID_HOME unset - using ${sdk.value} (${sdk.from === 'default' ? "Android Studio's default SDK place" : 'from ANDROID_SDK_ROOT'})`);
    if (!sdk.value) log('mobile-launch: no Android SDK found - Android needs ANDROID_HOME set where Claude Code starts (the shell, or a settings file\'s env); iOS works without it');
    const jdk = javaHome({ env, projectDir, platform, home, isDir, tool });
    if (jdk.value) out.JAVA_HOME = jdk.value;
    if (jdk.from && jdk.from !== 'set') log(`mobile-launch: JAVA_HOME unset - using ${jdk.value} (${jdk.from === 'studio' ? "Android Studio's bundled JDK" : 'macOS java_home'})`);
    if (!jdk.value) log('mobile-launch: no JDK found - Android needs JAVA_HOME set where Claude Code starts; iOS works without it');
    for (const key of Object.keys(DEFAULTS)) out[key] = safeValue(key, { env, projectDir, log: (line) => log(`mobile-launch: ${line}`) });
    const dir = path.join(projectDir, ...dataRoot.layout(root).mobile.split('/'));
    const screenshots = settingFrom({ env, projectDir, key: 'SCREENSHOTS_DIR' });
    const sources = settingFrom({ env, projectDir, key: 'PAGE_SOURCES_DIR' });
    out.SCREENSHOTS_DIR = screenshots || path.join(dir, 'screenshots');
    out.PAGE_SOURCES_DIR = sources || path.join(dir, 'page-sources');
    // What lands under the root (screens of the app, its page sources) stays out of git: the root's .gitignore first.
    if (!screenshots || !sources)
    {
        try { dataRoot.ensureRootIgnore({ projectDir, root, env }); }
        catch (err) { log(`mobile-launch: ${root}/.gitignore could not be written (${err.message}) - add ${root}/ to the repo's own .gitignore`); }
    }
    return out;
}

// PL4: the npm cut-off this start takes - `value` to set in the child env (null: leave the env as it is) and `own`, the
// user's setting that replaced the release's `before` (the shell's, in any case, wins - it is already in the env).
const NPM_BEFORE = 'npm_config_before';
function npmBefore({ env = process.env, projectDir, before = '' })
{
    const shell = Object.keys(env).find((k) => k.toLowerCase() === NPM_BEFORE);
    if (shell !== undefined) return { value: null, own: `${shell}=${env[shell]}`, registered: String(env[shell]) };
    const set = settingFrom({ env: { CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR }, projectDir, key: NPM_BEFORE });
    if (set) return { value: set, own: `${NPM_BEFORE}=${set}`, registered: set };
    return { value: before || null, own: '', registered: before || '' };
}

// The copy route's registration values, resolved at install: the same safe defaults (the user's own where set), the
// npm cut-off (the pin's own day, `before`, unless the user set one) and the output dirs RELATIVE to the project root,
// which is the server's cwd there (ROOT_BOOT).
function copyRouteEnv({ env = process.env, projectDir, root, before = '', log = () => {} })
{
    const dir = dataRoot.layout(root).mobile;
    const cut = npmBefore({ env, projectDir, before });
    if (cut.own) log(`${cut.own} is set - registered in place of the release's cut-off (${before || 'none'})`);
    return {
        MOBILE_BEFORE: cut.registered,
        MOBILE_NO_UI: safeValue('NO_UI', { env, projectDir, log }),
        MOBILE_REMOTE_APPS: safeValue('ALLOW_REMOTE_APP_URLS', { env, projectDir, log }),
        MOBILE_REMOTE_ALLOW: safeValue('REMOTE_SERVER_URL_ALLOW_REGEX', { env, projectDir, log }),
        MOBILE_SCREENSHOTS: `${dir}/screenshots`,
        MOBILE_PAGE_SOURCES: `${dir}/page-sources`,
    };
}

// What the server needs before its first start, said on the run that brings it in.
function prereqNotes({ env = process.env, projectDir, platform = process.platform, home = os.homedir(), node = process.versions.node, isDir = exists, tool = javaHomeTool, route = 'plugin', pin = null } = {})
{
    const major = Number.parseInt(String(node).split('.')[0], 10) || 0;
    const sdk = androidHome({ env, projectDir, platform, home, isDir });
    const jdk = javaHome({ env, projectDir, platform, home, isDir, tool });
    const lookup = route === 'plugin' ? ' (the launcher looks each up only when it is unset)' : '';
    const lines = [];
    if (major < NODE_FLOOR) lines.push(`  !! mobile: mobile-control needs Node ${NODE_FLOOR} or newer (appium-mcp's floor) - this machine runs ${node}; it will not start until Node is upgraded`);
    lines.push(`  mobile: mobile-control - Android needs the Android SDK (ANDROID_HOME: ${sdk.value || 'not found'}) and a JDK (JAVA_HOME: ${jdk.value || 'not found'})${lookup}, adb on PATH, and an emulator running or a device with USB debugging on`);
    lines.push(platform === 'darwin'
        ? '  mobile: mobile-control - iOS needs Xcode and its command line tools (xcode-select --install) and a booted simulator, or a real device in Developer Mode'
        : '  mobile: mobile-control - iOS needs macOS with Xcode; on this machine it drives Android only');
    lines.push('  mobile: mobile-control installs apps from a local path only and talks to a local Appium server only (ALLOW_REMOTE_APP_URLS, REMOTE_SERVER_URL_ALLOW_REGEX - set either where Claude Code starts to lift it); its first start downloads appium-mcp and its drivers, and a timeout then clears with a reconnect from /mcp');
    // the open npm advisories the pin refresh recorded on the row (scripts/refresh-mcp-pins.js; audit 2026-10-21 mcps T1-3)
    const adv = pin && pin.advisories;
    if (adv && (adv.critical || adv.high)) lines.push(`  !! mobile: appium-mcp ${pin.version} resolves ${adv.critical} critical and ${adv.high} high npm advisories its upstream has not fixed (npm audit, ${adv.checked}) - drive local apps on a trusted machine only`);
    if (!sdk.value || !jdk.value) lines.push('  !! mobile: set ANDROID_HOME and JAVA_HOME in the shell that starts Claude Code, or in .claude/settings.local.json `env` (machine-local) - a committed settings file would hand your paths to every teammate');
    return lines;
}

function main(argv, { env = process.env, node = process.versions.node } = {})
{
    const flag = (name) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] && argv[i + 1] !== '--' ? argv[i + 1] : null; };
    const spec = flag('--package');
    if (!spec)
    {
        process.stderr.write('mobile-launch: --package <spec> is required (the plugin entry passes it)\n');
        return 2;
    }
    const major = Number.parseInt(String(node).split('.')[0], 10) || 0;
    if (major < NODE_FLOOR)
    {
        process.stderr.write(`mobile-launch: appium-mcp needs Node ${NODE_FLOOR} or newer, and this Claude Code runs servers on Node ${node} - upgrade Node, then reconnect mobile-control from /mcp\n`);
        return 1;
    }
    const rest = argv.indexOf('--');
    const projectDir = require('../hooks/memory.js').projectRootOf(process.cwd()).checkout;
    const log = (line) => process.stderr.write(`${line}\n`);
    // The project's sensitive data first, so a key it holds (say ALLOW_REMOTE_APP_URLS) reads like one the shell set -
    // the keys appium-mcp documents only (DOCUMENTED).
    const sensitive = require('./data-root.js').withSensitive(env, { projectDir, only: DOCUMENTED });
    if (sensitive.count) log(`mobile-launch: ${sensitive.count} value(s) from the project's sensitive data in the environment (the keys appium-mcp documents)`);
    const childEnv = mobileEnv({ env: sensitive.env, projectDir, log });
    const cut = npmBefore({ env: childEnv, projectDir, before: flag('--before') || '' });
    if (cut.value) childEnv[NPM_BEFORE] = cut.value;
    if (cut.own) log(`mobile-launch: ${cut.own} is set - npx takes it in place of the release's cut-off (${flag('--before') || 'none'})`);
    log(`mobile-launch: ${spec}${cut.value ? `, dependencies published by ${cut.value}` : ''}, output under ${path.dirname(childEnv.SCREENSHOTS_DIR)}`);
    const { spawnCommandAsync } = require('../../scripts/install/runtime.js');
    const child = spawnCommandAsync('npx', ['-y', spec, ...(rest < 0 ? [] : argv.slice(rest + 1))], { stdio: 'inherit', env: childEnv, cwd: projectDir });
    // A stop signal is passed on: Claude Code stops a server by signalling the process it started.
    const forward = (signal) => { try { child.kill(signal); } catch { /* already gone */ } };
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, forward);
    child.on('error', (err) => { process.stderr.write(`mobile-launch: could not start npx - ${err.message}\n`); process.exit(1); });
    child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
    return null;   // the process lives as long as the child does
}

if (require.main === module)
{
    const rc = main(process.argv.slice(2));
    if (rc !== null) process.exit(rc);
}
module.exports = { main, mobileEnv, copyRouteEnv, npmBefore, androidHome, javaHome, prereqNotes, DEFAULTS, DOCUMENTED, LOCAL_ONLY, NODE_FLOOR };
