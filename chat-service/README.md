# Chat Service

The Chat Service runs on port `3002`. REST routes are exposed through the API
Gateway under `/chat/*`; the Gateway forwards Socket.IO WebSocket upgrades to
this service. Socket.IO connections must provide a valid JWT in the handshake
`auth.token` field. The service derives the connected user ID from that token;
clients cannot register arbitrary user IDs.

## Endpoints

- `POST /chat/send` — accepts text, an image, or both; sender identity comes
  from the verified `x-user-id` header forwarded by the Gateway.
- `GET /chat/conversations` — list the caller's conversations.
- `GET /chat/conversation/:otherUserId` — load message history.
- `GET /chat/users/search?q=...` — find users to start a conversation.

## Moderation and image status

The controller calls `POST ${MODERATION_SERVICE_URL}/moderate-content` and
validates the returned decisions and scores. Moderation errors fail closed:
messages are not delivered when moderation times out, is unavailable, or
returns an invalid response.

Text and allowed/warned image messages are persisted and delivered according
to the moderation result. Image bytes are stored outside PostgreSQL under
`IMAGE_STORAGE_DIR`, and image URLs are served only to authenticated
conversation participants. Blocked images are neither stored nor
socket-delivered. See [`docs/image-integration.md`](../docs/image-integration.md)
for the storage contract.

## Local run

Configure PostgreSQL and the values in the root `.env.example`, then run:

```sh
npm ci
npm start
```

Run the Chat Service tests with `npm test`. The root Docker Compose setup starts
the available services together.
