# Step 4: build the baseline-vs-DistilBERT comparison and write RESULTS.md.
#
# Reads the two metrics json files and produces a markdown report with an
# overall comparison table and a per-label F1 breakdown — the "numbers to beat"
# story for the paper/viva.

import json

import config as C


def _load(name):
    path = C.ARTIFACTS_DIR / name
    if not path.exists():
        return None
    return json.loads(path.read_text())


def _row(label, b, d):
    return f"| {label} | {b:.3f} | {d:.3f} | {d - b:+.3f} |"


def main():
    base = _load("baseline_metrics.json")
    bert = _load("distilbert_metrics.json")
    if not base or not bert:
        raise SystemExit("Run baseline.py and train_distilbert.py first.")

    lines = []
    lines.append("# Phase 2 — Model Evaluation Results\n")
    lines.append(
        f"Dataset: `{C.DATASET_NAME}` (auto-downloaded Jigsaw mirror, 6 labels). "
        f"Test samples: {bert['n_samples']}. Decision threshold: {C.THRESHOLD}.\n"
    )

    lines.append("## Overall (micro / macro averaged)\n")
    lines.append("| Metric | Baseline (TF-IDF + LogReg) | DistilBERT (fine-tuned) | Δ |")
    lines.append("|---|---|---|---|")
    for avg in ("micro", "macro"):
        for m in ("precision", "recall", "f1"):
            b, d = base[avg][m], bert[avg][m]
            lines.append(f"| {avg}-{m} | {b:.3f} | {d:.3f} | {d - b:+.3f} |")
    lines.append(
        _row("subset accuracy", base["subset_accuracy"], bert["subset_accuracy"])
    )
    # Lower Hamming loss is better — note that in the report.
    lines.append(
        f"| hamming loss (lower=better) | {base['hamming_loss']:.3f} | "
        f"{bert['hamming_loss']:.3f} | {bert['hamming_loss'] - base['hamming_loss']:+.3f} |\n"
    )

    lines.append("## Per-label F1\n")
    lines.append("| Label | Baseline F1 | DistilBERT F1 | Δ | Test support |")
    lines.append("|---|---|---|---|---|")
    for l in C.LABELS:
        disp = C.LABEL_DISPLAY.get(l, l)
        b = base["per_label"][l]["f1"]
        d = bert["per_label"][l]["f1"]
        sup = bert["per_label"][l]["support"]
        lines.append(f"| {disp} | {b:.3f} | {d:.3f} | {d - b:+.3f} | {sup} |")

    lines.append("\n## Per-label recall (missed-harm rate matters most)\n")
    lines.append("| Label | Baseline recall | DistilBERT recall | Δ |")
    lines.append("|---|---|---|---|")
    for l in C.LABELS:
        disp = C.LABEL_DISPLAY.get(l, l)
        b = base["per_label"][l]["recall"]
        d = bert["per_label"][l]["recall"]
        lines.append(f"| {disp} | {b:.3f} | {d:.3f} | {d - b:+.3f} |")

    delta_f1 = bert["micro"]["f1"] - base["micro"]["f1"]
    lines.append(
        f"\n**Headline:** DistilBERT moves micro-F1 by **{delta_f1:+.3f}** "
        f"({base['micro']['f1']:.3f} → {bert['micro']['f1']:.3f}) over the baseline "
        f"(DistilBERT trained {bert.get('epochs', '?')} epochs on "
        f"{bert.get('train_samples', '?')} samples).\n"
    )

    C.RESULTS_FILE.write_text("\n".join(lines), encoding="utf-8")
    print(f"[compare] wrote {C.RESULTS_FILE}")
    # Console-safe summary (avoid non-ASCII like the delta glyph on cp1252).
    print(
        f"[compare] micro-F1  baseline={base['micro']['f1']:.3f}  "
        f"distilbert={bert['micro']['f1']:.3f}"
    )
    print(
        f"[compare] macro-F1  baseline={base['macro']['f1']:.3f}  "
        f"distilbert={bert['macro']['f1']:.3f}"
    )


if __name__ == "__main__":
    main()
