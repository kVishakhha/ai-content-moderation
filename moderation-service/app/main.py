import logging
import base64
import binascii
import io
from fastapi import FastAPI, HTTPException
from PIL import Image
from .schemas import (
    ModerationRequest, ModerationResponse, ImageModerationRequest,
    ImageModerationResponse, ModerateContentRequest, ModerateContentResponse,
)
from .model import score_text
from .decision_engine import decide
from .image_moderator import moderate_image_bytes, InvalidImageError, ImageModelError
from .weapon_moderator import WeaponModelError

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("moderation")

app = FastAPI(title="Moderation Service", version="1.0.0")


@app.get("/health")
def health():
    return {"status": "Moderation Service is running"}


def _moderate_text(text: str) -> ModerationResponse:
    categories = score_text(text)
    score, decision = decide(categories)
    log.info("moderate len=%d score=%.2f decision=%s", len(text), score, decision)
    return ModerationResponse(
        score=round(score, 4),
        decision=decision,
        categories={k: round(v, 4) for k, v in categories.items()},
    )


def _moderate_image(req: ImageModerationRequest) -> ImageModerationResponse:
    allowed_mime_types = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"}
    if req.mime_type.lower() not in allowed_mime_types:
        raise HTTPException(status_code=415, detail="Unsupported image MIME type")
    try:
        image_bytes = base64.b64decode(req.image_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="image_base64 must contain valid base64 data") from exc
    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            declared = req.mime_type.lower()
            actual = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp", "GIF": "image/gif", "BMP": "image/bmp"}.get(image.format)
        if actual != declared:
            raise HTTPException(status_code=400, detail="Declared mime_type does not match image data")
        return ImageModerationResponse(**moderate_image_bytes(image_bytes))
    except InvalidImageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Image data is corrupted or unsupported") from exc
    except ImageModelError as exc:
        log.exception("Image moderation unavailable; failing closed")
        raise HTTPException(status_code=503, detail="Image moderation is unavailable") from exc
    except WeaponModelError as exc:
        log.exception("Weapon moderation unavailable; failing closed")
        raise HTTPException(status_code=503, detail="Weapon moderation is unavailable: " + str(exc)) from exc


@app.post("/moderate", response_model=ModerationResponse)
def moderate(req: ModerationRequest):
    return _moderate_text(req.text)


@app.post("/moderate-image", response_model=ImageModerationResponse)
def moderate_image(req: ImageModerationRequest):
    return _moderate_image(req)


@app.post("/moderate-content", response_model=ModerateContentResponse)
def moderate_content(req: ModerateContentRequest):
    if req.text is None and req.image_base64 is None:
        raise HTTPException(status_code=422, detail="Provide text, an image, or both")
    if req.image_base64 is None and req.mime_type is not None:
        raise HTTPException(status_code=422, detail="mime_type requires image_base64")

    text_result = _moderate_text(req.text) if req.text is not None else None
    image_result = None
    if req.image_base64 is not None:
        if req.mime_type is None:
            raise HTTPException(status_code=422, detail="mime_type is required with image_base64")
        image_result = _moderate_image(ImageModerationRequest(
            image_base64=req.image_base64,
            mime_type=req.mime_type,
        ))

    results = [result for result in (text_result, image_result) if result is not None]
    severity = {"allow": 0, "warn": 1, "block": 2}
    decision = max((result.decision for result in results), key=severity.__getitem__)
    score = max(result.score for result in results)
    return ModerateContentResponse(
        score=score,
        decision=decision,
        text=text_result,
        image=image_result,
    )
