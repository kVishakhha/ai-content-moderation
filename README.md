# AI-Powered Content Moderation System for Real-Time Chat

## Overview
This project uses a microservices architecture to moderate text and image
content in real-time chat.

## Services
- [API Gateway](api-gateway/README.md): authenticated request routing to backend services.
- [User Service](user-service/README.md): authentication and user management.
- [Chat Service](chat-service/README.md): messaging and moderation integration.
- [Moderation Service](moderation-service/README.md): text and image moderation.
- [Analytics Service](analytics-service/README.md): admin-only moderation analytics and warning review queue.

## Image moderation

The moderation API provides text, image, and combined moderation endpoints.
Image moderation combines an NSFW classifier with a locally trained YOLO
weapon detector. The Chat Service calls moderation before message delivery,
stores allowed/warned images outside PostgreSQL, and serves them only to
conversation participants. Blocked image bytes are not stored or delivered;
their moderation metadata is retained for audit.
The detector weights are not tracked in Git; without
`models/weapons/best.pt` (or `WEAPON_MODEL_PATH`) image inference fails closed
with HTTP 503.

See the [image integration contract](docs/image-integration.md) for the message
fields, request format, payload limits, and storage details.

## Text model selection

The Moderation Service supports the existing Detoxify backend and the
fine-tuned DistilBERT experiment. It defaults to Detoxify so existing
thresholds and tested behavior stay unchanged. Set `TEXT_MODEL_BACKEND=distilbert`
to use DistilBERT, and provide the fine-tuned model directory at
`DISTILBERT_MODEL_PATH`. The training artifact is not included in Git. The
DistilBERT decision thresholds default to warn at 0.30 and block at 0.50; these
are configurable and should be evaluated on a held-out sample before presenting
the live model as validated. The current research report notes weak results on
rare labels, particularly threat.

## Local container stack

The Docker Compose setup runs PostgreSQL, the API Gateway, User Service, Chat
Service, Moderation Service, Analytics Service, and frontend. Admin analytics
and warning review features are available at `/admin`.

1. Copy `.env.example` to `.env` and set `DB_PASSWORD` and a strong
   `JWT_SECRET`.
2. Place weapon detector weights at `moderation-service/models/weapons/best.pt`
   if image inference should include weapon detections.
3. Apply `migrations/001_add_image_support.sql`,
   `migrations/002_add_review_queue_workflow.sql`, and
   `migrations/003_add_message_deletion.sql` to an existing database.
   New databases initialize from `schema.sql` and do not need these migrations.
4. To enable trained DistilBERT, place its saved Hugging Face model/tokenizer
   under `moderation-service/training/artifacts/distilbert` and set
   `TEXT_MODEL_BACKEND=distilbert` in `.env`. Keep the default Detoxify backend
   until the trained artifact is available.
5. Start the services with `docker compose up --build`.
6. Open the frontend at `http://localhost:5173`; the gateway is exposed at
   `http://localhost:3000`.

PostgreSQL initializes from `schema.sql` when its data volume is first created.
Existing databases need the relevant SQL migration applied separately.
The first moderation-service startup downloads Detoxify's model checkpoint and
can take several minutes on a slow connection; Compose waits for the model
readiness check and keeps the downloaded PyTorch cache in a named volume.

For the Render + Vercel capstone demo checklist, see
[deployment/README.md](deployment/README.md). Import the
[Postman collection](postman/ai-content-moderation.postman_collection.json) to
exercise gateway, chat, and admin endpoints.
