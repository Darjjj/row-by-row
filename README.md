# Row by Row

A phone app for following pixel crochet patterns one row at a time. It's a plain web app (no build step) that installs to an Android home screen and works offline.

- Single crochet rows (right- or left-handed) or corner to corner (C2C, bottom right to top left)
- Crochet mode: big color counts in stitching order, tap colors as you finish them, chart with the current row outlined, screen stays on
- Progress is saved on the phone, separately for each style
- New patterns from any picture: crop and zoom, size, number of colors, tidy stray squares, border, yarn names
- Sign in with Google to sync patterns, progress and notes between devices

## Tests
- `node tests/sync.test.js` (or `bun`): sync merge rules, including a behind phone never wiping progress
- `node tests/picture.test.js`: Monster Duo drawn as a picture must come back square for square
- `tests/phone-check.js`: headless Chrome at 375 px, light and dark; needs `puppeteer-core`, Chrome, and the local server running

## Files
- `pattern.js` turns a color grid into rows or C2C diagonals, and `verifySteps` rebuilds the chart from them as a check
- `builtin.js` holds the built-in pattern(s)
- `picture.js` turns a picture into a color grid (square averages, k-means color reduction in OKLab, color names)
- `app.js` / `style.css` are the screens
- `sw.js` keeps the files for offline use. **Bump `VERSION` in `sw.js` whenever you change a file.**

## Run locally
```
python -m http.server 5178
```
Then open http://localhost:5178.

## Install on Android
Open the hosted link in Chrome, tap the ⋮ menu, then **Add to Home screen** (or **Install app**).
