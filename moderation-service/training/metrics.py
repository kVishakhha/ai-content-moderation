# Shared multi-label evaluation metrics.
#
# Both the baseline and the DistilBERT model are scored with the exact same
# function so the comparison in RESULTS.md is apples-to-apples. We report the
# metrics that matter for a moderation classifier: per-label precision / recall
# / F1 (recall matters most — a missed threat is worse than a false flag),
# micro and macro averages, ROC-AUC, plus subset-accuracy and Hamming loss.

from typing import Dict, List

import numpy as np
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    hamming_loss,
    precision_score,
    recall_score,
    roc_auc_score,
)


def compute_metrics(
    y_true: np.ndarray, y_prob: np.ndarray, labels: List[str], threshold: float = 0.5
) -> Dict:
    """y_true/y_prob: (n_samples, n_labels). Returns a JSON-serialisable dict."""
    y_true = np.asarray(y_true, dtype=int)
    y_prob = np.asarray(y_prob, dtype=float)
    y_pred = (y_prob >= threshold).astype(int)

    per_label = {}
    for i, name in enumerate(labels):
        t, p, pr = y_true[:, i], y_pred[:, i], y_prob[:, i]
        # ROC-AUC is undefined if a label has only one class in the test slice.
        try:
            auc = float(roc_auc_score(t, pr)) if len(np.unique(t)) > 1 else None
        except ValueError:
            auc = None
        per_label[name] = {
            "precision": float(precision_score(t, p, zero_division=0)),
            "recall": float(recall_score(t, p, zero_division=0)),
            "f1": float(f1_score(t, p, zero_division=0)),
            "roc_auc": auc,
            "support": int(t.sum()),
        }

    return {
        "threshold": threshold,
        "per_label": per_label,
        "micro": {
            "precision": float(precision_score(y_true, y_pred, average="micro", zero_division=0)),
            "recall": float(recall_score(y_true, y_pred, average="micro", zero_division=0)),
            "f1": float(f1_score(y_true, y_pred, average="micro", zero_division=0)),
        },
        "macro": {
            "precision": float(precision_score(y_true, y_pred, average="macro", zero_division=0)),
            "recall": float(recall_score(y_true, y_pred, average="macro", zero_division=0)),
            "f1": float(f1_score(y_true, y_pred, average="macro", zero_division=0)),
        },
        "subset_accuracy": float(accuracy_score(y_true, y_pred)),
        "hamming_loss": float(hamming_loss(y_true, y_pred)),
        "n_samples": int(y_true.shape[0]),
    }
