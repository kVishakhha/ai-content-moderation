from typing import Literal, Optional, Dict
from pydantic import BaseModel, Field


class ModerationRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)


class ModerationResponse(BaseModel):
    score: float = Field(..., ge=0.0, le=1.0)
    decision: Literal["allow", "warn", "block"]
    categories: Optional[Dict[str, float]] = None


class ImageModerationRequest(BaseModel):
    image_base64: str = Field(..., min_length=1, max_length=14_000_000)
    mime_type: str = Field(..., min_length=1)


class ImageModerationResponse(BaseModel):
    score: float = Field(..., ge=0.0, le=1.0)
    decision: Literal["allow", "warn", "block"]
    categories: Dict[str, float]
