# AI Content Moderation

An academic software engineering project exploring AI-assisted content moderation for a messaging application. The repository contains a React frontend, Node.js services, a PostgreSQL schema, and a Python moderation API.

> **Repository status:** The text moderation API is implemented in the current `main` branch. The chat service README describes a mock moderation path, so verify the integration before treating end-to-end moderation as complete. Features developed on other branches may not be available on `main`.

## What it includes

### Text moderation API
- **FastAPI** endpoint for text scoring.
- **Detoxify** (`original-small`) for category-level toxicity predictions.
- Separate thresholds for categories such as toxicity, severe toxicity, obscenity, insults, threats, and identity attacks.
- Text de-obfuscation and additional checks for disguised profanity or threats.
- Keyword-based fallback when the ML model cannot be loaded or a prediction fails.
- A structured `allow`, `warn`, or `block` decision, with category scores.

### Application services
- **API gateway:** Express-based request routing and JWT verification.
- **User service:** Authentication-related service with PostgreSQL support.
- **Chat service:** Messaging endpoints and Socket.IO presence updates.
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
     +------ Analytics Service
     
Moderation API (FastAPI + Detoxify)
     |
     +------ Category scores
     +------ allow / warn / block
```

The moderation API is a separate service in the current repository. Check the chat service implementation and active branch before assuming requests are routed to it in the running application.

## Tech stack

| Area | Technologies |
|---|---|
| Frontend | React, Vite, Axios, Socket.IO client |
| Backend services | Node.js, Express, Socket.IO |
| Moderation | Python, FastAPI, Detoxify, PyTorch |
| Database | PostgreSQL |
| Authentication | JWT |
| Development | Git, npm, Python virtual environments |

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
.\.venv\Scripts\Activate.ps1
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

The API should be available at `http://localhost:3003`. Interactive API documentation is available at `http://localhost:3003/docs`.

### 4. Check service health

```bash
curl http://localhost:3003/health
```

### 5. Submit text for moderation

```bash
curl -X POST http://localhost:3003/moderate \
  -H "Content-Type: application/json" \
  -d '{"text":"You are very kind"}'
```

The response contains a score, a decision, and per-category scores. Model predictions are probabilistic and should not be treated as a perfect or context-aware safety judgment.

## Database and other services

The root `.env.example` documents the expected PostgreSQL connection settings, JWT secret, service ports, and service URLs. Configure local environment variables for the services you run; never commit real passwords, tokens, or secrets.

The root `schema.sql` defines the initial users, messages, and review queue tables. Review each service's README and configuration before starting the full application; the services are launched separately.

## Important limitations

- Moderation scores can produce false positives and false negatives.
- Keyword fallback is a resilience mechanism, not equivalent to the ML model.
- Thresholds require evaluation against representative examples before any real-world deployment.
- The repository should be tested end-to-end before claiming production readiness.
- Restrict CORS and secure authentication and service-to-service communication before deployment.

## Future improvements

- Add a reproducible evaluation dataset and report precision, recall, and F1 by category.
- Add automated API and integration tests.
- Document the current chat-to-moderation integration path.
- Add screenshots or a short demo of the frontend.
- Provide deployment instructions after the service configuration is validated.

## Author

**Vishakha Khetan** — [GitHub](https://github.com/kVishakhha)
