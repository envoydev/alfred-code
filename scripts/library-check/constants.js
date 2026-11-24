'use strict';
// The named values of the library check's layout rows (library-check/).

const ROW = Object.freeze({
    nativeMissing: 'native-rule-missing',
    nativeUnmarked: 'native-rule-unmarked',
    nativeUnpicked: 'native-rule-unpicked',
    linkMissing: 'link-missing',
    linkDangling: 'link-dangling',
    linkUnpicked: 'link-unpicked',
    seatDenyLeft: 'seat-deny-left',
    excludeDrift: 'exclude-drift',
    agentsSharedRepo: 'agents-shared-repo',
});

// A row that is a note: named in the output, never counted as a finding.
const NOTE_ROWS = new Set([ROW.nativeUnmarked, ROW.agentsSharedRepo]);

const KIND = Object.freeze({ skills: 'skills', agents: 'agents' });
const FILE = Object.freeze({ settings: 'settings.json', local: 'settings.local.json' });
const EXCLUDES_KEY = 'claudeMdExcludes';
const MARKDOWN_EXTENSION = /\.md$/;

const rulePath = (name) => `.claude/rules/${name}.md`;
const linkPath = (kind, name) => `.claude/${kind}/${name}`;
const settingsPath = (file) => `.claude/${file}`;

const WHY = Object.freeze({
    nativeMissing: 'a picked rule with no native file - Claude Code does not load it; /alfred-code:update writes it',
    nativeUnmarked: 'a file of yours stands in for the stack\'s rule of this name - kept, and the stack\'s text does not load here',
    nativeUnpicked: 'a native file of a rule this project no longer picks; /alfred-code:update removes it',
    linkMissing: 'a picked item with no link or recorded copy in .claude; /alfred-code:update links it',
    linkDangling: 'a link into the store whose target is gone; /alfred-code:update removes it',
    linkUnpicked: 'a link into the store for an item this project does not pick',
    seatDenyLeft: (seat, file) => `Agent(alfred-code:${seat}) in ${file} does nothing - seats are no plugin item now${file === FILE.local
        ? ', and a project-scope update removes it' : '; /alfred-code:update removes it'}`,
    excludeDrift: (missing, stale) => `claudeMdExcludes differs from the chain's: ${missing} missing, ${stale} the stack wrote that no longer apply; /alfred-code:update rewrites them`,
    agentsSharedRepo: (root) => `this folder has no repository of its own under ${root}, which links agents - a session here also lists that root's seats`,
});

module.exports = { ROW, NOTE_ROWS, KIND, FILE, EXCLUDES_KEY, MARKDOWN_EXTENSION, WHY, rulePath, linkPath, settingsPath };
