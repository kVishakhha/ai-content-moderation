# Step 3: fine-tune DistilBERT for multi-label toxicity classification.
#
# distilbert-base-uncased + a 6-way sigmoid classification head, trained with
# BCEWithLogitsLoss (multi-label, not multi-class). We use a plain PyTorch loop
# rather than the Trainer API so the script is robust across transformers
# versions and easy to follow on CPU. The fine-tuned model + tokenizer are saved
# to artifacts/distilbert and its test metrics to artifacts/distilbert_metrics.json.

import json

import numpy as np
import pandas as pd
import torch
from torch.utils.data import DataLoader, Dataset
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    get_linear_schedule_with_warmup,
)

import config as C
from metrics import compute_metrics

torch.manual_seed(C.SEED)
np.random.seed(C.SEED)
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")


class ToxicDataset(Dataset):
    def __init__(self, df, tokenizer):
        self.texts = df[C.TEXT_COLUMN].tolist()
        self.labels = df[C.LABELS].values.astype("float32")
        self.tok = tokenizer

    def __len__(self):
        return len(self.texts)

    def __getitem__(self, i):
        enc = self.tok(
            self.texts[i],
            truncation=True,
            padding="max_length",
            max_length=C.MAX_LEN,
            return_tensors="pt",
        )
        return {
            "input_ids": enc["input_ids"].squeeze(0),
            "attention_mask": enc["attention_mask"].squeeze(0),
            "labels": torch.tensor(self.labels[i]),
        }


@torch.no_grad()
def predict_probs(model, loader):
    model.eval()
    probs = []
    for batch in loader:
        logits = model(
            input_ids=batch["input_ids"].to(DEVICE),
            attention_mask=batch["attention_mask"].to(DEVICE),
        ).logits
        probs.append(torch.sigmoid(logits).cpu().numpy())
    return np.vstack(probs)


def main():
    print(f"[distilbert] device={DEVICE} model={C.HF_MODEL}", flush=True)
    train = pd.read_parquet(C.DATA_DIR / "train.parquet")
    test = pd.read_parquet(C.DATA_DIR / "test.parquet")

    tokenizer = AutoTokenizer.from_pretrained(C.HF_MODEL)
    model = AutoModelForSequenceClassification.from_pretrained(
        C.HF_MODEL,
        num_labels=len(C.LABELS),
        problem_type="multi_label_classification",
        id2label={i: l for i, l in enumerate(C.LABELS)},
        label2id={l: i for i, l in enumerate(C.LABELS)},
    ).to(DEVICE)

    train_loader = DataLoader(
        ToxicDataset(train, tokenizer), batch_size=C.BATCH_SIZE, shuffle=True
    )
    test_loader = DataLoader(
        ToxicDataset(test, tokenizer), batch_size=C.BATCH_SIZE, shuffle=False
    )

    optimizer = torch.optim.AdamW(
        model.parameters(), lr=C.LEARNING_RATE, weight_decay=C.WEIGHT_DECAY
    )
    total_steps = len(train_loader) * C.EPOCHS
    scheduler = get_linear_schedule_with_warmup(
        optimizer, num_warmup_steps=int(0.1 * total_steps), num_training_steps=total_steps
    )

    for epoch in range(1, C.EPOCHS + 1):
        model.train()
        running = 0.0
        for step, batch in enumerate(train_loader, 1):
            optimizer.zero_grad()
            out = model(
                input_ids=batch["input_ids"].to(DEVICE),
                attention_mask=batch["attention_mask"].to(DEVICE),
                labels=batch["labels"].to(DEVICE),
            )
            out.loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()
            running += out.loss.item()
            if step % 25 == 0 or step == len(train_loader):
                print(
                    f"[distilbert] epoch {epoch}/{C.EPOCHS} "
                    f"step {step}/{len(train_loader)} avg_loss={running/step:.4f}",
                    flush=True,
                )

    print("[distilbert] evaluating on test split ...", flush=True)
    y_prob = predict_probs(model, test_loader)
    y_test = test[C.LABELS].values
    metrics = compute_metrics(y_test, y_prob, C.LABELS, threshold=C.THRESHOLD)
    metrics["model"] = f"{C.HF_MODEL} (fine-tuned)"
    metrics["epochs"] = C.EPOCHS
    metrics["train_samples"] = len(train)

    out_dir = C.ARTIFACTS_DIR / "distilbert"
    model.save_pretrained(out_dir)
    tokenizer.save_pretrained(out_dir)
    (C.ARTIFACTS_DIR / "distilbert_metrics.json").write_text(json.dumps(metrics, indent=2))

    print(
        f"[distilbert] micro-F1={metrics['micro']['f1']:.4f} "
        f"macro-F1={metrics['macro']['f1']:.4f} -> distilbert_metrics.json",
        flush=True,
    )


if __name__ == "__main__":
    main()
