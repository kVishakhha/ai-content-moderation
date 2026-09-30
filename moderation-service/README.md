# Moderation Service

FastAPI service with separate text and image moderation paths.

## Text moderation

`POST /moderate` continues to use Detoxify (`original-small`) with the existing
text decision engine. The separate Phase-II DistilBERT experiment is not used
for live text moderation.

## Image moderation

`POST /moderate-image` evaluates an uploaded image before the chat service
delivers it. This is separate from Detoxify and uses the pretrained
[`Falconsai/nsfw_image_detection`](https://huggingface.co/Falconsai/nsfw_image_detection)
Vision Transformer through Hugging Face Transformers. The model returns two
probabilities: `normal` and `nsfw` (nudity/sexual content). It was pretrained by
its authors, not trained by this project. It does **not** detect violence, gore,
weapons, or self-harm imagery; outputs are model confidence scores, not a
guarantee of safety.

The service validates base64, declared MIME type, actual decoded image format,
image decoding, and a 10 MiB decoded size limit. Supported formats are JPEG,
PNG, WebP, GIF, and BMP. Inference or model-loading errors return HTTP 503; bad
input returns HTTP 400 (unsupported declared MIME type returns HTTP 415). No
image failure is converted to `allow`.

Image-only thresholds use the model's `nsfw` score in [0, 1]: below 0.50 is
`allow`, 0.50 through below 0.85 is `warn`, and 0.85 or higher is `block`.
These initial values require validation and tuning against representative,
appropriately handled data.

### Integration contract

Request: JSON body containing base64-encoded raw image bytes (standard base64,
without a data-URL prefix) and the declared MIME type. This works through a
JSON-only gateway and avoids multipart configuration.

```json
{
  "image_base64": "iVBORw0KGgo...",
  "mime_type": "image/png"
}
```

Success (`200 OK`):

```json
{
  "decision": "allow",
  "score": 0.02,
  "categories": {"normal": 0.98, "nsfw": 0.02}
}
```

`score` is the `nsfw` probability and `categories` contains only the model's
two labels. `decision` is exactly `allow`, `warn`, or `block`. The chat service
should deliver only on `allow`; `warn` and `block` require its product policy.
Malformed or unsupported input produces a 4xx response; inability to load or
run the model produces `503 Service Unavailable`, which callers must treat as
failed moderation and fail closed.

### Install and verify image moderation

```bash
pip install -r requirements.txt
python -c "from app.image_moderator import moderate_image_bytes; print('image moderator import OK')"
```

First inference downloads model weights from Hugging Face. To exercise the
real model, run the service and submit an authorized JPEG/PNG/WebP/GIF/BMP via
the contract above. Do not add explicit NSFW samples to the repository. Unit
tests use a synthetic safe image and mock classifier scores for threshold
behavior; they do not claim to validate the real model's accuracy.

## Install

```bash
pip install -r requirements.txt
```

## Run

```bash
uvicorn app.main:app --host 0.0.0.0 --port 3003 --reload
```

> First startup may download model weights for text and image models. Text
> moderation retains its existing keyword fallback; image moderation fails
> closed with HTTP 503 when its model is unavailable.

## Example

```bash
curl -X POST http://localhost:3003/moderate -H "Content-Type: application/json" -d "{\"text\": \"i will kill you\"}"
# -> score/categories depend on the loaded model
```
