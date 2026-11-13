// Reads a picture (raw RGBA) as cols x rows squares with the app's own reader, for tools/art_to_pattern.py.
// Usage: bun tools/read_grid.js <file.rgba> <width> <height> <cols> <rows> [max colors]   -> JSON { grid, colors }
const fs = require("fs"), vm = require("vm"), path = require("path");
const [file, w, h, cols, rows, k] = [process.argv[2], ...process.argv.slice(3).map(Number)];
const ctx = { module: undefined, console }; vm.createContext(ctx);
for (const f of ["builtin.js", "picture.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), ctx);
ctx.px = new Uint8ClampedArray(fs.readFileSync(file));
ctx.args = { w, h, cols, rows, k: k || 10 };
const out = vm.runInContext("readChart(px, args.w, { x0: 0, x1: args.w, y0: 0, y1: args.h, cols: args.cols, rows: args.rows }, args.k)", ctx);
process.stdout.write(JSON.stringify({ grid: out.grid, colors: out.colors }));
