"""
Diagnostic: print the full Detoxify category scores for a fixed set of phrases.

Run from the moderation-service folder with the project venv:
    .venv\\Scripts\\python.exe scripts\\inspect_scores.py

Used to tune the per-category thresholds in decision_engine.py against the
actual numbers produced by this exact model instance (original-small).
"""

from detoxify import Detoxify

TEXTS = [
    "hello there",
    "you are ugly",
    "shut up loser",
    "fuck off",
    "you are stupid",
    "i will kill you",
    "kill him",
    "i hate maths",
    "this exam is killing me",
    "let's kill the exam tomorrow",
    "shut up",
]

# Column order requested in the brief.
COLS = ("toxicity", "severe_toxicity", "obscene", "insult", "threat", "identity_attack")


def main() -> None:
    model = Detoxify("original-small")

    # Header
    header = f"{'text':<32} | " + " | ".join(f"{c:<15}" for c in COLS)
    print(header)
    print("-" * len(header))

    for text in TEXTS:
        scores = model.predict(text)
        cells = " | ".join(f"{float(scores.get(c, 0.0)):<15.3f}" for c in COLS)
        print(f"{text:<32} | {cells}")


if __name__ == "__main__":
    main()
