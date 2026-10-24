import logging
import os
from pathlib import Path
from typing import Dict

from .obfuscation import deobfuscate, scan as scan_obfuscation

log = logging.getLogger("moderation.text_model")

CATEGORIES = (
    "toxicity",
    "severe_toxicity",
    "obscene",
    "insult",
    "threat",
    "identity_attack",
)

DISTILBERT_LABELS = (
    "toxic",
    "severe_toxic",
    "obscene",
    "threat",
    "insult",
    "identity_hate",
)
DISTILBERT_CATEGORY_MAP = {
    "toxic": "toxicity",
    "severe_toxic": "severe_toxicity",
    "obscene": "obscene",
    "threat": "threat",
    "insult": "insult",
    "identity_hate": "identity_attack",
}

_BLOCK = ["nude", "kill", "hate", "idiot", "stupid", "bitch"]
_WARN = ["dumb", "ugly", "shut up", "loser", "trash"]
_backend = None
_model = None
_tokenizer = None


class TextModelError(RuntimeError):
    pass


def configured_backend() -> str:
    backend = os.getenv("TEXT_MODEL_BACKEND", "detoxify").strip().lower()
    if backend not in {"detoxify", "distilbert"}:
        raise TextModelError(
            "TEXT_MODEL_BACKEND must be either 'detoxify' or 'distilbert'"
        )
    return backend


def _empty() -> Dict[str, float]:
    return {category: 0.0 for category in CATEGORIES}


def _keyword_score(text: str) -> Dict[str, float]:
    lower = text.lower()
    if any(word in lower for word in _BLOCK):
        scores = _empty()
        scores["toxicity"] = 0.91
        scores["insult"] = 0.91
        return scores
    if any(word in lower for word in _WARN):
        scores = _empty()
        scores["toxicity"] = 0.63
        scores["insult"] = 0.63
        return scores
    return {category: 0.05 for category in CATEGORIES}


def _load_backend():
    global _backend, _model, _tokenizer
    backend = configured_backend()
    if backend == _backend:
        return backend

    if backend == "detoxify":
        try:
            from detoxify import Detoxify

            _model = Detoxify("original-small")
            _tokenizer = None
        except Exception as exc:
            log.warning(
                "Could not load Detoxify; using the documented keyword fallback: %s",
                exc,
            )
            _model = None
            _tokenizer = None
    else:
        model_path = Path(
            os.getenv(
                "DISTILBERT_MODEL_PATH",
                str(Path(__file__).resolve().parents[1] / "training" / "artifacts" / "distilbert"),
            )
        )
        local_model = model_path.is_dir()
        try:
            import torch
            from transformers import AutoModelForSequenceClassification, AutoTokenizer

            _tokenizer = AutoTokenizer.from_pretrained(
                str(model_path), local_files_only=local_model
            )
            _model = AutoModelForSequenceClassification.from_pretrained(
                str(model_path), local_files_only=local_model
            )
            _model.eval()
            _model.to(torch.device("cuda" if torch.cuda.is_available() else "cpu"))
        except Exception as exc:
            raise TextModelError("Could not load configured DistilBERT model") from exc

    _backend = backend
    return backend


def initialize_text_model() -> str:
    return _load_backend()


def _score_backend(text: str) -> Dict[str, float]:
    backend = _load_backend()
    if backend == "detoxify":
        if _model is None:
            return _keyword_score(text)
        try:
            raw_scores = _model.predict(text)
            return {category: float(raw_scores.get(category, 0.0)) for category in CATEGORIES}
        except Exception as exc:
            log.exception("Detoxify prediction failed; using keyword fallback: %s", exc)
            return _keyword_score(text)

    try:
        import torch

        device = next(_model.parameters()).device
        encoded = _tokenizer(
            text,
            truncation=True,
            max_length=128,
            return_tensors="pt",
        )
        encoded = {key: value.to(device) for key, value in encoded.items()}
        with torch.inference_mode():
            logits = _model(**encoded).logits[0]
            probabilities = torch.sigmoid(logits).cpu().tolist()

        if len(probabilities) != len(DISTILBERT_LABELS):
            raise TextModelError("DistilBERT must return exactly six label scores")
        model_config = _model.config
        id2label = getattr(model_config, "id2label", {}) or {}
        labels = [
            str(id2label.get(index, DISTILBERT_LABELS[index])).lower()
            for index in range(len(probabilities))
        ]

        mapped = {}
        for label, probability in zip(labels, probabilities):
            category = DISTILBERT_CATEGORY_MAP.get(label)
            if category is None or category in mapped:
                raise TextModelError(f"Unsupported DistilBERT label mapping: {label}")
            mapped[category] = float(probability)
        if len(mapped) != len(CATEGORIES):
            raise TextModelError("DistilBERT label metadata is incomplete")
        return mapped
    except TextModelError:
        raise
    except Exception as exc:
        raise TextModelError("DistilBERT prediction failed") from exc


def score_text(text: str) -> Dict[str, float]:
    categories = _score_backend(text)

    deobfuscated = deobfuscate(text)
    if deobfuscated != text.lower():
        deobfuscated_scores = _score_backend(deobfuscated)
        categories = {
            category: max(categories[category], deobfuscated_scores[category])
            for category in CATEGORIES
        }

    flags = scan_obfuscation(text)
    if flags["threat"]:
        categories["threat"] = max(categories["threat"], 0.95)
    if flags["profanity"]:
        categories["obscene"] = max(categories["obscene"], 0.60)
        categories["toxicity"] = max(categories["toxicity"], 0.90)

    return categories
