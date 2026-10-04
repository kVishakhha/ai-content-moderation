"""Combined policy for independent NSFW and weapon model scores."""
import os

WEAPON_BLOCK_THRESHOLD = float(os.getenv("WEAPON_BLOCK_THRESHOLD", "0.70"))
WEAPON_WARN_THRESHOLD = float(os.getenv("WEAPON_WARN_THRESHOLD", "0.40"))


def decide_combined_image(nsfw_score, weapon_result):
    confidences = [float(d["confidence"]) for d in weapon_result["detections"]]
    if nsfw_score >= 0.85 or any(c >= WEAPON_BLOCK_THRESHOLD for c in confidences):
        decision = "block"
    elif nsfw_score >= 0.50 or any(c >= WEAPON_WARN_THRESHOLD for c in confidences):
        decision = "warn"
    else:
        decision = "allow"
    return decision, max([nsfw_score, *confidences])
