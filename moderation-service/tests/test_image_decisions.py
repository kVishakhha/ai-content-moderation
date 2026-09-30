import io
import unittest
from unittest.mock import patch

from PIL import Image

from app.image_moderator import InvalidImageError, ImageModelError, moderate_image_bytes
from app.image_decision_engine import decide_image


def png_bytes():
    image = Image.new("RGB", (8, 8), color="white")
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


class ImageDecisionTests(unittest.TestCase):
    def test_safe_synthetic_image_returns_model_categories(self):
        with patch("app.image_moderator._get_classifier", return_value=lambda image: [
            {"label": "normal", "score": 0.98}, {"label": "nsfw", "score": 0.02}
        ]):
            result = moderate_image_bytes(png_bytes())
        self.assertEqual(result["decision"], "allow")
        self.assertEqual(set(result["categories"]), {"normal", "nsfw"})

    def test_corrupt_empty_and_unsupported_data_rejected(self):
        for data in (b"not an image", b""):
            with self.subTest(data=data), self.assertRaises(InvalidImageError):
                moderate_image_bytes(data)

    def test_thresholds(self):
        self.assertEqual(decide_image(0.49), "allow")
        self.assertEqual(decide_image(0.50), "warn")
        self.assertEqual(decide_image(0.84), "warn")
        self.assertEqual(decide_image(0.85), "block")

    def test_model_failure_fails_closed(self):
        with patch("app.image_moderator._get_classifier", side_effect=ImageModelError("offline")):
            with self.assertRaises(ImageModelError):
                moderate_image_bytes(png_bytes())

    def test_unsupported_decoded_format_rejected(self):
        output = io.BytesIO()
        Image.new("RGB", (4, 4)).save(output, format="TIFF")
        with self.assertRaises(InvalidImageError):
            moderate_image_bytes(output.getvalue())


if __name__ == "__main__":
    unittest.main()
