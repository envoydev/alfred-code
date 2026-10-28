<!-- planted: none -->
# pick-strong

## TASK

Build a small tool to track watering for the office plants. It must work with no internet - it runs on a Raspberry Pi in the office - one person maintains it, and the UI library is my call later.

## DRAFT

Two architectures fit an offline tool one person keeps on a Raspberry Pi.

- **A - a small server on the Pi** - one Node LTS process serving plain HTML pages and a small JSON API, the data in one SQLite file through Node's built-in `node:sqlite` module (still marked experimental), so no native driver is built on a machine with no internet. What decides it: anyone on the office network logs a watering from their own phone or laptop, and the one SQLite file is the whole backup.
- **B - no server, the data in the browser** - one plain HTML page opened in the Pi's own browser, the records in that browser's IndexedDB. What decides it: nothing is installed and no process runs. Its cost: the records live in one browser on one device, so nobody logs a watering from their phone, and clearing that browser's data loses them.

Constraints: no internet - both run entirely on the Pi, no cloud service or CDN, and A's one-time Node install comes from a USB copy of the Linux ARM tarball; one maintainer - A is one process and one file, B one file; the UI library - left open in both: the pages stay plain HTML until you choose one.

What A gives up: B's nothing-to-run start - A needs Node copied onto the Pi once and its one process kept running.

```ask
Two architectures fit an offline plant-watering tool on the office Raspberry Pi. Which one?
- 'A small server on the Pi (Recommended)' - one Node process and one SQLite file; anyone on the office network shares the records, works offline
- 'No server, the data in the browser' - one HTML page, nothing to install or run; the records stay in one browser on one device
```
