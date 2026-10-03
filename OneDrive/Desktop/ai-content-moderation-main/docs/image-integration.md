# Image Moderation Integration Contract

## Database contract
The `messages` table now supports both text and image payloads while keeping the existing moderation columns for analytics:

- `content` — `TEXT`, nullable for image-only messages
- `message_type` — `VARCHAR(10)`, default `text`, allowed values: `text` and `image`
- `image_url` — `TEXT`, nullable; blocked images keep this as `NULL`
- `decision` — `VARCHAR(10)`, reused for both text and image moderation outcomes
- `confidence_score` — `FLOAT`, reused for both text and image moderation scores

The table-level check enforces:
- text messages must have `content IS NOT NULL`
- image messages must have `content IS NULL`

## API Gateway contract (Option A)
The gateway uses a JSON-based base64 image payload rather than a multipart form upload. This is intentionally kept simple and compatible with the existing JSON proxy logic.

Example request body for an image message:

```json
{
  "receiver_id": 2,
  "image_base64": "iVBORw0KGgoAAAANSUhEUgAA...",
  "mime_type": "image/png"
}
```

Notes:
- `content` is intentionally omitted for image messages.
- `image_base64` is the base64-encoded image payload.
- `mime_type` should be the image MIME type, such as `image/jpeg` or `image/png`.
- `image_url` remains `NULL` for blocked images until the team explicitly decides to persist flagged images.

## Body-size limits
The API Gateway and Chat Service both set `express.json({ limit: '8mb' })` so a base64-encoded image can pass through without being rejected by the default body-size limit.

These limits must remain synchronized across both services.
