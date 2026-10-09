# AI-Powered Content Moderation System for Real-Time Chat

## Overview
This project uses a microservices architecture to moderate chat content in real time. The existing text moderation flow is being extended to support image moderation.

## Services
- [API Gateway](api-gateway/README.md): authenticated request routing to backend services.
- [User Service](user-service/README.md): authentication and user management.
- [Chat Service](chat-service/README.md): messaging and moderation integration.
- [Moderation Service](moderation-service/README.md): text and image moderation.
- [Analytics Service](analytics-service/README.md): moderation and message analytics.

## Image moderation (in progress)
See [the image integration contract](docs/image-integration.md) for message fields, the JSON request format, payload limits, and the storage/delivery expectations for allowed, warned, and blocked images.