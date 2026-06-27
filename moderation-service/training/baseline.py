# Step 2: the baseline model — the number DistilBERT has to beat.
#
# A classic, cheap, strong text-classification baseline: TF-IDF features (word
# 1-2 grams) feeding a one-vs-rest Logistic Regression, one binary classifier
# per toxicity label. class_weight="balanced" compensates for label imbalance.
# We save the fitted pipeline and its test metrics so compare.py can table it
# against the transformer.

import json

import joblib
import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.multiclass import OneVsRestClassifier
from sklearn.pipeline import Pipeline

import config as C
from metrics import compute_metrics


def main():
    train = pd.read_parquet(C.DATA_DIR / "train.parquet")
    test = pd.read_parquet(C.DATA_DIR / "test.parquet")

    X_train, y_train = train[C.TEXT_COLUMN].tolist(), train[C.LABELS].values
    X_test, y_test = test[C.TEXT_COLUMN].tolist(), test[C.LABELS].values

    pipe = Pipeline(
        [
            ("tfidf", TfidfVectorizer(max_features=20000, ngram_range=(1, 2), min_df=2)),
            (
                "clf",
                OneVsRestClassifier(
                    LogisticRegression(max_iter=1000, class_weight="balanced")
                ),
            ),
        ]
    )

    print("[baseline] fitting TF-IDF + LogisticRegression ...", flush=True)
    pipe.fit(X_train, y_train)

    # predict_proba -> (n_samples, n_labels) probability of the positive class.
    y_prob = np.asarray(pipe.predict_proba(X_test))
    metrics = compute_metrics(y_test, y_prob, C.LABELS, threshold=C.THRESHOLD)
    metrics["model"] = "TF-IDF + LogisticRegression (baseline)"

    model_path = C.ARTIFACTS_DIR / "baseline.joblib"
    metrics_path = C.ARTIFACTS_DIR / "baseline_metrics.json"
    joblib.dump(pipe, model_path)
    metrics_path.write_text(json.dumps(metrics, indent=2))

    print(
        f"[baseline] micro-F1={metrics['micro']['f1']:.4f} "
        f"macro-F1={metrics['macro']['f1']:.4f} "
        f"-> {metrics_path.name}",
        flush=True,
    )


if __name__ == "__main__":
    main()
