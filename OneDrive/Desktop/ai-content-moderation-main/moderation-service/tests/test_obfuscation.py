"""
Offline test for the obfuscation-aware detection layer.

Unlike test_examples.py / test_decisions.py (which POST to a running service),
this runs the scoring + decision pipeline in-process, so no server is needed:

    cd moderation-service
    python tests/test_obfuscation.py

It checks two things:
  1. Disguised abuse ("k*ll u", "bxtch", "sh00t them") is caught (block/warn).
  2. Benign look-alikes ("killing me", "a batch of cookies") stay allowed —
     i.e. the evasion nets don't cause false positives.
Exits non-zero if any case fails, so it can be used in CI.
"""

import os
import sys

# Allow `from app...` when run as a plain script from the service folder.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.decision_engine import decide  # noqa: E402
from app.model import score_text  # noqa: E402

# (text, allowed_decisions) — a set, since e.g. strong disguised profanity may
# legitimately land on either warn or block depending on the model.
CASES = [
    # Disguised threats -> must BLOCK.
    ("bxtch i'll k*ll u", {"block"}),
    ("i will k1ll you", {"block"}),
    ("im gonna sh00t u", {"block"}),
    ("k*ll yourself", {"block"}),
    ("kys loser", {"block"}),
    ("i'll stab you", {"block"}),
    ("im going to kill you", {"block"}),
    # Disguised / directed profanity -> at least WARN.
    ("f*ck off", {"warn", "block"}),
    ("you b1tch", {"warn", "block"}),
    # Benign look-alikes -> must stay ALLOW (false-positive guards).
    ("hello how are you", {"allow"}),
    ("this heat is killing me", {"allow"}),
    ("i made a batch of cookies", {"allow"}),
    ("lets kill the lights", {"allow"}),
    ("the butcher shop is open", {"allow"}),
    ("i could murder a pizza rn", {"allow"}),
    ("my skills are improving", {"allow"}),
    ("you did a great job today", {"allow"}),
]


def main() -> int:
    failures = 0
    for text, allowed in CASES:
        cats = score_text(text)
        _, decision = decide(cats)
        ok = decision in allowed
        if not ok:
            failures += 1
        print(
            f"[{'PASS' if ok else 'FAIL'}] {text!r:<32} "
            f"got={decision:<6} expected={'/'.join(sorted(allowed))}"
        )
    print(f"\n{len(CASES) - failures}/{len(CASES)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
