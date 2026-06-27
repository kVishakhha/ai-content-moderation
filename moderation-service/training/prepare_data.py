# Step 1 of the pipeline: download, sample, and cache the dataset.
#
# Jigsaw is ~185k rows total and heavily imbalanced toward non-toxic comments.
# To keep CPU training tractable we stream the dataset (so we never materialise
# all 153k test rows) and draw a shuffled sample for each split. To avoid a
# trivially easy, mostly-clean sample we oversample toxic rows: we keep every
# toxic comment we stream and only keep clean comments until a target ratio is
# reached. The sampled splits are written to data/*.parquet so the baseline and
# DistilBERT scripts both train/evaluate on identical data.

import pandas as pd
from datasets import load_dataset

import config as C


def _is_toxic(row) -> bool:
    return any(int(row[l]) == 1 for l in C.LABELS)


def _sample_split(split: str, n: int, toxic_ratio: float = 0.5) -> pd.DataFrame:
    """Stream `split`, return a shuffled DataFrame of ~n rows, balanced-ish."""
    ds = load_dataset(C.DATASET_NAME, split=split, streaming=True)
    ds = ds.shuffle(seed=C.SEED, buffer_size=C.SHUFFLE_BUFFER)

    target_toxic = int(n * toxic_ratio)
    target_clean = n - target_toxic
    toxic_rows, clean_rows = [], []

    for row in ds:
        text = (row.get(C.TEXT_COLUMN) or "").strip()
        if not text:
            continue
        vals = {l: int(row[l]) for l in C.LABELS}
        # Jigsaw's test split marks unscored/unlabeled rows with -1; skip them
        # so only genuine 0/1-labeled examples enter the sample.
        if any(v not in (0, 1) for v in vals.values()):
            continue
        rec = {C.TEXT_COLUMN: text, **vals}
        if _is_toxic(row):
            if len(toxic_rows) < target_toxic:
                toxic_rows.append(rec)
        else:
            if len(clean_rows) < target_clean:
                clean_rows.append(rec)
        if len(toxic_rows) >= target_toxic and len(clean_rows) >= target_clean:
            break

    df = pd.DataFrame(toxic_rows + clean_rows)
    # Final shuffle so toxic/clean aren't blocked together.
    df = df.sample(frac=1.0, random_state=C.SEED).reset_index(drop=True)
    return df


def main():
    plan = [
        ("train", C.TRAIN_SAMPLE),
        ("validation", C.VAL_SAMPLE),
        ("test", C.TEST_SAMPLE),
    ]
    for split, n in plan:
        print(f"[prepare] sampling {n} rows from '{split}' ...", flush=True)
        df = _sample_split(split, n)
        out = C.DATA_DIR / f"{split}.parquet"
        df.to_parquet(out, index=False)
        pos = {l: int(df[l].sum()) for l in C.LABELS}
        print(f"[prepare] wrote {len(df)} rows -> {out.name} | positives={pos}", flush=True)


if __name__ == "__main__":
    main()
