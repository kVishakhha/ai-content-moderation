from typing import Dict, Tuple

# Per-category thresholds. A single global threshold on a max-collapsed score
# conflated fundamentally different harms (profanity vs. a real threat), so we
# gate each category independently. Values tuned against the actual
# original-small scores produced by this model instance.

# BLOCK if any single category crosses its block threshold.
THREAT_BLOCK = 0.25            # "kill him" only scores ~0.29 on threat
SEVERE_TOXICITY_BLOCK = 0.50
IDENTITY_ATTACK_BLOCK = 0.50
TOXICITY_BLOCK = 0.999         # effectively disabled: toxicity fires high on all rude text
INSULT_BLOCK = 0.83           # separates "you are stupid" (~0.86) from "shut up loser" (~0.80)
OBSCENE_BLOCK = 0.99          # keep "fuck off" (~0.99 obscene) as warn per profanity policy

# Otherwise WARN if any single category crosses its warn threshold.
TOXICITY_WARN = 0.87          # allows "i hate maths" (~0.84), warns "shut up" (~0.90)
INSULT_WARN = 0.50
OBSCENE_WARN = 0.50


def decide(categories: Dict[str, float]) -> Tuple[float, str]:
    def g(key: str) -> float:
        return float(categories.get(key, 0.0))

    # Kept for logging / backwards display compatibility.
    overall_score = max(
        g("toxicity"),
        g("severe_toxicity"),
        g("obscene"),
        g("insult"),
        g("threat"),
        g("identity_attack"),
    )

    # BLOCK: any single category crossing its block threshold.
    if (
        g("threat") >= THREAT_BLOCK
        or g("severe_toxicity") >= SEVERE_TOXICITY_BLOCK
        or g("identity_attack") >= IDENTITY_ATTACK_BLOCK
        or g("toxicity") >= TOXICITY_BLOCK
        or g("insult") >= INSULT_BLOCK
        or g("obscene") >= OBSCENE_BLOCK
    ):
        return overall_score, "block"

    # WARN: any single category crossing its warn threshold.
    if (
        g("toxicity") >= TOXICITY_WARN
        or g("insult") >= INSULT_WARN
        or g("obscene") >= OBSCENE_WARN
    ):
        return overall_score, "warn"

    return overall_score, "allow"


def decide_distilbert(categories: Dict[str, float]) -> Tuple[float, str]:
    import os

    warn_threshold = float(os.getenv("DISTILBERT_WARN_THRESHOLD", "0.30"))
    block_threshold = float(os.getenv("DISTILBERT_BLOCK_THRESHOLD", "0.50"))
    if not 0.0 <= warn_threshold < block_threshold <= 1.0:
        raise ValueError(
            "DistilBERT thresholds must satisfy 0 <= warn < block <= 1"
        )

    score = max((float(value) for value in categories.values()), default=0.0)
    if score >= block_threshold:
        return score, "block"
    if score >= warn_threshold:
        return score, "warn"
    return score, "allow"
