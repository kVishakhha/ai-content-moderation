"""Combined policy for independent NSFW, weapon, and gore model scores."""
import os

WEAPON_BLOCK_THRESHOLD = float(os.getenv("WEAPON_BLOCK_THRESHOLD", "0.70"))
WEAPON_WARN_THRESHOLD = float(os.getenv("WEAPON_WARN_THRESHOLD", "0.40"))
GORE_BLOCK_THRESHOLD = 0.90
GORE_WARN_THRESHOLD = 0.50


def decide_combined_image(nsfw_score, weapon_result, gore_result=None):
    confidences = [float(d["confidence"]) for d in weapon_result["detections"]]
    gore_confidence = float((gore_result or {}).get("confidence", 0.0))
    if (nsfw_score >= 0.85 or any(c >= WEAPON_BLOCK_THRESHOLD for c in confidences)
            or gore_confidence >= GORE_BLOCK_THRESHOLD):
        decision = "block"
    elif (nsfw_score >= 0.50 or any(c >= WEAPON_WARN_THRESHOLD for c in confidences)
            or gore_confidence >= GORE_WARN_THRESHOLD):
        decision = "warn"
    else:
        decision = "allow"
    return decision, max([nsfw_score, *confidences, gore_confidence])
