# Analytics Service

The Analytics Service runs on port `3004` and reads the shared PostgreSQL
database. It is reachable through the API Gateway at `/analytics/*`; every API
route requires an admin JWT.

## Endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/analytics/summary` | Message totals, decision/type counts, seven-day message counts, and review totals |
| GET | `/analytics/reviews?status=pending` | List warning messages awaiting admin review (also supports `resolved` and `all`) |
| PATCH | `/analytics/reviews/:reviewId` | Resolve a pending item with `{"resolution":"confirmed"}` or `{"resolution":"dismissed"}` |

Warning messages are placed in the review queue by a PostgreSQL trigger in the
schema and migration. Allowed and blocked messages are not queued; blocked
messages remain in the chat audit log and are not delivered. Review outcomes
record admin attribution and do not rewrite the original moderation decision.

The admin UI may read non-blocked image messages through the authenticated chat
media route. Only the owning conversation participants and authenticated admins
can retrieve those image bytes.

## Run and test

Set the same `DB_*` and `JWT_SECRET` values used by the other services, then:

```sh
npm install
npm start
npm test
```

The root Compose stack builds and starts this service automatically. Existing
databases must apply `migrations/002_add_review_queue_workflow.sql` after the
image-support migration. New databases receive the trigger from `schema.sql`.
