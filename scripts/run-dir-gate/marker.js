'use strict';
// The run marker's file name, worked out the way the resolve block works it out in shell.
const crypto = require('node:crypto');

const MARKER_PREFIX = 'alfred-code-run.';
const MARKER_SUFFIX = '.path';
const SANITIZED_LENGTH = 60;
const HASH_LENGTH = 12;

// What `git hash-object --stdin` prints for a text: the SHA-1 of 'blob <bytes>', a NUL, then the bytes.
function gitBlobSha1(text)
{
    const body = Buffer.from(String(text), 'utf8');
    return crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${body.length}\0`), body])).digest('hex');
}

function markerName(root)
{
    const sanitized = Array.from(String(root), (ch) => (/[A-Za-z0-9]/.test(ch) ? ch : '-')).slice(0, SANITIZED_LENGTH).join('');
    return `${MARKER_PREFIX}${sanitized}-${gitBlobSha1(root).slice(0, HASH_LENGTH)}${MARKER_SUFFIX}`;
}

module.exports = { gitBlobSha1, markerName };
