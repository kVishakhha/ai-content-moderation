"""Fast, deterministic tests for moderation rules (no ML model or downloads)."""
import os
import sys
import unittest

SERVICE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SERVICE_ROOT)

from app.decision_engine import decide
from app.obfuscation import scan


class DecisionEngineTests(unittest.TestCase):
    def test_threat_category_blocks(self):
        _, decision = decide({"threat": 0.95})
        self.assertEqual(decision, "block")

    def test_insult_warn_threshold(self):
        _, decision = decide({"insult": 0.60})
        self.assertEqual(decision, "warn")

    def test_low_scores_are_allowed(self):
        _, decision = decide({
            "toxicity": 0.05, "severe_toxicity": 0.05, "obscene": 0.05,
            "insult": 0.05, "threat": 0.05, "identity_attack": 0.05,
        })
        self.assertEqual(decision, "allow")


class ObfuscationTests(unittest.TestCase):
    def test_disguised_threat_is_detected(self):
        self.assertTrue(scan("i will k*ll u")["threat"])

    def test_self_harm_encouragement_is_detected(self):
        self.assertTrue(scan("kys loser")["threat"])

    def test_disguised_profanity_is_detected(self):
        self.assertTrue(scan("f*ck off")["profanity"])

    def test_benign_lookalikes_are_not_flagged(self):
        for phrase in ("this heat is killing me", "a batch of cookies", "the butcher shop is open"):
            with self.subTest(phrase=phrase):
                flags = scan(phrase)
                self.assertFalse(flags["threat"])
                self.assertFalse(flags["profanity"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
