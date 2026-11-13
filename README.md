# Row by Row

A phone app for following pixel crochet patterns one row at a time. It's a plain web app (no build step) that installs to an Android home screen and works offline.

- Single crochet rows (right- or left-handed) or corner to corner (C2C, bottom right to top left)
- Crochet mode: big color counts in stitching order, tap colors as you finish them, chart with the current row outlined, screen stays on
- Progress is saved on the phone, separately for each style
- New patterns from a ready-made chart (grid found automatically and read square by square) or from any picture (crop and zoom, size, number of colors, tidy stray squares), with border and yarn names
- Fix squares and colors on her own patterns: paint or fill squares, combine two colors, change a shade, rename yarns, add a color (up to 10), undo
- Sign in with Google to sync patterns, progress and notes between devices
- Notes and ideas: signed in, Send delivers them to a feedback inbox (`tools/read_feedback.py` reads it with a read-only key); signed out, the phone's share menu

## Tests
- `node tests/sync.test.js` (or `bun`): sync merge rules, including a behind phone never wiping progress
- `node tests/picture.test.js`: Monster Duo drawn as a picture must come back square for square
- `node tests/chart.test.js`: the real Monster Duo chart image (export it first with `python tests/export-chart.py`), synthetic charts, pixel art, and a photo that must not be taken for a chart
- `tests/phone-check.js <chart.jpg> <photo.jpg> [transparent.png]`: headless Chrome at 375 px, light and dark, plus failed saves, renames during redraws, offline via the service worker; make the third image with `python tests/make-transparent.py out.png`. Needs `puppeteer-core`, Chrome, and the local server running

## Files
- `pattern.js` turns a color grid into rows or C2C diagonals, and `verifySteps` rebuilds the chart from them as a check
- `builtin.js` holds the built-in pattern(s)
- `picture.js` turns a picture into a color grid (square averages, k-means color reduction in OKLab, color names) and finds and reads chart grids
- `app.js` / `style.css` are the screens
- `sw.js` keeps the files for offline use. **Bump `VERSION` in `sw.js` whenever you change a file.**

## Run locally
```
python -m http.server 5178
```
Then open http://localhost:5178.

## Install on Android
Open the hosted link in Chrome, tap the ⋮ menu, then **Add to Home screen** (or **Install app**).
