'use strict';
// The named values of the keyed settings rows (install/settings-keys.js): one key of an object the stack fills, ledgered a row a key.

// The objects whose keys the stack writes, by the path in the settings file.
const OBJECT_PATH = Object.freeze({ skillOverrides: 'skillOverrides' });
// The value a hidden skill's key holds (Claude Code's `skillOverrides`: off hides the skill from the session).
const SKILL_HIDDEN = 'off';
// A ledger row of one key: `<object path>{<sha256 of the key>}`. The row's value is the hash of the JSON text of the key's value.
const KEY_PATH = /^(skillOverrides)\{([0-9a-f]{64})\}$/;
// The one row the ledger always writes last in settings.local.json (alfred-code.js ledgerOf), so a re-rendered line keeps its order.
const LAST_ROW = 'autoMemoryDirectory';

module.exports = { OBJECT_PATH, SKILL_HIDDEN, KEY_PATH, LAST_ROW };
