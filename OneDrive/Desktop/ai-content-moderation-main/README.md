# AI-Powered Content Moderation System for Real-Time Chat

## Project overview
This project is a modular microservice-based content moderation system for real-time chat. It supports the normal text moderation pipeline and is being extended to handle image moderation without breaking the existing decision workflow.

## Microservices architecture
- API Gateway: routes requests, enforces JWT auth, and forwards JSON payloads to the downstream services.
- User Service: handles authentication and user management.
- Chat Service: manages chat flow and message sending/receiving.
- Moderation Service: evaluates incoming text or image content and returns allow/warn/block decisions.
- Analytics Service: reads stored moderation outcomes for reporting and monitoring.

## Service documentation
- [api-gateway/README.md](api-gateway/README.md)
- [chat-service/README.md](chat-service/README.md)
- [user-service/README.md](user-service/README.md)
- [moderation-service/README.md](moderation-service/README.md)
- [analytics-service/README.md](analytics-service/README.md)

## Image Moderation (in progress)
The image moderation contract is documented in [docs/image-integration.md](docs/image-integration.md). This includes the updated `messages` schema, the base64-in-JSON request shape, the `8mb` body limits, and the decision that blocked images keep `image_url = NULL`.
