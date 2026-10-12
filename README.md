# AI Content Moderation

An academic software engineering project exploring AI-assisted content moderation for a messaging application. The repository contains a React frontend, Node.js services, a PostgreSQL schema, and a Python moderation API.

> **Repository status:** The current `main` branch includes a FastAPI text moderation API and a chat controller that calls it through `MODERATION_SERVICE_URL`. If the API is unavailable or returns an invalid response, chat stores a fallback `warn` decision and sets `fallback: true`; this fallback still delivers the message, so it is not fail-closed. The legacy `chat-service/config/mockModeration.js` file is not used by the active controller.

## What it includes

### Text moderation API
- **FastAPI** endpoint for text scoring.
- **Detoxify** (`original-small`) for category-level toxicity predictions.
- Separate thresholds for toxicity, severe toxicity, obscenity, insults, threats, and identity attacks.
- Text de-obfuscation and additional checks for disguised profanity or threats.
- Keyword-based fallback when the ML model cannot be loaded or a prediction fails.
- Structured `allow`, `warn`, or `block` decisions with category scores.

### Application services
- **API gateway:** Express-based request routing and JWT verification.
- **User service:** Authentication-related service with PostgreSQL support.
- **Chat service:** Messaging endpoints, real moderation API calls, and Socket.IO presence updates.
- **Analytics service:** Separate service area for analytics.
- **Frontend:** React application built with Vite.
- **Database:** PostgreSQL schema for users, messages, and a review queue.

## Architecture

```text
React frontend
     |
     v
API Gateway (Express + JWT)
     |
     +------ User Service
     +------ Chat Service ---- PostgreSQL
                  |
                  +---- POST /moderate
                           |
                           v
                   FastAPI + Detoxify
                           |
                           +---- score + allow / warn / block
```

## Tech stack

| Area | Technologies |
|---|---|
| Frontend | React, Vite, Axios, Socket.IO client |
| Backend services | Node.js, Express, Socket.IO |
| Moderation | Python, FastAPI, Detoxify, PyTorch |
| Database | PostgreSQL |
| Authentication | JWT |
| Development | Git, npm, Python virtual environments, GitHub Actions |

## Run the moderation API locally

### Prerequisites
- Python 3.10 or newer
- Git
- Internet access for the first model download, unless model weights are already cached

### 1. Clone the repository

```bash
git clone https://github.com/kVishakhha/ai-content-moderation.git
cd ai-content-moderation
```

### 2. Create a virtual environment

```bash
cd moderation-service
python -m venv .venv
```

Activate it:

**Windows PowerShell**
```powershell
.\\.venv\\Scripts\\Activate.ps1
```

**macOS / Linux**
```bash
source .venv/bin/activate
```

### 3. Install dependencies and start the API

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --port 3003
```

The API is available at `http://localhost:3003`; interactive docs are at `http://localhost:3003/docs`.

### 4. Configure and start chat service

Set `MODERATION_SERVICE_URL=http://localhost:3003` in the root `.env` and start the chat service in another terminal:

```bash
cd chat-service
npm install
npm start
```

The chat controller calls `POST /moderate`. It accepts decisions only from `allow`, `warn`, or `block` and scores in the range 0–1. Messages must contain non-empty text of at most 5,000 characters.

### 5. Health and moderation checks

```bash
curl http://localhost:3003/health
curl -X POST http://localhost:3003/moderate \
  -H "Content-Type: application/json" \
  -d '{"text":"You are very kind"}'
```

Predictions are probabilistic and are not a perfect or fully context-aware safety judgment.

## Tests and continuous integration

A GitHub Actions workflow runs Python syntax checks and deterministic tests for the moderation decision thresholds and obfuscation rules without downloading the ML model. These checks do not replace live API, database, or end-to-end tests.

## Limitations and deployment notes

- Moderation can produce false positives and false negatives; thresholds require evaluation on representative data.
- Keyword fallback is a resilience mechanism, not equivalent to the ML model.
- The chat-service outage policy is currently deliver-but-flag. Choose a stricter policy explicitly if required by the use case.
- The gateway must strip client-provided identity headers and inject `x-user-id` only after JWT verification; do not expose the chat service directly.
- Restrict HTTP and Socket.IO CORS origins and secure service-to-service communication before deployment.
- The repository should not be described as production-ready until API, database, and end-to-end tests have been run.

## Future improvements

- Add a reproducible evaluation dataset and report precision, recall, and F1 by category.
- Add integration tests for the FastAPI endpoint and chat-to-moderation flow.
- Add screenshots or a short frontend demo.
- Document validated deployment instructions.

## Author

**Vishakha Khetan** — [GitHub](https://github.com/kVishakhha)
