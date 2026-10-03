# Chat Service (Person B — Sowpy)

Handles sending/receiving messages and moderation.
Runs on **port 3002**. Gateway already routes `/chat/*` here.

## Folder layout (matches user-service)
```
chat-service/
  config/
    db.js               <- Postgres pool (same as user-service)
    mockModeration.js   <- TEMP fake moderation (remove when real one is live)
  controllers/
    chatController.js   <- send message + get conversation
  routes/
    chat.js
  index.js              <- starts the server on 3002
  package.json
```
(`Chat.jsx` also lives here for now — move it into `frontend/src/pages/Chat.jsx`.)

## Run it
1. Make sure Postgres is running and the `messages` table exists
   (it's in the root `schema.sql` — run that once).
2. Copy the root `.env.example` to `.env` and fill in your DB password.
3. Install + start:
   ```
   cd chat-service
   npm install
   npm start
   ```
4. You should see:
   ```
   Database connected successfully
   Chat Service running on port 3002
   ```

## Endpoints
- `POST /chat/send` — body `{ receiver_id, content }`. Sender comes from the
  `x-user-id` header the gateway forwards. Returns `{ message, decision, score, delivered }`.
- `GET /chat/conversation/:otherUserId` — messages between you and that user.

## Moderation: mock now, real later
Right now messages are scored by `config/mockModeration.js` (keyword rules,
just so you can see allow/warn/block working).

**When Meetali's `/moderate` (port 3003) is ready**, open
`controllers/chatController.js`, find the `moderate()` function, and switch
from the mock line to the axios block. That's the ONLY change.

Agreed contract (confirm with Meetali):
```
POST /moderate
request:  { "text": "..." }
response: { "score": 0.0-1.0, "decision": "allow" | "warn" | "block" }
```

## Note on the messages table
Uses Vishakha's `schema.sql` columns: `decision` and `confidence_score`
(score is stored in `confidence_score`). Don't rename these without telling
the team — analytics reads them.