"""Read the notes sent from the Row by Row app.

When she's signed in and taps Send, each note is marked via "inbox" and travels with her synced data
(Firestore users/{uid}/state/main, field notes). This reads every person's notes marked that way.

Uses a read-only service account key (role: Cloud Datastore Viewer) that lives OUTSIDE the repo:
  %USERPROFILE%\\.row-by-row\\feedback-reader.json   (or set RBR_FEEDBACK_KEY to another path)
A local copy of every note seen is kept next to it (feedback-seen.json), so a note deleted in the app later isn't lost.
Pictures sent with a note (users/{uid}/attachments/{id}) are saved next to it too, in feedback-pictures/, and listed under the note.

  python tools/read_feedback.py          new notes since the last run (and marks them seen)
  python tools/read_feedback.py --all    every note ever seen
  python tools/read_feedback.py --peek   new notes, without marking them seen

Needs: pip install google-auth requests
"""
import base64, datetime, json, os, sys

from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account

PROJECT = "row-by-row"
KEY = os.environ.get("RBR_FEEDBACK_KEY", os.path.join(os.path.expanduser("~"), ".row-by-row", "feedback-reader.json"))
SEEN = os.path.join(os.path.dirname(KEY), "feedback-seen.json")
DOCS = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"
QUERY = DOCS + ":runQuery"
PICS = os.path.join(os.path.dirname(KEY), "feedback-pictures")


def decode(v):
    """Firestore REST value -> plain Python."""
    if "mapValue" in v: return {k: decode(x) for k, x in v["mapValue"].get("fields", {}).items()}
    if "arrayValue" in v: return [decode(x) for x in v["arrayValue"].get("values", [])]
    if "integerValue" in v: return int(v["integerValue"])
    for k in ("stringValue", "doubleValue", "booleanValue", "timestampValue"):
        if k in v: return v[k]
    return None


def fetch():
    """Every note marked for the inbox, from every person's synced data, keyed '<uid>/<note id>'."""
    creds = service_account.Credentials.from_service_account_file(KEY, scopes=["https://www.googleapis.com/auth/datastore"])
    body = {"structuredQuery": {"from": [{"collectionId": "state", "allDescendants": True}]}}
    global SESSION
    SESSION = AuthorizedSession(creds)
    r = SESSION.post(QUERY, json=body, timeout=30)
    r.raise_for_status()
    notes = {}
    for row in r.json():
        doc = row.get("document")
        if not doc: continue
        uid = doc["name"].split("/users/")[1].split("/")[0]
        fields = {k: decode(v) for k, v in doc.get("fields", {}).items()}
        for nid, n in (fields.get("notes") or {}).items():
            if isinstance(n, dict) and n.get("via") == "inbox" and not n.get("deleted") and n.get("text"):
                notes[f"{uid}/{nid}"] = n
    return notes


def pictures(key, n):
    """Save the note's pictures (once) and return their local paths, or a word on any not arrived yet."""
    uid, nid = key.split("/")
    out = []
    for a in n.get("atts") or []:
        aid = str(a.get("id", ""))
        if not aid.isalnum(): continue
        path = os.path.join(PICS, f"{nid}-{a.get('kind', 'picture')}-{aid}.jpg")
        if not os.path.exists(path):
            r = SESSION.get(f"{DOCS}/users/{uid}/attachments/{aid}", timeout=30)
            if r.status_code == 404:
                out.append(f"({a.get('kind', 'picture')}: not arrived yet)"); continue
            r.raise_for_status()
            url = decode(r.json().get("fields", {}).get("data", {})) or ""
            if not url.startswith("data:image/jpeg;base64,"): continue
            os.makedirs(PICS, exist_ok=True)
            open(path, "wb").write(base64.b64decode(url.split(",", 1)[1]))
        out.append(path)
    return out


def device(ua):
    ua = ua or ""
    if "iPhone" in ua: return "iPhone"
    if "iPad" in ua: return "iPad"
    if "Android" in ua:
        bits = [b.strip() for b in ua.split("Android", 1)[1].split(")")[0].split(";")]
        return "Android " + " ".join(b for b in bits if b and b != "K")
    return ua[:60] or "unknown device"


def main():
    if not os.path.exists(KEY):
        sys.exit(f"No key at {KEY}. See the setup steps in HANDOFF.md.")
    seen = json.load(open(SEEN, encoding="utf-8")) if os.path.exists(SEEN) else {}
    live = fetch()
    new = {k: n for k, n in live.items() if k not in seen}
    everything = {**seen, **live}
    show = everything if "--all" in sys.argv else new
    for k, n in sorted(show.items(), key=lambda kv: kv[1].get("at") or 0):
        when = datetime.datetime.fromtimestamp((n.get("at") or 0) / 1000).strftime("%a %b %d %Y, %I:%M %p")
        print(f"--- {when} · {n.get('from') or k.split('/')[0]} · {device(n.get('device'))}{'' if k in live else ' · (deleted in the app since)'}")
        if n.get("where"): print(f"    where: {n['where']}")
        print("    " + n["text"].replace("\n", "\n    "))
        for p in (pictures(k, n) if k in live else []): print(f"    picture: {p}")
    if not show:
        print("No new notes." if everything else "The inbox is empty.")
    if "--peek" not in sys.argv:
        os.makedirs(os.path.dirname(SEEN), exist_ok=True)
        json.dump(everything, open(SEEN, "w", encoding="utf-8"), indent=1)
    print(f"\n{len(show)} shown, {len(new)} new, {len(everything)} in total.")


if __name__ == "__main__":
    main()
