# Row by Row

A phone app for following pixel crochet patterns one row at a time. It's a plain web app (no build step) that installs to an Android home screen and works offline.

- Single crochet rows (right- or left-handed) or corner to corner (C2C, bottom right to top left)
- Crochet mode: big color counts in stitching order, tap colors as you finish them, chart with the current row outlined, screen stays on
- Progress is saved on the phone, separately for each style
- New patterns from ready-made charts (grid found, checked and lined up automatically, then read square by square) or pixel art (sized to its blocks), with up to 10 colors, a border and yarn names. Real photos are turned away: they come out as blobs with too many colors
- Fix squares and colors on her own patterns: paint or fill squares, combine two colors, change a shade, rename yarns, add a color (up to 10), undo
- Sign in with Google to sync patterns, progress and notes between devices
- Notes and ideas: signed in, Send delivers them to a feedback inbox (`tools/read_feedback.py` reads it with a read-only key); signed out, the phone's share menu

## Tests
- `node tests/sync.test.js` (or `bun`): sync merge rules, including a behind phone never wiping progress
- `node tests/picture.test.js`: Monster Duo drawn as pixel art must come back square for square; the grid self-check corrects a broken grid
- `node tests/chart.test.js`: the real Monster Duo chart image (export it first with `python tests/export-chart.py`), synthetic charts, pixel art, and a photo that must not be taken for a chart
- `tests/phone-check.js <chart.jpg> <photo.jpg> [transparent.png] [uneven.png]`: headless Chrome at 375 px, light and dark, plus failed saves, renames during redraws, offline via the service worker; make the last two images with `python tests/make-test-images.py <folder>`. Needs `puppeteer-core`, Chrome, and the local server running

## Files
- `pattern.js` turns a color grid into rows or C2C diagonals, and `verifySteps` rebuilds the chart from them as a check
- `builtin.js` holds the built-in pattern(s)
- `picture.js` finds a chart's grid (or pixel art's block size), checks and corrects it, reads each square, and combines colors (OKLab)
- `app.js` / `style.css` are the screens
- `sw.js` keeps the files for offline use. **Bump `VERSION` in `sw.js` whenever you change a file.**

## Run locally
```
python -m http.server 5178
```
Then open http://localhost:5178.

## Install on Android
Open the hosted link in Chrome, tap the ⋮ menu, then **Add to Home screen** (or **Install app**).
