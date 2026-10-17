# AI Content Moderation

A project exploring automated moderation of text and images, with integration into a chat application. The repository separates the moderation API from the chat service so that content checks can be called as part of a messaging workflow.

## Moderation components

- **Text moderation:** uses Detoxify to score potentially toxic text.
- **Image moderation:** includes an NSFW image classifier.
- **Weapon detection:** includes a YOLO11n-based detector.
- **Combined decision logic:** brings the image moderation signals together for a moderation response.
- **Chat integration:** the chat service is intended to call the moderation endpoint before delivering a message.

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

The chat-service documentation describes a mock moderation implementation in its current flow. Confirm that the chat controller is wired to the real moderation service before assuming that live messages are being checked by the model.

## Local setup

Setup differs between the Python moderation service and the Node.js chat service. Follow the README and environment template in each service directory, and ensure required model weights and runtime dependencies are available. Do not commit secrets, uploaded user content, or large model artifacts.
