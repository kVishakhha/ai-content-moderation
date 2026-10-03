"""
Standalone smoke test for the moderation service.

Start the service first (from the moderation-service folder):
    uvicorn app.main:app --host 0.0.0.0 --port 3003 --reload

Then run:
    python tests/test_examples.py

It hits POST /moderate for each example, prints the actual score + decision,
and checks the decision against what we expect. Exits non-zero if any case fails
so it can be used in CI. Uses only the standard library (no extra deps).
"""

import json
import sys
import urllib.error
import urllib.request

URL = "http://localhost:3003/moderate"

# (text, expected_decision)
CASES = [
    ("kill him", "block"),
    ("i will kill you", "block"),
    ("you are stupid", "block"),
    ("you are ugly", "warn"),
    ("shut up", "warn"),
    ("let's kill the exam tomorrow", "allow"),
    ("i hate maths", "allow"),
    ("this exam is killing me", "allow"),
    ("hello cutie", "allow"),
]


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
    print(f"{'text':<34} {'score':>7}  {'actual':<6} {'expected':<8} result")
    print("-" * 72)

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
        ok = decision == expected
        if not ok:
            failures += 1
        print(
            f"{text!r:<34} {score:>7.4f}  {decision:<6} {expected:<8} "
            f"{'PASS' if ok else 'FAIL'}"
        )

    print("-" * 72)
    total = len(CASES)
    print(f"{total - failures}/{total} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
