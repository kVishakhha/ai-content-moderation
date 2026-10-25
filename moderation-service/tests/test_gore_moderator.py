import unittest
from unittest.mock import patch

from PIL import Image

from app.gore_moderator import GoreModelError, moderate_gore


class GoreModeratorTests(unittest.TestCase):
    def test_low_nsfl_score_is_not_detected(self):
        with patch("app.gore_moderator._get_classifier", return_value=lambda image: [
            {"label": "NSFL", "score": 0.04}
        ]):
            result = moderate_gore(Image.new("RGB", (4, 4)))
        self.assertEqual(result, {"detected": False, "confidence": 0.04, "category": "gore"})

    def test_transformers_generic_labels_use_model_class_order(self):
        with patch("app.gore_moderator._get_classifier", return_value=lambda image: [
            {"label": "LABEL_0", "score": 0.96},
            {"label": "LABEL_1", "score": 0.03},
            {"label": "LABEL_2", "score": 0.01},
        ]):
            result = moderate_gore(Image.new("RGB", (4, 4)))
        self.assertEqual(result, {"detected": True, "confidence": 0.96, "category": "gore"})

    def test_high_nsfl_score_is_detected(self):
        with patch("app.gore_moderator._get_classifier", return_value=lambda image: [
            {"label": "NSFL", "score": 0.96}
        ]):
            result = moderate_gore(Image.new("RGB", (4, 4)))
        self.assertEqual(result, {"detected": True, "confidence": 0.96, "category": "gore"})

    def test_malformed_model_output_fails_closed(self):
        with patch("app.gore_moderator._get_classifier", return_value=lambda image: [{"label": "SFW", "score": .99}]), \
             self.assertRaises(GoreModelError):
            moderate_gore(Image.new("RGB", (4, 4)))

    def test_unavailable_model_fails_closed(self):
        with patch("app.gore_moderator._get_classifier", side_effect=GoreModelError("offline")), \
             self.assertRaises(GoreModelError):
            moderate_gore(Image.new("RGB", (4, 4)))


if __name__ == "__main__":
    unittest.main()
