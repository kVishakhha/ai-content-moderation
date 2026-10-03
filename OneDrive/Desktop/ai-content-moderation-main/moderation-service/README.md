# Moderation Service

FastAPI service that scores text toxicity and returns an `allow` / `warn` / `block`
decision. Scoring uses a small distilled-BERT model via [`detoxify`](https://github.com/unitaryai/detoxify),
with a keyword fallback if the model weights can't be loaded.

## Install

```bash
pip install -r requirements.txt
```

## Run

```bash
uvicorn app.main:app --host 0.0.0.0 --port 3003 --reload
```

> First startup downloads ~250MB of model weights. If that download fails, the
> service still runs using the keyword fallback.

## Example

```bash
curl -X POST http://localhost:3003/moderate -H "Content-Type: application/json" -d "{\"text\": \"i will kill you\"}"
# -> {"score": 0.97, "decision": "block", "categories": null}
```
