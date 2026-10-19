# API Gateway

The Express gateway listens on port `3000`. REST requests are forwarded with
Axios to the service URLs configured in the root `.env` file:

| Gateway path | Upstream |
| --- | --- |
| `/auth/*` | `USER_SERVICE_URL` (for example, `http://localhost:3001/auth/*`) |
| `/chat/*` | `CHAT_SERVICE_URL` (for example, `http://localhost:3002/chat/*`) |
| `/moderation/*` | `MODERATION_SERVICE_URL` (the path is forwarded unchanged; `/moderation/moderate-content` reaches `/moderate-content`) |
| `/analytics/*` | `ANALYTICS_SERVICE_URL` (for example, `http://localhost:3004/analytics/*`) |

`POST /auth/login` and `POST /auth/register` are public. Other forwarded REST
requests require a valid bearer token; the gateway forwards the verified user
ID and role as `x-user-id` and `x-user-role`. `GET /health` is public.

The Gateway uses `http-proxy-middleware` for Socket.IO WebSocket upgrades at
`/socket.io`; Axios is used for REST forwarding, not WebSocket traffic. Chat
Service verifies the JWT in the Socket.IO handshake.

The JSON body limit defaults to `15mb` for image payloads and is shared with
Chat Service through `JSON_BODY_LIMIT`. Analytics forwarding is configured,
but the Analytics Service implementation is not present in this branch.
