# Central configuration for the Phase 2 training pipeline.
#
# Everything that controls the experiment lives here so the report can quote
# exact, reproducible settings. Most values can be overridden via environment
# variables to scale the run up (more data / epochs) or down (faster CPU demo).

import os
from pathlib import Path

# --- Paths -------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"                 # sampled train/val/test parquet files
ARTIFACTS_DIR = ROOT / "artifacts"       # saved models + metrics json
RESULTS_FILE = ROOT / "RESULTS.md"       # human-readable comparison table

DATA_DIR.mkdir(exist_ok=True)
ARTIFACTS_DIR.mkdir(exist_ok=True)

# --- Dataset -----------------------------------------------------------------
# Auto-downloading mirror of the Jigsaw Toxic Comment Classification dataset on
# the HuggingFace Hub (no Kaggle login required). It carries the six canonical
# Jigsaw labels below.
DATASET_NAME = "Arsive/toxicity_classification_jigsaw"
TEXT_COLUMN = "comment_text"

# The six toxicity labels (Jigsaw naming). LABEL_DISPLAY maps them onto the
# category names the live moderation service / Detoxify uses, for the report.
LABELS = ["toxic", "severe_toxic", "obscene", "threat", "insult", "identity_hate"]
LABEL_DISPLAY = {
    "toxic": "toxicity",
    "severe_toxic": "severe_toxicity",
    "obscene": "obscene",
    "threat": "threat",
    "insult": "insult",
    "identity_hate": "identity_attack",
}

# --- Sampling (keep CPU training tractable) ----------------------------------
# Jigsaw is large and heavily imbalanced; we sample a balanced-ish subset.
SEED = 42
SHUFFLE_BUFFER = 20000                   # streaming shuffle buffer size
TRAIN_SAMPLE = int(os.getenv("TRAIN_SAMPLE", "6000"))
VAL_SAMPLE = int(os.getenv("VAL_SAMPLE", "1000"))
TEST_SAMPLE = int(os.getenv("TEST_SAMPLE", "3000"))

# --- DistilBERT hyperparameters ----------------------------------------------
HF_MODEL = os.getenv("HF_MODEL", "distilbert-base-uncased")
MAX_LEN = int(os.getenv("MAX_LEN", "128"))
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "16"))
EPOCHS = int(os.getenv("EPOCHS", "2"))
LEARNING_RATE = float(os.getenv("LEARNING_RATE", "5e-5"))
WEIGHT_DECAY = 0.01

# Decision threshold applied to sigmoid probabilities to get binary labels.
THRESHOLD = float(os.getenv("THRESHOLD", "0.5"))
