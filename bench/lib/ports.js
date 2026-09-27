'use strict';
// A free TCP port per cell, for the database its session may start: a compose project per cell still published
// every cell's database on host port 5432, so two cells starting it at once collided. A port is free when it binds
// on every IPv4 interface (docker publishes there) and no live cell of this driver holds it; it stays reserved
// until the cell releases it, so parallel cells never share one.
const net = require('node:net');

const reserved = new Set();

const bindable = (port) => new Promise((resolve) =>
{
    const server = net.createServer();
    server.once('error', () => resolve(null));
    server.listen(port, '0.0.0.0', () =>
    {
        const got = server.address().port;
        server.close(() => resolve(got));
    });
});

// `candidates` are tried first (a test names a busy one); then the OS hands out a free port.
async function reservePort({ candidates = [], attempts = 20 } = {})
{
    for (const port of [...candidates, ...Array(attempts).fill(0)])
    {
        if (reserved.has(port)) continue;
        const got = await bindable(port);
        if (got === null || reserved.has(got)) continue;
        reserved.add(got);
        return got;
    }
    throw new Error('no free TCP port for the cell\'s database');
}

const releasePort = (port) => { reserved.delete(port); };

module.exports = { reservePort, releasePort };
