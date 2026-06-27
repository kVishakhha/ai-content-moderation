# Phase 2 — Dataset, Baseline & DistilBERT Fine-tuning

This folder contains the machine-learning experiment behind the moderation
service: a reproducible pipeline that builds a **baseline** toxicity classifier,
fine-tunes **DistilBERT** on the same data, and reports a head-to-head
comparison — the "numbers to beat" story for the report/viva.

It is self-contained and does **not** change the running moderation service
(which uses Detoxify). It produces metrics and saved models for the paper.

## What it does

| Stage | Script | Output |
|---|---|---|
| 1. Data | `prepare_data.py` | Samples + caches train/val/test to `data/*.parquet` |
| 2. Baseline | `baseline.py` | TF-IDF + Logistic Regression → `artifacts/baseline_metrics.json` |
| 3. DistilBERT | `train_distilbert.py` | Fine-tuned transformer → `artifacts/distilbert/` + metrics json |
| 4. Compare | `compare.py` | `RESULTS.md` comparison tables |

## Dataset

`Arsive/toxicity_classification_jigsaw` — an auto-downloading HuggingFace Hub
mirror of the **Jigsaw Toxic Comment Classification** dataset (no Kaggle login
required). It carries the six canonical Jigsaw labels, which map onto the
moderation service's categories:

| Jigsaw label | Service category |
|---|---|
| toxic | toxicity |
| severe_toxic | severe_toxicity |
| obscene | obscene |
| threat | threat |
| insult | insult |
| identity_hate | identity_attack |

It is a **multi-label** problem (a comment can be several at once), so the
models use a sigmoid-per-label head and we evaluate with per-label and
micro/macro-averaged precision/recall/F1.

### Sampling note
Jigsaw is large (~185k rows) and heavily imbalanced toward clean text. To keep
CPU training tractable we **stream** the dataset and draw a class-balanced
sample (default 6k train / 1k val / 3k test). Jigsaw's test split marks unscored
rows with `-1`; these are filtered out. Sizes are configurable via env vars
(`TRAIN_SAMPLE`, `TEST_SAMPLE`, `EPOCHS`, …) — see `config.py`.

## How to run

```bash
# from moderation-service/  (venv activated)
pip install -r training/requirements-train.txt

cd training
python prepare_data.py        # ~minutes (downloads + samples dataset)
python baseline.py            # ~seconds
python train_distilbert.py    # the long one — CPU fine-tuning
python compare.py             # prints + writes RESULTS.md
```

Scale the experiment up (better numbers, slower) with env vars, e.g.:

```bash
TRAIN_SAMPLE=15000 TEST_SAMPLE=5000 EPOCHS=3 python train_distilbert.py
```

## Outputs
- `data/` — cached sampled splits (parquet)
- `artifacts/baseline.joblib`, `artifacts/baseline_metrics.json`
- `artifacts/distilbert/` — fine-tuned model + tokenizer
- `artifacts/distilbert_metrics.json`
- `RESULTS.md` — the comparison tables for the report

`data/` and `artifacts/` are generated and should be git-ignored.
