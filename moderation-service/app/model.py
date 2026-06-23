_BLOCK = ["nude", "kill", "hate", "idiot", "stupid", "bitch"]
_WARN = ["dumb", "ugly", "shut up", "loser", "trash"]


def score_text(text: str) -> float:
    lower = text.lower()
    if any(w in lower for w in _BLOCK):
        return 0.91
    if any(w in lower for w in _WARN):
        return 0.63
    return 0.05
