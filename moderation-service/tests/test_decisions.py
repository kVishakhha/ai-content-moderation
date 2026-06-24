"""
Decision test for the moderation service (per-category thresholds).

Start the service first (from the moderation-service folder):
    uvicorn app.main:app --host 0.0.0.0 --port 3003

Then run:
    python tests/test_decisions.py

Posts each phrase to POST /moderate, prints the actual decision + score +
category breakdown, and checks the decision against the expected policy.
Exits non-zero if any case mismatches. Standard library only.
"""

import json
import sys
import urllib.error
import urllib.request

URL = "http://localhost:3003/moderate"

# (text, expected_decision)
CASES = [
    ("hello there", "allow"),
    ("i hate maths", "allow"),
    ("this exam is killing me", "allow"),
    ("let's kill the exam tomorrow", "allow"),
    ("shut up", "warn"),
    ("you are ugly", "warn"),
    ("fuck off", "warn"),
    ("shut up loser", "warn"),
    ("you are stupid", "block"),
    ("kill him", "block"),
    ("i will kill you", "block"),
]

CATS = ("toxicity", "severe_toxicity", "obscene", "insult", "threat", "identity_attack")


def moderate(text: str) -> dict:
    body = json.dumps({"text": text}).encode("utf-8")
    req = urllib.request.Request(
        URL,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    print(f"POST {URL}\n")
    failures = 0
    for text, expected in CASES:
        try:
            data = moderate(text)
        except urllib.error.URLError as e:
            print(f"\nERROR contacting service for {text!r}: {e}")
            print("Is the service running on port 3003?")
            return 2

        score = data.get("score")
        decision = data.get("decision")
        cats = data.get("categories") or {}
        ok = decision == expected
        if not ok:
            failures += 1

        cat_str = "  ".join(f"{c[:4]}={float(cats.get(c, 0.0)):.3f}" for c in CATS)
        print(
            f"[{'PASS' if ok else 'FAIL'}] {text!r:<34} "
            f"got={decision:<6} exp={expected:<6} score={score:<7} | {cat_str}"
        )

    print(f"\n{len(CASES) - failures}/{len(CASES)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
