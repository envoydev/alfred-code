'use strict';
const fs = require('node:fs');
const rt = require('../install/runtime.js');
const { tsServerState } = require('./find.js');
const { SERVER_PACKAGE } = require('./constants.js');

const fileSeams = {
    realpath: (p) => { try { return fs.realpathSync(p); } catch { return ''; } },
    readName: (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')).name || ''; } catch { return ''; } },
    exists: (p) => fs.existsSync(p),
    resolveFrom: (name, dir) => { try { return require.resolve(name, { paths: [dir] }); } catch { return ''; } },
};

// The state of the typescript-language-server on this PATH: 'ok', 'missing' (no tsserver.js beside it) or 'unknown'.
function probeTsServer(env = process.env)
{
    return tsServerState(rt.locate(SERVER_PACKAGE, { env }), fileSeams);
}

module.exports = { probeTsServer };
