from pydantic import BaseModel, Field
from typing import Literal, Optional, Dict


class ModerationRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)


class ModerationResponse(BaseModel):
    score: float = Field(..., ge=0.0, le=1.0)
    decision: Literal["allow", "warn", "block"]
    categories: Optional[Dict[str, float]] = None
