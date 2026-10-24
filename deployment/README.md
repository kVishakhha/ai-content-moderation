# Capstone demo deployment: Render + Vercel

This is a deployment checklist, not an automated deployment. You must create
the provider accounts, configure secrets, and supply model files. Do not commit
`.env` files or model weights.

## 1. Deploy the database

Create a managed PostgreSQL database in Render and keep the service in the same
region as the backend services. Copy its **internal** host, port, database,
username, and password into the environment settings for the User, Chat, and
Analytics services. Apply both repository migrations to an existing database:

```sh
psql -h <internal-host> -p <port> -U <user> -d <database> \
  -f migrations/001_add_image_support.sql
psql -h <internal-host> -p <port> -U <user> -d <database> \
  -f migrations/002_add_review_queue_workflow.sql
```

For a new database, initialize with `schema.sql` instead. Use a database plan
with backups if the demo data must survive provider restarts; free database
plans may have retention limits.

Register an admin account through the UI first, then promote it with a database
admin connection before logging in to the dashboard:

```sql
UPDATE users SET role = 'admin' WHERE email = 'your-admin-email@example.com';
```

Do not expose an admin-role field on public registration.

## 2. Deploy backend services on Render

Create one Docker service per directory, using each directory's Dockerfile:

| Service | Directory | Exposure |
| --- | --- | --- |
| API Gateway | `api-gateway` | Public web service |
| User Service | `user-service` | Private service |
| Chat Service | `chat-service` | Private service |
| Moderation Service | `moderation-service` | Private service |
| Analytics Service | `analytics-service` | Private service |

Set the following service environment values:

- **Gateway:** `GATEWAY_PORT=3000`, strong `JWT_SECRET`, `CORS_ORIGIN` equal to
  the exact Vercel frontend origin, and service URLs pointing at the private
  hostnames/ports for User (3001), Chat (3002), Moderation (3003), and Analytics
  (3004). Set each URL as `http://<private-hostname>:<port>`.
- **User Service:** `USER_SERVICE_PORT=3001`, `DB_*`, `JWT_SECRET`, and
  `JWT_EXPIRES_IN=7d`.
- **Chat Service:** `CHAT_SERVICE_PORT=3002`, `DB_*`, the same `JWT_SECRET`,
  `MODERATION_SERVICE_URL=http://<moderation-private-host>:3003`,
  `JSON_BODY_LIMIT=15mb`, and `MODERATION_TIMEOUT_MS=30000`.
- **Analytics Service:** `ANALYTICS_SERVICE_PORT=3004`, `DB_*`, and the same
  `JWT_SECRET`.
- **Moderation Service:** `MODERATION_SERVICE_PORT=3003`,
  `WEAPON_MODEL_PATH=/var/data/models/weapons/best.pt`,
  `TORCH_HOME=/var/data/torch`, and
  `TEXT_MODEL_BACKEND=detoxify` until the fine-tuned DistilBERT artifact is
  available and evaluated.

Use Render persistent disks for Chat uploads (`IMAGE_STORAGE_DIR=/var/data/uploads`)
and Moderation Service model/cache files (`/var/data/models` and
`/var/data/torch`). Upload the non-Git weapon weights to
`/var/data/models/weapons/best.pt` using a secure provider-supported method.
Image moderation will return HTTP 503 until the weights are present.

If enabling DistilBERT, provide the fine-tuned model and tokenizer either as
files on a persistent disk or as a publicly accessible Hugging Face model
repository ID in `DISTILBERT_MODEL_PATH`; set `TEXT_MODEL_BACKEND=distilbert`.
The currently documented experimental metrics show weak performance for rare
labels, so retain Detoxify for a demo unless the DistilBERT checkpoint has been
re-evaluated. Configure `DISTILBERT_WARN_THRESHOLD` and
`DISTILBERT_BLOCK_THRESHOLD` from validation results.

## 3. Deploy the frontend on Vercel

Import the repository into Vercel and set the project root to `frontend`.
Configure this build-time environment variable:

```text
VITE_API_BASE_URL=https://<public-gateway-host>
```

The included `frontend/vercel.json` rewrites client-side routes to `index.html`.
Set the gateway's `CORS_ORIGIN` to the exact deployed Vercel URL (including
`https://` and any selected custom domain).

## 4. Verify the deployment

1. Check `https://<gateway-host>/health`.
2. Register a normal account and log in; verify it routes to `/chat`.
3. Log in with a pre-provisioned admin account; verify it routes to `/admin`.
   Public registration does not allow clients to select an admin role.
4. Send text through the chat UI and confirm the moderation decision and
   delivery behavior.
5. Send a safe image and confirm it persists and loads for conversation
   participants. Confirm a warning appears in the admin review queue.
6. Resolve a warning as confirmed and dismissed, and confirm counts update.
7. Test a blocked image and confirm no image bytes are persisted or delivered.
8. Only after model files are uploaded, exercise a weapon image and confirm
   detector output. If testing DistilBERT, use the held-out test examples and
   record results separately from the Detoxify baseline.

The Postman collection at
`postman/ai-content-moderation.postman_collection.json` covers gateway health,
login, chat, and admin analytics requests. Use test images and accounts only.
