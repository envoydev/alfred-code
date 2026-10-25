<!-- planted: none -->
# pick-strong

## TASK

Build a small tool to track watering for the office plants. It must work with no internet - it runs on a Raspberry Pi in the office - one person maintains it, and the UI library is my call later.

## DRAFT

Two architectures fit an offline tool one person keeps on a Raspberry Pi.

- **A - one Node process with a SQLite file** - Node LTS serving plain HTML pages and a small JSON API, the data in one SQLite file on the Pi. What decides it: one language end to end - the server and the pages the UI library will later drive are both JavaScript, so the UI choice adds no second language.
- **B - Python with Flask and SQLite** - the same shape in Python. What decides it: Python ships on Raspberry Pi OS, so nothing to install. Its cost: the pages the UI library drives are JavaScript, so the tool runs on two languages.

Constraints: no internet - both run entirely on the Pi, no cloud service or CDN; one maintainer - A and B are each a single process and a single file; the UI library - left open in both: the pages stay plain HTML until you choose one.

What A gives up: B's zero-install start on Raspberry Pi OS - A needs Node installed once.

```ask
Two architectures fit an offline plant-watering tool on the office Raspberry Pi. Which one?
- 'One Node process with a SQLite file (Recommended)' - Node LTS and one SQLite file; one language for the server and the pages, works offline
- 'Python with Flask and SQLite' - ships with Raspberry Pi OS, nothing to install; a second language to maintain
```
