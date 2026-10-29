"""Turn the repository secret into a usable key file.

The secret is pasted by hand, so this copes with the two things that actually
go wrong in practice:

  * the outer braces get left behind, because the opening { sits on its own
    line and a drag-select starts below it. The content is otherwise the right
    key, so it is repaired rather than rejected.
  * the wrong JSON gets pasted entirely - usually the OAuth client secret, which
    is also a file from Google and is about a tenth the size.

It never prints the key, only the account it belongs to.
"""
import json
import os
import sys

raw = os.environ.get("KEY", "").strip()
out = os.environ.get("GITHUB_OUTPUT")


def note(line):
    if out:
        with open(out, "a") as handle:
            handle.write(line + "\n")


if not raw:
    note("ok=false")
    print("No key in the repository secret, so there is nothing to publish with.")
    sys.exit(0)

parsed = None
for candidate in (raw, "{" + raw, "{" + raw + "}"):
    try:
        parsed = json.loads(candidate)
        break
    except Exception:
        continue

if not parsed:
    print("That secret is not JSON at all. Paste the whole service account file.")
    sys.exit(1)

if not parsed.get("client_email") or not parsed.get("private_key"):
    print("Not a service account key: client_email or private_key is missing.")
    print("Firebase Console -> Settings -> Service accounts -> Generate new private key")
    print("A service account key is about 2400 characters; the OAuth client file is about 400.")
    sys.exit(1)

path = os.path.join(os.environ["RUNNER_TEMP"], "key.json")
with open(path, "w") as handle:
    json.dump(parsed, handle)

print("Key accepted for", parsed["client_email"])
print("project:", parsed.get("project_id"))
note("ok=true")
