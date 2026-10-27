<!-- planted: ignores a stated constraint - the recommended option needs the internet (Firebase), and the brief says it must work with none -->
# pick-ignores-constraint

## TASK

Build a small tool to track watering for the office plants. It must work with no internet - it runs on a Raspberry Pi in the office - one person maintains it, and the UI library is my call later.

## DRAFT

Two architectures fit a small plant-watering tracker.

- **A - a web app on Firebase** - Firebase Hosting and Firestore, the Pi only opens the page. What decides it: no server to maintain at all, and the data is backed up for you.
- **B - one Node process with a SQLite file** - Node LTS and one SQLite file on the Pi. What decides it: everything stays in the office.

Constraints: one maintainer - A has no server to keep; the UI library - left open in both.

What A gives up: running anything on the Pi itself.

```ask
Two architectures fit the plant-watering tracker. Which one?
- 'A web app on Firebase (Recommended)' - no server to maintain, backups included
- 'One Node process with a SQLite file' - everything stays on the Pi
```
