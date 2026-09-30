import logging
import base64
import binascii
from fastapi import FastAPI, HTTPException
from .schemas import ModerationRequest, ModerationResponse, ImageModerationRequest, ImageModerationResponse
from .model import score_text
from .decision_engine import decide
from .image_moderator import moderate_image_bytes, InvalidImageError, ImageModelError

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("moderation")

app = FastAPI(title="Moderation Service", version="1.0.0")


@app.get("/health")
def health():
    return {"status": "Moderation Service is running"}


@app.post("/moderate", response_model=ModerationResponse)
def moderate(req: ModerationRequest):
    categories = score_text(req.text)
    score, decision = decide(categories)
    log.info("moderate len=%d score=%.2f decision=%s", len(req.text), score, decision)
    return ModerationResponse(
        score=round(score, 4),
        decision=decision,
        categories={k: round(v, 4) for k, v in categories.items()},
    )


@app.post("/moderate-image", response_model=ImageModerationResponse)
def moderate_image(req: ImageModerationRequest):
    allowed_mime_types = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"}
    if req.mime_type.lower() not in allowed_mime_types:
        raise HTTPException(status_code=415, detail="Unsupported image MIME type")
    try:
        image_bytes = base64.b64decode(req.image_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="image_base64 must contain valid base64 data") from exc
    try:
        from PIL import Image
        import io

        with Image.open(io.BytesIO(image_bytes)) as image:
            declared = req.mime_type.lower()
            actual = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp", "GIF": "image/gif", "BMP": "image/bmp"}.get(image.format)
        if actual != declared:
            raise HTTPException(status_code=400, detail="Declared mime_type does not match image data")
        return moderate_image_bytes(image_bytes)
    except InvalidImageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Image data is corrupted or unsupported") from exc
    except ImageModelError as exc:
        log.exception("Image moderation unavailable; failing closed")
        raise HTTPException(status_code=503, detail="Image moderation is unavailable") from exc
