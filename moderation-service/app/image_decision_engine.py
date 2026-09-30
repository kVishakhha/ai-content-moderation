"""Image-only risk thresholds for the model's 0..1 NSFW probability."""

IMAGE_WARN_THRESHOLD = 0.50
IMAGE_BLOCK_THRESHOLD = 0.85


def decide_image(nsfw_score: float) -> str:
    if not 0.0 <= nsfw_score <= 1.0:
        raise ValueError("nsfw_score must be between 0 and 1")
    if nsfw_score >= IMAGE_BLOCK_THRESHOLD:
        return "block"
    if nsfw_score >= IMAGE_WARN_THRESHOLD:
        return "warn"
    return "allow"
