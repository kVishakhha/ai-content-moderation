# Chat Service

Handles message sending, conversation history, user search, and Socket.IO presence. Runs on port **3002**.

## Run locally

1. Start PostgreSQL and initialize the root `schema.sql`.
2. Copy the root `.env.example` to `.env`; set your database credentials and keep `MODERATION_SERVICE_URL=http://localhost:3003` for a local moderation API.
3. Start the moderation API in another terminal (see the root README).
4. Install and start the chat service:

   ```bash
   cd chat-service
   npm install
   npm start
   ```

## Endpoints

- `POST /chat/send` — body `{ "receiver_id": "...", "content": "..." }`. Sender identity is read from the `x-user-id` header that the gateway must set after authenticating the request. Returns the saved message, decision, score, delivery status, moderation latency, and a `fallback` flag.
- `GET /chat/conversation/:otherUserId` — messages between the authenticated user and another user.
- `GET /chat/conversations` — conversation list.
- `GET /chat/users/search?q=...` — search users.

## Moderation integration status

The current `controllers/chatController.js` calls the real FastAPI service at `MODERATION_SERVICE_URL + /moderate`. It does **not** call `config/mockModeration.js`; that file is legacy mock code and is not part of the active request path.

The expected API contract is:

- Request: `{ "text": "message text" }`
- Response: `{ "score": 0.0-1.0, "decision": "allow" | "warn" | "block", "categories": { ... } }`

The chat service validates the returned decision and score. Requests time out after 800 ms. If the service is unreachable, times out, or returns an invalid response, the chat service stores a fallback `warn` with a null score and returns `fallback: true`.

**Important policy detail:** this fallback is *deliver-but-flag*, not fail-closed: a message can still be delivered while moderation is unavailable. For deployments that require strict blocking, change and test this policy explicitly.

## Security notes

- The gateway must authenticate the user, remove any client-supplied `x-user-id` header, and set that header from the verified identity. Do not expose the chat service directly to untrusted clients.
- Configure CORS and Socket.IO allowed origins for the actual frontend instead of using wildcard origins in production.
- Keep secrets in an untracked `.env`; never commit production credentials.
