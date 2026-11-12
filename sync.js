// Sync between devices with Firebase (Google sign-in + Firestore).
// Each signed-in person has one document: users/{uid}/state/main = { progress, prefs, notes }.
// Every entry carries t (when it last changed); the newest copy of each entry wins.
"use strict";
(function () {
  const CONFIG = {
    apiKey: "AIzaSyC7lLOoOmnFAzXloCHhqgx5GpUlR2Mf2_s",
    authDomain: "row-by-row.firebaseapp.com",
    projectId: "row-by-row",
    storageBucket: "row-by-row.firebasestorage.app",
    messagingSenderId: "155203374991",
    appId: "1:155203374991:web:59ff3c078e911e6ce9c5fa"
  };
  const SDK = "https://www.gstatic.com/firebasejs/10.12.2/firebase-";
  let auth, db, docRef = null, unsub = null, pushTimer = null, retryTimer = null, retryDelay = 10000;
  const state = { user: null, status: "loading", message: "" };
  window.syncState = () => state;
  const changed = remote => window.RBR.onSyncChange(remote);

  // ----- merge rules (pure, also used by the tests) -----
  const DEF = { progress: '{"step":0,"inrow":0}', prefs: '{"mode":"rows","hand":"right"}' };
  const strip = o => { const { t, ...rest } = o; return JSON.stringify(rest); };
  // Entries saved before syncing existed have no t: count them as very old (1), or 0 if untouched.
  const tOf = (o, sec) => o.t || (DEF[sec] === strip(o) ? 0 : 1);
  function newer(a, b, sec) {          // > 0 when a should win over b
    const ta = tOf(a, sec), tb = tOf(b, sec);
    if (ta !== tb) return ta - tb;
    if (sec === "progress" && ta <= 1) return (a.step || 0) - (b.step || 0);   // two old copies: keep the further one
    return 0;
  }
  function mergeRemote(data, remote) {   // copy newer remote entries into data; returns true if anything changed
    let any = false;
    for (const sec of ["progress", "prefs"]) {
      const r = remote[sec] || {};
      data[sec] = data[sec] || {};
      for (const k in r) if (!data[sec][k] || newer(r[k], data[sec][k], sec) > 0) { data[sec][k] = r[k]; any = true; }
    }
    const rn = remote.notes || {};
    data.notes = data.notes || [];
    for (const id in rn) {
      const i = data.notes.findIndex(n => String(n.id) === id);
      if (i < 0) { data.notes.push(rn[id]); any = true; }
      else if (newer(rn[id], data.notes[i], "notes") > 0) { data.notes[i] = rn[id]; any = true; }
    }
    if (any) data.notes.sort((a, b) => a.id - b.id);
    return any;
  }
  function needsPush(data, remote) {     // true if this device has something newer than the cloud
    for (const sec of ["progress", "prefs"]) for (const k in data[sec] || {}) {
      const r = (remote[sec] || {})[k], l = data[sec][k];
      if (r ? newer(l, r, sec) > 0 : tOf(l, sec) > 0) return true;
    }
    for (const n of data.notes || []) {
      const r = (remote.notes || {})[String(n.id)];
      if (!r || newer(n, r, "notes") > 0) return true;
    }
    return false;
  }
  function toCloud(data) {
    const notes = {}; (data.notes || []).forEach(n => notes[String(n.id)] = n);
    return JSON.parse(JSON.stringify({ progress: data.progress || {}, prefs: data.prefs || {}, notes }));
  }
  window.syncMergeRules = { mergeRemote, needsPush, toCloud };

  // ----- messages -----
  function explain(e) {
    const c = (e && e.code) || "";
    if (/popup-closed|cancelled-popup|user-cancelled/.test(c)) return "Sign-in was cancelled.";
    if (/network-request-failed|unavailable/.test(c)) return "No internet connection. Try again when you're online.";
    if (/unauthorized-domain/.test(c)) return "Sync isn't allowed on this site yet (Firebase: add darjjj.github.io to Authorized domains).";
    if (/operation-not-allowed|configuration-not-found/.test(c)) return "Google sign-in isn't turned on yet (Firebase: Authentication, Google, Enable).";
    if (/permission-denied/.test(c)) return "Signed in, but the sync database rules aren't set up yet.";
    if (/not-found|failed-precondition/.test(c)) return "The sync database isn't set up yet (Firebase: create the Firestore database).";
    return "Something went wrong with syncing. Your place is still saved on this device.";
  }
  function fail(e) { state.status = "error"; state.message = explain(e); console.warn("sync:", e && (e.code || e.message)); changed(false); }

  // ----- syncing -----
  function push() {
    if (!docRef) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      state.status = "saving";
      docRef.set(toCloud(window.RBR.getData()), { merge: true }).catch(e => { fail(e); retryLater(); });
    }, 600);
  }
  window.syncPush = () => { if (docRef) push(); };

  function start(user) {
    stop();
    docRef = db.doc(`users/${user.uid}/state/main`);
    state.status = "connecting"; state.message = ""; changed(false);
    unsub = docRef.onSnapshot({ includeMetadataChanges: true }, snap => {
      const data = window.RBR.getData();
      const remote = snap.exists ? snap.data() : {};
      const any = mergeRemote(data, remote);
      if (any) { window.RBR.resnap(); window.RBR.persist(); }   // store what arrived, without counting it as a new change
      if (needsPush(data, remote)) push();
      const was = state.status;
      state.status = snap.metadata.fromCache ? "offline" : snap.metadata.hasPendingWrites ? "saving" : "synced";
      if (state.status !== "error") state.message = "";
      retryDelay = 10000;
      if (any || was !== state.status) changed(any);
    }, e => { fail(e); retryLater(); });
  }
  // Keep trying quietly after an error (no internet, setup not finished yet...), waiting longer each time.
  function retryLater() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { const u = auth && auth.currentUser; if (u) start(u); }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 120000);
  }
  document.addEventListener("visibilitychange", () => {
    const u = auth && auth.currentUser;
    if (document.visibilityState === "visible" && u && state.status === "error") { retryDelay = 10000; start(u); }
  });
  function stop() { if (unsub) unsub(); unsub = null; docRef = null; clearTimeout(pushTimer); clearTimeout(retryTimer); }

  window.syncSignIn = async () => {
    if (!auth) return;
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    state.status = "connecting"; state.message = ""; changed(false);
    try { await auth.signInWithPopup(provider); }
    catch (e) {
      if (/popup-blocked|operation-not-supported/.test(e.code || "")) {
        try { return await auth.signInWithRedirect(provider); } catch (e2) { return fail(e2); }
      }
      state.status = "off"; state.message = explain(e); changed(false);
    }
  };
  window.syncSignOut = async () => { stop(); try { await auth.signOut(); } catch (e) {} };

  // ----- load Firebase after the app is on screen; the app works fine without it -----
  const load = src => new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
  async function init() {
    try { for (const m of ["app", "auth", "firestore"]) await load(`${SDK}${m}-compat.js`); }
    catch (e) { state.status = "unavailable"; return changed(false); }
    firebase.initializeApp(CONFIG);
    auth = firebase.auth(); db = firebase.firestore();
    auth.getRedirectResult().catch(e => { state.message = explain(e); });
    auth.onAuthStateChanged(user => {
      state.user = user ? { email: user.email, uid: user.uid } : null;
      if (user) start(user); else { stop(); if (state.status !== "error") state.status = "off"; changed(false); }
    });
  }
  if (!window.SYNC_DISABLED) init();
})();
