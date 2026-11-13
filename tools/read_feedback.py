"""Read the notes sent from the Row by Row app (Firestore collection "feedback").

Uses a read-only service account key that lives OUTSIDE the repo:
  %USERPROFILE%\\.row-by-row\\feedback-reader.json   (or set RBR_FEEDBACK_KEY to another path)

  python tools/read_feedback.py          new notes since the last run (and marks them seen)
  python tools/read_feedback.py --all    every note
  python tools/read_feedback.py --peek   new notes, without marking them seen

Needs: pip install google-auth requests
"""
import datetime, json, os, sys

from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account

PROJECT = "row-by-row"
KEY = os.environ.get("RBR_FEEDBACK_KEY", os.path.join(os.path.expanduser("~"), ".row-by-row", "feedback-reader.json"))
SEEN = os.path.join(os.path.dirname(KEY), "feedback-seen.json")
URL = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents/feedback"


def value(v):
    for k in ("stringValue", "integerValue", "doubleValue", "booleanValue"):
        if k in v:
            return int(v[k]) if k == "integerValue" else v[k]
    return None


def fetch():
    creds = service_account.Credentials.from_service_account_file(KEY, scopes=["https://www.googleapis.com/auth/datastore"])
    s, docs, token = AuthorizedSession(creds), [], None
    while True:
        r = s.get(URL, params={"pageSize": 300, **({"pageToken": token} if token else {})}, timeout=30)
        r.raise_for_status()
        body = r.json()
        for d in body.get("documents", []):
            f = {k: value(v) for k, v in d.get("fields", {}).items()}
            f["id"] = d["name"].rsplit("/", 1)[1]
            docs.append(f)
        token = body.get("nextPageToken")
        if not token:
            return sorted(docs, key=lambda f: f.get("at") or 0)


def device(ua):
    ua = ua or ""
    if "iPhone" in ua: return "iPhone"
    if "iPad" in ua: return "iPad"
    if "Android" in ua:
        part = ua.split("Android", 1)[1].split(")")[0]          # e.g. " 14; SM-S918B"
        bits = [b.strip() for b in part.split(";")]
        return "Android " + " ".join(b for b in bits if b and b != "K")
    return ua[:60]


def main():
    if not os.path.exists(KEY):
        sys.exit(f"No key at {KEY}. See the setup steps in HANDOFF.md.")
    seen = set(json.load(open(SEEN))) if os.path.exists(SEEN) else set()
    docs = fetch()
    show = docs if "--all" in sys.argv else [d for d in docs if d["id"] not in seen]
    if not show:
        print("No new notes." if docs else "The inbox is empty.")
    for d in show:
        when = datetime.datetime.fromtimestamp((d.get("at") or 0) / 1000).strftime("%a %b %d %Y, %I:%M %p")
        print(f"--- {when} · {d.get('email') or d.get('uid')} · {device(d.get('device'))}")
        if d.get("where"): print(f"    where: {d['where']}")
        print("    " + (d.get("text") or "").replace("\n", "\n    "))
    if "--peek" not in sys.argv:
        json.dump(sorted(seen | {d["id"] for d in docs}), open(SEEN, "w"))
    print(f"\n{len(show)} shown, {len(docs)} in the inbox.")


if __name__ == "__main__":
    main()
