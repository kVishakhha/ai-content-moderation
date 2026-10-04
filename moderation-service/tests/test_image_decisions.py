import io
import unittest
from unittest.mock import patch

from PIL import Image

from app.image_moderator import InvalidImageError, ImageModelError, moderate_image_bytes
from app.weapon_moderator import WeaponModelError
from app.combined_image_decision_engine import decide_combined_image


def png_bytes():
    image = Image.new("RGB", (8, 8), color="white")
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


class ImageDecisionTests(unittest.TestCase):
    def run_moderation(self, nsfw=0.02, detections=None):
        detections = detections or []
        classifier = lambda image: [
            {"label": "normal", "score": 1 - nsfw}, {"label": "nsfw", "score": nsfw}
        ]
        weapons = {"detected": bool(detections), "detections": detections}
        with patch("app.image_moderator._get_classifier", return_value=classifier), \
             patch("app.image_moderator.moderate_weapons", return_value=weapons):
            return moderate_image_bytes(png_bytes())

    def test_safe_synthetic_image_mocks_both_models(self):
        result = self.run_moderation()
        self.assertEqual(result["decision"], "allow")
        self.assertEqual(set(result["categories"]), {"normal", "nsfw", "weapons"})
        self.assertFalse(result["categories"]["weapons"]["detected"])

    def test_no_weapon_detection(self):
        self.assertEqual(self.run_moderation()["decision"], "allow")

    def test_gun_at_block_threshold(self):
        result = self.run_moderation(detections=[{"label": "gun", "confidence": 0.70}])
        self.assertEqual(result["decision"], "block")

    def test_gun_in_warning_range(self):
        result = self.run_moderation(detections=[{"label": "gun", "confidence": 0.55}])
        self.assertEqual(result["decision"], "warn")

    def test_knife_detection(self):
        result = self.run_moderation(detections=[{"label": "knife", "confidence": 0.4}])
        self.assertEqual(result["decision"], "warn")
        self.assertEqual(result["categories"]["weapons"]["detections"][0]["label"], "knife")

    def test_multiple_weapon_detections(self):
        detections = [{"label": "knife", "confidence": 0.42}, {"label": "gun", "confidence": 0.72}]
        result = self.run_moderation(detections=detections)
        self.assertEqual(result["decision"], "block")
        self.assertEqual(len(result["categories"]["weapons"]["detections"]), 2)

    def test_nsfw_and_weapon_combination(self):
        result = self.run_moderation(nsfw=0.50, detections=[{"label": "unknown-trained-class", "confidence": 0.41}])
        self.assertEqual(result["decision"], "warn")

    def test_corrupt_empty_and_unsupported_data_rejected(self):
        for data in (b"not an image", b""):
            with self.subTest(data=data), self.assertRaises(InvalidImageError):
                moderate_image_bytes(data)

    def test_combined_threshold_precedence(self):
        empty = {"detected": False, "detections": []}
        self.assertEqual(decide_combined_image(0.49, empty)[0], "allow")
        self.assertEqual(decide_combined_image(0.50, empty)[0], "warn")
        self.assertEqual(decide_combined_image(0.85, empty)[0], "block")
        self.assertEqual(decide_combined_image(0.01, {"detected": True, "detections": [{"label": "gun", "confidence": .7}]})[0], "block")
        self.assertEqual(decide_combined_image(0.01, {"detected": True, "detections": [{"label": "gun", "confidence": .4}]})[0], "warn")

    def test_model_failure_fails_closed(self):
        with patch("app.image_moderator._get_classifier", side_effect=ImageModelError("offline")):
            with self.assertRaises(ImageModelError):
                moderate_image_bytes(png_bytes())

    def test_missing_weapon_model_fails_clearly(self):
        with patch("app.image_moderator._get_classifier", return_value=lambda image: [
            {"label": "normal", "score": .99}, {"label": "nsfw", "score": .01}
        ]), patch("app.image_moderator.moderate_weapons", side_effect=WeaponModelError("weights missing")):
            with self.assertRaisesRegex(WeaponModelError, "weights missing"):
                moderate_image_bytes(png_bytes())

    def test_unsupported_decoded_format_rejected(self):
        output = io.BytesIO()
        Image.new("RGB", (4, 4)).save(output, format="TIFF")
        with self.assertRaises(InvalidImageError):
            moderate_image_bytes(output.getvalue())


if __name__ == "__main__":
    unittest.main()
