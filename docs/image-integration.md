# Image Moderation Integration Contract

## Message row

The `messages` table keeps the existing moderation fields and adds image metadata:

- `content TEXT` is nullable. Text messages require content; image messages may include an optional caption.
- `message_type VARCHAR(10) NOT NULL DEFAULT 'text'` accepts `text` or `image`.
- `image_url TEXT` is nullable and identifies the stored image for allowed/warned messages.
- `mime_type VARCHAR(100)` is required for image messages and null for text messages.
- `decision VARCHAR(10)` and `confidence_score FLOAT` are reused for both message types.

Image bytes are stored outside PostgreSQL in Chat Service's configured `IMAGE_STORAGE_DIR` (a persistent Docker volume for the Compose demo). Chat Service generates an unguessable filename and persists an `image_url` such as `/chat/media/<uuid>.jpg`. The frontend retrieves that URL through the API Gateway with its JWT; Chat Service only serves an image to a sender or receiver of the corresponding non-blocked message.

Blocked image bytes must not be stored, and the message row must not have an image URL. The Chat Service retains a metadata-only row for audit purposes, including the declared MIME type and moderation decision. Blocked content must not be socket-delivered.

## Send request through the API Gateway

The Gateway continues to accept and forward JSON. Image sends use this shape at `POST /chat/send`:

```json
{
  "receiver_id": 2,
  "message_type": "image",
  "image_base64": "iVBORw0KGgoAAAANSUhEUgAA...",
  "mime_type": "image/png",
  "content": "Optional caption"
}
```

`content` may be omitted or null for an image-only message. The authenticated user identity continues to come from the Gateway's `x-user-id` header. Chat Service is responsible for calling the moderation service before persistence or delivery; the frontend must not call the Moderation Service directly.

For allowed/warned images, Chat Service stores the image bytes outside PostgreSQL, then persists its URL, MIME type, optional caption, decision and confidence score. Chat history and Socket.IO payloads return the same message fields, including the retrievable `image_url`. Blocked image bytes are not stored or socket-delivered; only their metadata is retained, with no image URL.

Warning messages are added to `review_queue` automatically by a PostgreSQL
trigger. Admins can view pending warnings and mark them `confirmed` or
`dismissed`; this records the review outcome and admin ID without changing the
original moderation decision. Authenticated admins can view non-blocked image
bytes for review through the media endpoint.

## Payload limits

The API Gateway and Chat Service both use `express.json({ limit: '15mb' })` by default. Keep these limits synchronized. The moderation API accepts decoded images up to 10 MiB, so enforce that same raw-image cap on the client and server; base64 encoding and JSON fields expand the request to roughly 14 MiB.

## Existing databases

Apply the additive migrations from the repository root to an existing database:

```bash
psql -d ai_moderation -f migrations/001_add_image_support.sql
psql -d ai_moderation -f migrations/002_add_review_queue_workflow.sql
```
