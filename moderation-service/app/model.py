# Toxicity scorer for the moderation service.
#
# Primary path: a small distilled-BERT toxicity model via the `detoxify`
# package ("original-small"). score_text returns the full per-category score
# dict so decision_engine.py can apply per-category thresholds. (A single
# max-collapsed number conflated different harms: profanity scored the same as
# a real threat.)
#
# Fallback path: if the model can't be loaded (offline weight download, import
# error) or a prediction fails at runtime, we fall back to the keyword scorer
# below, which returns the same six-key dict shape so callers are unaffected.

from typing import Dict

# Fallback keyword lists (used only when the ML model is unavailable).
_BLOCK = ["nude", "kill", "hate", "idiot", "stupid", "bitch"]
_WARN = ["dumb", "ugly", "shut up", "loser", "trash"]

# The six categories Detoxify returns; every result dict always has all six.
_CATEGORIES = (
    "toxicity",
    "severe_toxicity",
    "obscene",
    "insult",
    "threat",
    "identity_attack",
)

# Load the model once at import time so the first request isn't slow.
# Any failure here flips _model_ok off and we use the keyword fallback.
_model = None
_model_ok = False
try:
    from detoxify import Detoxify

    _model = Detoxify("original-small")
    _model_ok = True
except Exception:
    _model_ok = False


def _empty() -> Dict[str, float]:
    return {c: 0.0 for c in _CATEGORIES}


def _keyword_score(text: str) -> Dict[str, float]:
    lower = text.lower()
    if any(word in lower for word in _BLOCK):
        scores = _empty()
        scores["toxicity"] = 0.91
        scores["insult"] = 0.91
        return scores
    if any(word in lower for word in _WARN):
        scores = _empty()
        scores["toxicity"] = 0.63
        scores["insult"] = 0.63
        return scores
    return {c: 0.05 for c in _CATEGORIES}


def score_text(text: str) -> Dict[str, float]:
    if _model_ok:
        try:
            scores = _model.predict(text)
            return {c: float(scores.get(c, 0.0)) for c in _CATEGORIES}
        except Exception:
            # Model loaded but prediction failed — degrade gracefully.
            pass
    return _keyword_score(text)
