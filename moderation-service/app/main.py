import logging
from fastapi import FastAPI
from .schemas import ModerationRequest, ModerationResponse
from .model import score_text
from .decision_engine import decide

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
