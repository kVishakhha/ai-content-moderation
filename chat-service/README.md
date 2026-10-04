# Chat Service

Handles authenticated message sending, persistence, moderation, and real-time delivery. The API Gateway forwards `/chat/*` requests and supplies `x-user-id` after JWT validation.

## Run it

1. Configure database and service URLs using the root `.env.example` values.
2. Ensure PostgreSQL is running and `schema.sql` has been applied.
3. From this directory run `npm install` and `npm start`.

The Chat Service uses `MODERATION_SERVICE_URL` (for example `http://localhost:3003`) to call `POST /moderate-content`. `MODERATION_TIMEOUT_MS` optionally sets the request timeout (default 30000 ms). `JSON_BODY_LIMIT` controls JSON parser limits in the API Gateway and Chat Service (default `15mb`, required for base64 image requests).

## Message endpoint

`POST /chat/send` accepts the existing text request and optional image fields:

```json
{ "receiver_id": 12, "content": "Hello" }
```

```json
{ "receiver_id": 12, "image_base64": "...", "mime_type": "image/jpeg" }
```

Text and an image can be supplied together. Text is sent to moderation as `text`; `content` remains the Chat Service field for compatibility. The service calls `/moderate-content` before inserting or delivering a message. It validates the moderation response and fails closed on timeout, unavailability, missing model errors, or malformed responses. Invalid/unsupported/oversized image errors are returned without delivery or database insertion.

Text-only `allow` messages are stored and delivered. `warn` messages retain the existing behavior: they are stored and delivered with their warning decision so the recipient UI can gate the content. `block` messages retain the existing text audit behavior by storing a row marked `block`, but are not socket-delivered. The response includes the full moderation result under `moderation` as well as `decision`, `score`, `delivered`, and `latencyMs`.

## Image message limitation

The current `messages` schema has one required text `content` column, and existing history/socket/UI contracts only render text. The service therefore moderates image-bearing requests but does not store base64 in `content` or claim to deliver an image. A blocked image returns its moderation result with `delivered: false` and stores a `block` audit row (text when present, otherwise a neutral marker); an allowed or warned image returns HTTP 501 with its moderation result until image storage and message rendering are implemented as a shared backend/frontend change. No image storage architecture is introduced here.

## Routes

- `POST /chat/send` ? send a text message, image message, or both.
- `GET /chat/conversation/:otherUserId` ? read messages between the authenticated user and another user.
- `GET /chat/conversations` ? list conversations.
- `GET /chat/users/search?q=...` ? find users.

Run backend tests with `npm test`.
