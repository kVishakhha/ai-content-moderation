"""Graphic-content classification using the OwenElliott NSFL image model."""

import logging
import math

from PIL import Image

log = logging.getLogger("moderation.gore")
MODEL_ID = "OwenElliott/image-safety-classifier-xs"
# The model card defines classifier output order as NSFL, NSFW, then SFW.
_MODEL_CLASS_NAMES = ("nsfl", "nsfw", "sfw")
GORE_WARN_THRESHOLD = 0.50
GORE_BLOCK_THRESHOLD = 0.90
_classifier = None
_load_error = None


class GoreModelError(RuntimeError):
    """The gore classifier could not load or returned unusable output."""


def _get_classifier():
    global _classifier, _load_error
    if _classifier is None:
        if _load_error is not None:
            raise GoreModelError("Gore moderation model is unavailable") from _load_error
        try:
            from transformers import pipeline

            _classifier = pipeline("image-classification", model=MODEL_ID, device=-1, top_k=None)
        except Exception as exc:
            _load_error = exc
            log.exception("Failed to load gore model %s", MODEL_ID)
            raise GoreModelError("Gore moderation model is unavailable") from exc
    return _classifier


def moderate_gore(image: Image.Image):
    """Return a predictable NSFL result from a decoded image."""
    try:
        rows = _get_classifier()(image.convert("RGB"))
        scores = {}
        for row in rows:
            label = str(row["label"]).strip().lower()
            if label.startswith("label_") and label[6:].isdigit():
                class_index = int(label[6:])
                if class_index >= len(_MODEL_CLASS_NAMES):
                    raise ValueError(f"Model returned unknown class index: {label}")
                label = _MODEL_CLASS_NAMES[class_index]
            scores[label] = float(row["score"])
        if "nsfl" not in scores:
            raise ValueError("Model output did not include the NSFL label")
        confidence = scores["nsfl"]
        if not math.isfinite(confidence) or not 0.0 <= confidence <= 1.0:
            raise ValueError("Model returned an invalid NSFL probability")
        return {"detected": confidence >= GORE_WARN_THRESHOLD,
                "confidence": round(confidence, 4), "category": "gore"}
    except GoreModelError:
        raise
    except Exception as exc:
        log.exception("Gore moderation inference failed")
        raise GoreModelError("Gore moderation inference failed") from exc
