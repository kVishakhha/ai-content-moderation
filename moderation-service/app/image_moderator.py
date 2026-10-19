"""Binary nudity/sexual-content image moderation using a pretrained ViT."""

import io
import logging
from typing import Dict

from PIL import Image, UnidentifiedImageError
from .weapon_moderator import WeaponModelError, moderate_weapons
from .combined_image_decision_engine import decide_combined_image

log = logging.getLogger("moderation.image")
MODEL_ID = "Falconsai/nsfw_image_detection"
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 25_000_000
_classifier = None
_load_error = None


class InvalidImageError(ValueError):
    """The supplied bytes do not contain a supported, decodable image."""


class ImageModelError(RuntimeError):
    """The pretrained model could not load or run inference."""


def _get_classifier():
    global _classifier, _load_error
    if _classifier is None:
        if _load_error is not None:
            raise ImageModelError("Image moderation model is unavailable") from _load_error
        try:
            from transformers import pipeline

            _classifier = pipeline("image-classification", model=MODEL_ID)
        except Exception as exc:
            _load_error = exc
            log.exception("Failed to load image model %s", MODEL_ID)
            raise ImageModelError("Image moderation model is unavailable") from exc
    return _classifier


def _decode_image(image_bytes: bytes) -> Image.Image:
    if not image_bytes:
        raise InvalidImageError("Image data must not be empty")
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise InvalidImageError("Image exceeds the 10 MiB moderation-service limit")
    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            if image.format not in {"JPEG", "PNG", "WEBP", "GIF", "BMP"}:
                raise InvalidImageError("Unsupported image format")
            if image.width * image.height > MAX_IMAGE_PIXELS:
                raise InvalidImageError("Image dimensions exceed the 25 megapixel limit")
            image.load()
            return image.convert("RGB")
    except InvalidImageError:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise InvalidImageError("Image data is corrupted or unsupported") from exc


def moderate_image_bytes(image_bytes: bytes) -> Dict[str, object]:
    """Validate and classify bytes; fail closed by raising on any failure.

    NSFW and weapons are evaluated independently; the NSFW classifier does not
    detect weapons.
    """
    image = _decode_image(image_bytes)
    try:
        output = _get_classifier()(image)
        scores = {str(row["label"]).lower(): float(row["score"]) for row in output}
        if "nsfw" not in scores or "normal" not in scores:
            raise ValueError("Model output did not include normal and nsfw labels")
        score = scores["nsfw"]
        weapons = moderate_weapons(image_bytes)
        decision, combined_score = decide_combined_image(score, weapons)
        return {
            "score": round(combined_score, 4),
            "decision": decision,
            "categories": {"normal": round(scores["normal"], 4), "nsfw": round(score, 4), "weapons": {
                "detected": weapons["detected"], "detections": [
                    {"label": d["label"], "confidence": round(d["confidence"], 4)} for d in weapons["detections"]
                ]
            }},
        }
    except WeaponModelError:
        # Preserve the distinct configuration/inference error for the endpoint.
        raise
    except Exception as exc:
        log.exception("Image moderation inference failed")
        raise ImageModelError("Image moderation inference failed") from exc
