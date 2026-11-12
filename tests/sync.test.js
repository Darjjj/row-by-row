const fs = require("fs"); const vm = require("vm");
const ctx = { window: { SYNC_DISABLED: true }, document: { addEventListener() {} }, console };
vm.runInNewContext(fs.readFileSync(require("path").join(__dirname, "..", "sync.js"), "utf8"), ctx);
const { mergeRemote, toPush } = ctx.window.syncMergeRules;
let fails = 0; const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) fails++; };
const K = "monster-duo|rows|right";
const dev = (progress, prefs = {}) => ({ progress: { [K]: progress }, prefs, notes: [] });
const cloud = d => JSON.parse(JSON.stringify({ progress: d.progress, prefs: d.prefs, notes: {} }));

// Her case: phone A at row 31, phone B played with earlier (row 2, tapped more recently), B signs in.
let A = dev({ step: 30, inrow: 2, t: 1000 }), B = dev({ step: 1, inrow: 1, t: 5000 });
let c = cloud(A);
mergeRemote(B, c, true);
ok(B.progress[K].step === 30, "new phone joining takes the further place (row 31)");
ok(toPush(B, c) === null, "new phone sends nothing over the cloud's better place");
mergeRemote(A, cloud(dev({ step: 1, inrow: 1, t: 5000 })), false);
ok(A.progress[K].step === 30, "phone A keeps row 31 even if a behind copy arrives");

// Deliberate step back syncs: A at row 10 presses Previous -> row 9
A = dev({ step: 8, inrow: 0, back: 9000, t: 6000 }); B = dev({ step: 9, inrow: 0, t: 5000 });
mergeRemote(B, cloud(A), false);
ok(B.progress[K].step === 8, "Previous row on one phone moves the other phone back too");
A = dev({ step: 0, inrow: 0, back: 40003, t: 7000 }); B = dev({ step: 40, inrow: 3, t: 6000 });
mergeRemote(B, cloud(A), false);
ok(B.progress[K].step === 0, "Start over on one phone syncs");
A = dev({ step: 30, inrow: 0, t: 1000 }); B = dev({ step: 1, inrow: 0, back: 2000, t: 9000 });
mergeRemote(A, cloud(B), false);
ok(A.progress[K].step === 30, "stepping back on a phone that was behind can't wipe the other's place");
A = dev({ step: 12, inrow: 0, t: 9000 }); B = dev({ step: 8, inrow: 0, back: 9000, t: 6000 });
mergeRemote(A, cloud(B), false);
ok(A.progress[K].step === 12, "newer forward progress beats an older step back");
A = dev({ step: 5, inrow: 0, t: 2 }); B = dev({ step: 5, inrow: 0, t: 3 });
ok(mergeRemote(A, cloud(B), false) === true && toPush(A, cloud(B)) === null, "same place settles");

// Style choices: on first join the cloud's choice wins even if the new phone's is newer
A = dev({ step: 30, inrow: 0, t: 1 }, { "monster-duo": { mode: "rows", hand: "left", t: 100 } });
B = dev({ step: 0, inrow: 0 }, { "monster-duo": { mode: "c2c", hand: "right", t: 900 } });
c = cloud(A); mergeRemote(B, c, true);
ok(B.prefs["monster-duo"].hand === "left" && B.prefs["monster-duo"].mode === "rows", "joining phone adopts the cloud's style");
ok(toPush(B, c) === null, "joining phone doesn't push its old style");
B.prefs["monster-duo"] = { mode: "c2c", hand: "left", t: 1000 };
ok(toPush(B, c) && toPush(B, c).out.prefs["monster-duo"].mode === "c2c", "later style changes still sync");
B = dev({ step: 0, inrow: 0 }); ok(toPush(B, {}) === null, "fresh phone has nothing to send");
// Patterns: a new one syncs, a delete replaces it, a newer rename wins
const P = { id: "p1", name: "Cat", grid: ["AB"], colors: [], created: 1, t: 100 };
A = { progress: {}, prefs: {}, patterns: { p1: P }, notes: [] }; B = { progress: {}, prefs: {}, patterns: {}, notes: [] };
let push = toPush(A, {}); ok(push && push.out.patterns.p1.name === "Cat" && push.paths.some(p => p[0] === "patterns" && p[1] === "p1"), "new pattern is sent with its own path");
mergeRemote(B, push.out, true); ok(B.patterns.p1 && B.patterns.p1.grid[0] === "AB", "new pattern arrives on the other phone");
B.patterns.p1 = { deleted: true, t: 200 }; mergeRemote(A, { patterns: { p1: B.patterns.p1 } }, false); ok(A.patterns.p1.deleted, "delete syncs");
A.patterns.p1 = { ...P, name: "Kitty", t: 300 }; mergeRemote(B, { patterns: { p1: A.patterns.p1 } }, false); ok(B.patterns.p1.name === "Kitty", "newer version of a pattern wins");
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
