#!/usr/bin/env node
'use strict';
// THE MOBILE SERVER'S LAUNCHER - mobile-control (appium-mcp): drives Android and iOS apps on an emulator, a
// simulator or a real device through Appium's embedded UiAutomator2 and XCUITest drivers.
//
//   node mobile-launch.js --package appium-mcp@<ver> [-- <more server arguments>]
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

const exists = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// Where Android Studio puts the SDK on each OS (its default; the SDK Manager can move it).
function defaultSdk({ platform, home, env })
{
    if (platform === 'darwin') return path.join(home, 'Library', 'Android', 'sdk');
    if (platform === 'win32') return env.LOCALAPPDATA ? path.win32.join(env.LOCALAPPDATA, 'Android', 'Sdk') : null;
    return path.join(home, 'Android', 'Sdk');
}

// The JDK Android Studio bundles (jbr), on each OS's default install place.
function studioJbr({ platform, home, env })
{
    if (platform === 'darwin') return ['/Applications/Android Studio.app/Contents/jbr/Contents/Home', path.join(home, 'Applications', 'Android Studio.app', 'Contents', 'jbr', 'Contents', 'Home')];
    if (platform === 'win32') return [env.ProgramFiles && path.win32.join(env.ProgramFiles, 'Android', 'Android Studio', 'jbr')].filter(Boolean);
    return ['/opt/android-studio/jbr', path.join(home, 'android-studio', 'jbr')];
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

// The copy route's registration values, resolved at install: the same safe defaults (the user's own where set) and
// the output dirs RELATIVE to the project root, which is the server's cwd there (ROOT_BOOT).
function copyRouteEnv({ env = process.env, projectDir, root, log = () => {} })
{
    const dir = dataRoot.layout(root).mobile;
    return {
        MOBILE_NO_UI: safeValue('NO_UI', { env, projectDir, log }),
        MOBILE_REMOTE_APPS: safeValue('ALLOW_REMOTE_APP_URLS', { env, projectDir, log }),
        MOBILE_REMOTE_ALLOW: safeValue('REMOTE_SERVER_URL_ALLOW_REGEX', { env, projectDir, log }),
        MOBILE_SCREENSHOTS: `${dir}/screenshots`,
        MOBILE_PAGE_SOURCES: `${dir}/page-sources`,
    };
}

// What the server needs before its first start, said on the run that brings it in.
function prereqNotes({ env = process.env, projectDir, platform = process.platform, home = os.homedir(), node = process.versions.node, isDir = exists, tool = javaHomeTool, route = 'plugin' } = {})
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
    const childEnv = mobileEnv({ env, projectDir, log });
    log(`mobile-launch: ${spec}, output under ${path.dirname(childEnv.SCREENSHOTS_DIR)}`);
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
module.exports = { main, mobileEnv, copyRouteEnv, androidHome, javaHome, prereqNotes, DEFAULTS, LOCAL_ONLY, NODE_FLOOR };
