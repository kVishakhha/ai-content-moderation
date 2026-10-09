# Image Moderation Integration Contract

## Message row

The `messages` table keeps the existing moderation fields and adds image metadata:

- `content TEXT` is nullable. Text messages require content; image messages may include an optional caption.
- `message_type VARCHAR(10) NOT NULL DEFAULT 'text'` accepts `text` or `image`.
- `image_url TEXT` is nullable and identifies the stored image for allowed/warned messages.
- `mime_type VARCHAR(100)` is required for image messages and null for text messages.
- `decision VARCHAR(10)` and `confidence_score FLOAT` are reused for both message types.

Image bytes are stored outside PostgreSQL. Chat Service must provide an `image_url` that the frontend can retrieve through the chat application. The specific file-storage location and URL-serving mechanism belong to the Chat Service implementation and must be agreed with Sowpy.

Blocked images must not have a stored image URL. Whether a metadata-only blocked-message row is retained is still a team decision. Blocked content must not be socket-delivered.

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

For allowed/warned images, Chat Service stores the image outside PostgreSQL, then persists its URL, MIME type, optional caption, decision and confidence score. Chat history and Socket.IO payloads should return the same message fields, including the retrievable `image_url`. Blocked images are not socket-delivered and must not retain an image URL.

## Payload limits

The API Gateway and Chat Service both use `express.json({ limit: '8mb' })`. Keep these limits synchronized. Because base64 expands binary data, the raw image must be smaller than the JSON request limit allows; enforce a client/server image-size cap that leaves room for the base64 encoding and other request fields.

## Existing databases

Apply the additive migration from the repository root:

```bash
psql -d ai_moderation -f migrations/001_add_image_support.sql
```
