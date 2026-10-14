'use strict';
// THE MOBILE SERVER, END TO END. mobile-control (appium-mcp) drives Android and iOS apps; it runs on every OS, is
// seeded by no stack and is opt-in (the manifest row is `active: false`). The plugin route starts it through
// stack/mcp/mobile-launch.js; the copy route registers the same safe defaults and output dirs, and never an SDK path.
// The run that brings it in says its prerequisites once.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const { LOCAL_ONLY } = require('../stack/mcp/mobile-launch.js');

const row = (id, extra = {}) => ({ id, version: '2.0.0', scope: 'project', enabled: true, ...extra });
const INSTALLED = (...more) => JSON.stringify([...['alfred-code', 'alfred-navigation', 'alfred-documentation', 'alfred-memory'].map((n) => row(`${n}@envoydev`)), ...more]);
const installs = (calls, name) => calls.filter((c) => c.startsWith(`plugin install ${name}@`));
const COPY = { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' };
const SEL = 'skill markdown-style\nmcp mobile-control\n';
const PIN = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'mcp-pins.json'), 'utf8')).pins['mobile-control'].version;
const DAY = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'mcp-pins.json'), 'utf8')).pins['mobile-control'].refreshed;
const said = (out) => (out.match(/^(==> )?\s*(!! )?mobile: .*$/gm) || []);

test('seed install: a selection naming mobile-control installs its plugin on any OS and says its prerequisites once', POSIX_ONLY, () =>
{
    for (const platform of ['linux', 'darwin', 'win32'])
    {
        const { calls, out } = seedRun('install', SEL, { env: { ALFRED_CODE_PLATFORM: platform } });
        assert.deepStrictEqual(installs(calls, 'mobile-control'), ['plugin install mobile-control@envoydev --scope project -y'], `${platform}:\n${calls.join('\n')}`);
        assert.match(out, /mobile: mobile-control - Android needs the Android SDK \(ANDROID_HOME: /, out);
        assert.match(out, /installs apps from a local path only and talks to a local Appium server only/);
        assert.ok(!/left out/.test(out), out);
    }
});

test('seed install: a selection without it installs no mobile server and says nothing of it', POSIX_ONLY, () =>
{
    const { calls, out } = seedRun('install', 'skill markdown-style\n');
    assert.deepStrictEqual(installs(calls, 'mobile-control'), []);
    assert.deepStrictEqual(said(out), []);
});

test('seed update --add mcp mobile-control installs it and says the prerequisites; an update that keeps it says them no second time', POSIX_ONLY, () =>
{
    const added = seedRun('update', 'skill markdown-style\n', { plugins: INSTALLED(), args: ['--installed-only', '--add', 'mcp mobile-control'] });
    assert.deepStrictEqual(installs(added.calls, 'mobile-control'), ['plugin install mobile-control@envoydev --scope project -y'], added.calls.join('\n'));
    assert.ok(said(added.out).length >= 3, added.out);
    const kept = seedRun('update', SEL, { plugins: INSTALLED(row('mobile-control@envoydev')), args: ['--installed-only'] });
    assert.ok(kept.calls.includes('plugin update mobile-control@envoydev --scope project -y'), kept.calls.join('\n'));
    assert.ok(!kept.calls.some((c) => /^plugin (uninstall|disable) mobile-control@/.test(c)), kept.calls.join('\n'));
    assert.deepStrictEqual(said(kept.out), [], 'the prerequisites were said again on an update that brought nothing in');
});

test('seed install (full copy route): the registration carries the pin, the safe defaults and the output dirs - no SDK path; a re-run repairs nothing', POSIX_ONLY, () =>
{
    const { steps, outs } = seedRun(['install', 'update'], SEL, {
        env: COPY, account: true, args: [[], ['--installed-only']],
        prepare: (repo) => { fs.mkdirSync(path.join(repo, '.claude'), { recursive: true }); fs.writeFileSync(path.join(repo, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALLOW_REMOTE_APP_URLS: 'true', ANDROID_HOME: '/my/sdk' } })); },
        each: (repo) => (JSON.parse(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8')).mcpServers || {})['mobile-control'] || null,
    });
    const reg = steps[0];
    assert.ok(reg, outs[0]);
    assert.deepStrictEqual(reg.args.slice(-3), ['npx', '-y', `appium-mcp@${PIN}`], JSON.stringify(reg));
    assert.deepStrictEqual(reg.env, {
        NO_UI: 'true', ALLOW_REMOTE_APP_URLS: 'true', REMOTE_SERVER_URL_ALLOW_REGEX: LOCAL_ONLY,
        SCREENSHOTS_DIR: '.alfred/mobile-control/screenshots', PAGE_SOURCES_DIR: '.alfred/mobile-control/page-sources',
        npm_config_before: `${DAY}T23:59:59Z`,
    }, 'the user\'s own ALLOW_REMOTE_APP_URLS is taken; their SDK path never enters the committed file; PL4: the pin\'s own cut-off day');
    assert.ok(reg.args.includes('checkout'), 'the server starts at the checkout root, so the relative dirs resolve there');
    assert.deepStrictEqual(steps[1], reg, 'the update keeps the registration as it is');
    assert.doesNotMatch(outs[1], /mcp repaired: mobile-control/, outs[1]);
    assert.match(outs[0], /mobile: mobile-control - Android needs .*ANDROID_HOME: \/my\/sdk/, 'the note reads the settings file the server will inherit');
    assert.deepStrictEqual(said(outs[1]), [], 'said once');
});

test('seed update onto the full copy route: a mobile-control plugin row goes the engine way before its registration', POSIX_ONLY, () =>
{
    const { calls, result, out } = seedRun('update', 'skill markdown-style\n', {
        env: COPY, account: true, plugins: INSTALLED(row('mobile-control@envoydev')), args: ['--installed-only', '--add', 'mcp mobile-control'],
        inspect: (repo) => Boolean((JSON.parse(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8')).mcpServers || {})['mobile-control']),
    });
    assert.ok(calls.includes('plugin uninstall mobile-control@envoydev --scope project -y'), calls.join('\n'));
    assert.strictEqual(result, true, `the copy route registered it:\n${out}`);
    const gone = calls.indexOf('plugin uninstall mobile-control@envoydev --scope project -y');
    assert.ok(calls.findIndex((c) => /^mcp add .*mobile-control/.test(c)) > gone, `registered before its plugin row went:\n${calls.join('\n')}`);
});

// Found by the temp-project matrix: a value appium-mcp refuses to start on was replaced by the default on the copy route
// without a word - the install now says it, once, where it takes the default.
test('seed install (full copy route): ALLOW_REMOTE_APP_URLS=yes is said and registered as the default', POSIX_ONLY, () =>
{
    const { result, out } = seedRun('install', SEL, {
        env: COPY, account: true,
        prepare: (repo) => { fs.mkdirSync(path.join(repo, '.claude'), { recursive: true }); fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), JSON.stringify({ env: { ALLOW_REMOTE_APP_URLS: 'yes' } })); },
        inspect: (repo) => (JSON.parse(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8')).mcpServers || {})['mobile-control'],
    });
    assert.strictEqual(result.env.ALLOW_REMOTE_APP_URLS, 'false');
    assert.strictEqual((out.match(/mobile: ALLOW_REMOTE_APP_URLS=yes is not true or false, which appium-mcp refuses to start on - using false/g) || []).length, 1, out);
});
