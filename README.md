# AI-Powered Content Moderation System for Real-Time Chat

## Overview
This project uses a microservices architecture to moderate text and image
content in real-time chat.

## Services
- [API Gateway](api-gateway/README.md): authenticated request routing to backend services.
- [User Service](user-service/README.md): authentication and user management.
- [Chat Service](chat-service/README.md): messaging and moderation integration.
- [Moderation Service](moderation-service/README.md): text and image moderation.
- [Analytics Service](analytics-service/README.md): moderation and message analytics.

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

## Local container stack

The Docker Compose setup runs PostgreSQL, the API Gateway, User Service, Chat
Service, Moderation Service, and frontend. The Analytics Service is not included
yet because its implementation is not present on this branch; `/analytics`
requests will return a service-unavailable response until its owner provides
the service.

1. Copy `.env.example` to `.env` and set `DB_PASSWORD` and a strong
   `JWT_SECRET`.
2. Place weapon detector weights at `moderation-service/models/weapons/best.pt`
   if image inference should include weapon detections.
3. Start the available services with `docker compose up --build`.
4. Open the frontend at `http://localhost:5173`; the gateway is exposed at
   `http://localhost:3000`.

PostgreSQL initializes from `schema.sql` when its data volume is first created.
Existing databases need the relevant SQL migration applied separately.
# AI Content Moderation

A project exploring automated moderation of text and images, with integration into a chat application. The repository separates the moderation API from the chat service so that content checks can be called as part of a messaging workflow.

## Moderation components

- **Text moderation:** uses Detoxify to score potentially toxic text.
- **Image moderation:** includes an NSFW image classifier.
- **Weapon detection:** includes a YOLO11n-based detector.
- **Combined decision logic:** brings the image moderation signals together for a moderation response.
- **Chat integration:** the Chat Service calls the Moderation Service before
  delivering messages and fails closed when moderation fails.

## API surface

The moderation service has been developed around these endpoints:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | /moderate | Evaluate text content |
| POST | /moderate-image | Evaluate an image |
| POST | /moderate-content | Evaluate combined content |

Check the service's current request/response schemas and environment setup before integrating a client; exact payloads and response fields may vary with the current implementation.

## Technologies

- Python and FastAPI for the moderation API
- Detoxify / PyTorch for text moderation
- Image classification for NSFW detection
- YOLO11n for weapon detection
- Node.js services for chat integration

## Project status and responsible use

This is a learning and integration project, not a claim of production-grade safety. Automated moderation can make mistakes, and model outputs should not be treated as definitive judgments. Before production use, evaluate false positives and false negatives on representative data, define human-review and appeal paths, protect uploaded content, and document model limitations.

The Chat Service is wired to the real Moderation Service and fails closed when
moderation is unavailable or returns an invalid response. End-to-end image
inference still requires the externally supplied weapon detector weights.

## Local setup

Setup differs between the Python moderation service and the Node.js chat service. Follow the README and environment template in each service directory, and ensure required model weights and runtime dependencies are available. Do not commit secrets, uploaded user content, or large model artifacts.
