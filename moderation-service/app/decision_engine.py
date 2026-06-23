ALLOW_MAX = 0.40
WARN_MAX = 0.75


def decide(score: float) -> str:
    if score <= ALLOW_MAX:
        return "allow"
    if score <= WARN_MAX:
        return "warn"
    return "block"
