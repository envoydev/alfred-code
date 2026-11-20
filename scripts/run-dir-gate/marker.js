'use strict';
// The run marker's file name, worked out the way the resolve block works it out in shell.
const crypto = require('node:crypto');
const { MARKER } = require('./constants.js');

// What `git hash-object --stdin` prints for a text: the SHA-1 of 'blob <bytes>', a NUL, then the bytes.
function gitBlobSha1(text)
{
    const body = Buffer.from(String(text), MARKER.textEncoding);
    return crypto.createHash(MARKER.hashAlgorithm).update(Buffer.concat([Buffer.from(`${MARKER.blobLabel} ${body.length}\0`), body])).digest(MARKER.digestEncoding);
}

function markerName(root)
{
    const sanitized = Array.from(String(root), (ch) => (MARKER.safeChar.test(ch) ? ch : MARKER.replacement)).slice(0, MARKER.sanitizedLength).join('');
    return `${MARKER.prefix}${sanitized}-${gitBlobSha1(root).slice(0, MARKER.hashLength)}${MARKER.suffix}`;
}

module.exports = { gitBlobSha1, markerName };
