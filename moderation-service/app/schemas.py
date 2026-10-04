from typing import Literal, Optional, Dict, Any
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
    categories: Dict[str, Any]


class ModerateContentRequest(BaseModel):
    text: Optional[str] = Field(None, min_length=1, max_length=5000)
    image_base64: Optional[str] = Field(None, min_length=1, max_length=14_000_000)
    mime_type: Optional[str] = Field(None, min_length=1)


class ModerateContentResponse(BaseModel):
    score: float = Field(..., ge=0.0, le=1.0)
    decision: Literal["allow", "warn", "block"]
    text: Optional[ModerationResponse] = None
    image: Optional[ImageModerationResponse] = None
