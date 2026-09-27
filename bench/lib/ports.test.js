'use strict';
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const { reservePort, releasePort } = require('./ports.js');

const bindable = (port) => new Promise((resolve) =>
{
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '0.0.0.0', () => server.close(() => resolve(true)));
});

test('a reserved port is free to bind on every interface, the way docker publishes a database', async () =>
{
    const port = await reservePort();
    try
    {
        assert.ok(Number.isInteger(port) && port > 1024 && port < 65536, `${port} is an unprivileged port`);
        assert.ok(await bindable(port), `${port} binds on 0.0.0.0`);
    }
    finally { releasePort(port); }
});

test('cells starting together never get the same port, and a released one can be handed out again', async () =>
{
    const ports = await Promise.all(Array.from({ length: 8 }, () => reservePort()));
    try { assert.strictEqual(new Set(ports).size, 8, `distinct: ${ports.join(', ')}`); }
    finally { ports.forEach(releasePort); }
});

test('a port something else holds is skipped', async () =>
{
    const held = net.createServer();
    await new Promise((resolve) => held.listen(0, '0.0.0.0', resolve));
    const busy = held.address().port;
    try
    {
        const port = await reservePort({ candidates: [busy] });
        try { assert.notStrictEqual(port, busy); }
        finally { releasePort(port); }
    }
    finally { await new Promise((resolve) => held.close(resolve)); }
});
