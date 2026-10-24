import unittest
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import patch

from app import text_model
from app.decision_engine import decide_distilbert
from fastapi.testclient import TestClient
from app.main import app


class FakeTokenizer:
    def __call__(self, text, **kwargs):
        return {
            "input_ids": FakeTensor([1, 2]),
            "attention_mask": FakeTensor([1, 1]),
        }


class FakeTensor:
    def __init__(self, values):
        self.values = values
        self.device = "cpu"

    def to(self, _device):
        return self

    def __getitem__(self, index):
        return FakeTensor(self.values[index])

    def cpu(self):
        return self

    def tolist(self):
        return self.values

    def sigmoid(self):
        import math

        return FakeTensor([1 / (1 + math.exp(-value)) for value in self.values])


class FakeModelConfig:
    id2label = {
        0: "toxic",
        1: "severe_toxic",
        2: "obscene",
        3: "threat",
        4: "insult",
        5: "identity_hate",
    }


class FakeModel:
    config = FakeModelConfig()

    def eval(self):
        return self

    def to(self, _device):
        return self

    def parameters(self):
        yield SimpleNamespace(device="cpu")

    def __call__(self, **_kwargs):
        return SimpleNamespace(logits=FakeTensor([[0.0, 1.0, 2.0, 3.0, 4.0, 5.0]]))


class DistilBertScoringTests(unittest.TestCase):
    def setUp(self):
        text_model._backend = None
        text_model._model = None
        text_model._tokenizer = None

    def tearDown(self):
        text_model._backend = None
        text_model._model = None
        text_model._tokenizer = None

    @patch.dict("os.environ", {"TEXT_MODEL_BACKEND": "distilbert"})
    @patch("pathlib.Path.is_dir", return_value=False)
    def test_distilbert_scores_map_to_live_category_names(self, _is_dir):
        transformer_stub = SimpleNamespace(
            AutoTokenizer=SimpleNamespace(
                from_pretrained=lambda *_args, **_kwargs: FakeTokenizer()
            ),
            AutoModelForSequenceClassification=SimpleNamespace(
                from_pretrained=lambda *_args, **_kwargs: FakeModel()
            ),
        )
        torch_stub = SimpleNamespace(
            device=lambda name: name,
            cuda=SimpleNamespace(is_available=lambda: False),
            inference_mode=nullcontext,
            sigmoid=lambda tensor: tensor.sigmoid(),
        )
        with patch.dict("sys.modules", {"transformers": transformer_stub, "torch": torch_stub}):
            scores = text_model.score_text("ordinary message")

        self.assertEqual(
            set(scores),
            {
                "toxicity",
                "severe_toxicity",
                "obscene",
                "threat",
                "insult",
                "identity_attack",
            },
        )
        self.assertAlmostEqual(scores["threat"], 0.952574, places=6)
        self.assertAlmostEqual(scores["identity_attack"], 0.993307, places=6)

    @patch.dict("os.environ", {"TEXT_MODEL_BACKEND": "unknown"})
    def test_unsupported_backend_raises_instead_of_using_keyword_fallback(self):
        with self.assertRaises(text_model.TextModelError):
            text_model.score_text("ordinary message")

    @patch.dict("os.environ", {
        "DISTILBERT_WARN_THRESHOLD": "0.3",
        "DISTILBERT_BLOCK_THRESHOLD": "0.5",
    })
    def test_distilbert_decisions_use_their_own_configurable_thresholds(self):
        self.assertEqual(decide_distilbert({"threat": 0.2, "toxicity": 0.29}), (0.29, "allow"))
        self.assertEqual(decide_distilbert({"threat": 0.31, "toxicity": 0.1}), (0.31, "warn"))
        self.assertEqual(decide_distilbert({"threat": 0.51, "toxicity": 0.1}), (0.51, "block"))

    @patch("app.main.score_text", side_effect=text_model.TextModelError("model unavailable"))
    def test_distilbert_unavailable_fails_closed_with_service_unavailable(self, _score_text):
        response = TestClient(app).post("/moderate", json={"text": "hello"})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"], "Text moderation is unavailable")


if __name__ == "__main__":
    unittest.main()
