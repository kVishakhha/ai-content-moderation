# Phase 2 Report — Toxicity Classification: Baseline vs. DistilBERT

*Moderation component, AI Content Moderation system.*

## 1. Objective
Establish a measurable baseline for toxicity classification and quantify the
improvement from fine-tuning a transformer (DistilBERT), so the production model
choice is evidence-backed rather than assumed.

## 2. Data
- **Source:** `Arsive/toxicity_classification_jigsaw` — an auto-downloading
  HuggingFace mirror of the **Jigsaw Toxic Comment Classification** dataset
  (no Kaggle login needed; fully reproducible from `prepare_data.py`).
- **Task:** multi-label — six labels per comment: *toxicity, severe_toxicity,
  obscene, threat, insult, identity_attack* (Jigsaw naming mapped to the live
  service's categories).
- **Sampling:** Jigsaw is large (~185k rows) and heavily imbalanced toward clean
  text. We stream the dataset and draw a class-balanced sample of **6,000 train
  / 1,000 val / 3,000 test**. Jigsaw's test split marks unscored rows with `-1`;
  these are filtered. Seed fixed at 42 for reproducibility.
- **Imbalance (train positives):** toxic 2833, obscene 1536, insult 1462,
  severe_toxic 285, identity_hate 259, **threat 82**. The rare labels are the
  hard part of the problem.

## 3. Models
- **Baseline:** TF-IDF (word 1–2 grams, 20k features) → One-vs-Rest Logistic
  Regression with `class_weight="balanced"` (one binary classifier per label).
- **DistilBERT:** `distilbert-base-uncased` + a 6-way sigmoid head, fine-tuned
  with `BCEWithLogitsLoss` (multi-label), 2 epochs, batch 16, lr 5e-5, max_len
  128, on **CPU**.
- Both models are evaluated on the **identical** test split with the same
  metric function and a 0.5 decision threshold.

## 4. Results

### Overall (micro / macro averaged)
| Metric | Baseline | DistilBERT | Δ |
|---|---|---|---|
| micro-F1 | 0.721 | **0.802** | **+0.081** |
| micro-precision | 0.703 | 0.795 | +0.092 |
| micro-recall | 0.739 | 0.808 | +0.068 |
| macro-F1 | **0.589** | 0.509 | −0.080 |
| subset accuracy | 0.570 | 0.643 | +0.074 |
| Hamming loss (↓) | 0.112 | **0.078** | −0.034 |

### Per-label F1
| Label | Baseline | DistilBERT | Δ | Support |
|---|---|---|---|---|
| toxicity | 0.825 | **0.897** | +0.073 | 1473 |
| obscene | 0.742 | **0.804** | +0.062 | 895 |
| insult | 0.682 | **0.752** | +0.070 | 809 |
| severe_toxicity | 0.298 | **0.325** | +0.027 | 94 |
| identity_attack | **0.522** | 0.278 | −0.245 | 184 |
| threat | **0.467** | 0.000 | −0.467 | 52 |

## 5. Analysis — the key finding
DistilBERT is the **clear winner on overall and frequent-class metrics**:
micro-F1 +0.081, and it beats the baseline on every label with ≥800 test
examples (toxicity, obscene, insult), while nearly halving Hamming loss.

However, **macro-F1 drops** because the transformer **collapses on the rarest
labels** — most starkly `threat` (F1 0.000: at threshold 0.5 it never predicts
positive on only 82 training examples). The Logistic Regression baseline avoids
this *only* because `class_weight="balanced"` explicitly up-weights rare
positives; the DistilBERT run used unweighted loss, so the 0.5 cutoff suppresses
low-frequency classes.

**Takeaway:** micro vs. macro divergence is the story — raw transformer power
lifts the common cases, but **class imbalance must be handled explicitly** for a
moderation system, where a missed *threat* is the most costly error. This
directly motivates the production design choices.

## 6. Recommended next steps (improvements)
1. **Weighted loss:** pass `pos_weight` (inverse label frequency) to
   `BCEWithLogitsLoss` to recover rare-class recall.
2. **Per-label threshold tuning** on the validation split instead of a flat 0.5.
3. **More data / epochs** for rare labels (the sample caps were set for CPU
   speed, not accuracy).

All three are one-config changes in `config.py` / `train_distilbert.py` and
re-runnable via the documented pipeline.

## 7. Reproducibility
See `README.md`. Pipeline: `prepare_data.py → baseline.py →
train_distilbert.py → compare.py`. Raw metrics in `artifacts/*_metrics.json`;
auto-generated tables in `RESULTS.md`.
