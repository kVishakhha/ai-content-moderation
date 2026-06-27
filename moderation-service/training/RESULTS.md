# Phase 2 — Model Evaluation Results

Dataset: `Arsive/toxicity_classification_jigsaw` (auto-downloaded Jigsaw mirror, 6 labels). Test samples: 3000. Decision threshold: 0.5.

## Overall (micro / macro averaged)

| Metric | Baseline (TF-IDF + LogReg) | DistilBERT (fine-tuned) | Δ |
|---|---|---|---|
| micro-precision | 0.703 | 0.795 | +0.092 |
| micro-recall | 0.739 | 0.808 | +0.068 |
| micro-f1 | 0.721 | 0.802 | +0.081 |
| macro-precision | 0.558 | 0.620 | +0.062 |
| macro-recall | 0.659 | 0.497 | -0.162 |
| macro-f1 | 0.589 | 0.509 | -0.080 |
| subset accuracy | 0.570 | 0.643 | +0.074 |
| hamming loss (lower=better) | 0.112 | 0.078 | -0.034 |

## Per-label F1

| Label | Baseline F1 | DistilBERT F1 | Δ | Test support |
|---|---|---|---|---|
| toxicity | 0.825 | 0.897 | +0.073 | 1473 |
| severe_toxicity | 0.298 | 0.325 | +0.027 | 94 |
| obscene | 0.742 | 0.804 | +0.062 | 895 |
| threat | 0.467 | 0.000 | -0.467 | 52 |
| insult | 0.682 | 0.752 | +0.070 | 809 |
| identity_attack | 0.522 | 0.278 | -0.245 | 184 |

## Per-label recall (missed-harm rate matters most)

| Label | Baseline recall | DistilBERT recall | Δ |
|---|---|---|---|
| toxicity | 0.807 | 0.965 | +0.158 |
| severe_toxicity | 0.585 | 0.266 | -0.319 |
| obscene | 0.715 | 0.828 | +0.113 |
| threat | 0.538 | 0.000 | -0.538 |
| insult | 0.705 | 0.760 | +0.056 |
| identity_attack | 0.603 | 0.163 | -0.440 |

**Headline:** DistilBERT moves micro-F1 by **+0.081** (0.721 → 0.802) over the baseline (DistilBERT trained 2 epochs on 6000 samples).
