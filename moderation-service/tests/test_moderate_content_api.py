"""End-to-end tests for the combined text and image moderation API."""
import base64
import os
from pathlib import Path
import unittest

from fastapi.testclient import TestClient

from app.combined_image_decision_engine import WEAPON_BLOCK_THRESHOLD, WEAPON_WARN_THRESHOLD
from app.main import app


IMAGE_ROOT = Path(os.environ.get(
    "WEAPON_TEST_IMAGES", r"C:\Users\meeta\Downloads\weapon-tests"
))


class ModerateContentEndToEndTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def post_content(self, text=None, image_name=None):
        payload = {}
        if text is not None:
            payload["text"] = text
        if image_name is not None:
            image_path = IMAGE_ROOT / image_name
            self.assertTrue(image_path.is_file(), f"Missing supplied test image: {image_path}")
            payload["image_base64"] = base64.b64encode(image_path.read_bytes()).decode("ascii")
            payload["mime_type"] = "image/jpeg"
        response = self.client.post("/moderate-content", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def assert_image_decision(self, result, decision, expected_label=None):
        image = result["image"]
        self.assertIsNotNone(image)
        self.assertEqual(image["decision"], decision)
        self.assertEqual(result["decision"], decision)
        weapons = image["categories"]["weapons"]
        if expected_label is None:
            self.assertFalse(weapons["detected"])
        else:
            self.assertTrue(weapons["detected"])
            self.assertIn(expected_label.casefold(), {
                detection["label"].casefold() for detection in weapons["detections"]
            })
            max_confidence = max(d["confidence"] for d in weapons["detections"])
            expected_from_confidence = (
                "block" if max_confidence >= WEAPON_BLOCK_THRESHOLD else
                "warn" if max_confidence >= WEAPON_WARN_THRESHOLD else
                "allow"
            )
            self.assertEqual(decision, expected_from_confidence)
        self.assertIn("nsfw", image["categories"])
        self.assertLessEqual(result["score"], 1.0)

    def test_safe_text_only_allows(self):
        result = self.post_content(text="hello there")
        self.assertEqual(result["decision"], "allow")
        self.assertEqual(result["text"]["decision"], "allow")
        self.assertIsNone(result["image"])

    def test_harmful_text_only_blocks(self):
        result = self.post_content(text="kill him")
        self.assertEqual(result["decision"], "block")
        self.assertEqual(result["text"]["decision"], "block")
        self.assertIsNone(result["image"])

    def test_normal_image_only_allows(self):
        result = self.post_content(image_name="normal1.jpg")
        self.assertIsNone(result["text"])
        self.assert_image_decision(result, "allow")

    def test_gun_image_only_uses_weapon_decision(self):
        result = self.post_content(image_name="gun.jpg")
        self.assert_image_decision(result, "block", "Gun")

    def test_safe_text_with_gun_image_uses_weapon_decision(self):
        result = self.post_content(text="hello there", image_name="gun.jpg")
        self.assertEqual(result["text"]["decision"], "allow")
        self.assert_image_decision(result, "block", "Gun")

    def test_harmful_text_with_normal_image_uses_text_decision(self):
        result = self.post_content(text="kill him", image_name="normal1.jpg")
        self.assertEqual(result["text"]["decision"], "block")
        self.assertEqual(result["image"]["decision"], "allow")
        self.assertEqual(result["decision"], "block")

    def test_harmful_text_with_gun_image_blocks(self):
        result = self.post_content(text="kill him", image_name="gun.jpg")
        self.assertEqual(result["text"]["decision"], "block")
        self.assert_image_decision(result, "block", "Gun")

    def test_safe_text_with_grenade_image_blocks(self):
        result = self.post_content(text="hello there", image_name="garnade2.jpg")
        self.assertEqual(result["text"]["decision"], "allow")
        self.assert_image_decision(result, "block", "Grenade")

    def test_safe_text_with_knife1_warns(self):
        result = self.post_content(text="hello there", image_name="knife1.jpg")
        self.assert_image_decision(result, "warn", "Knife")

    def test_safe_text_with_knife2_blocks(self):
        result = self.post_content(text="hello there", image_name="knife2.jpg")
        self.assert_image_decision(result, "block", "Knife")

    def test_safe_text_with_pistol1_blocks(self):
        result = self.post_content(text="hello there", image_name="pistol1.jpg")
        self.assert_image_decision(result, "block", "Pistol")

    def test_safe_text_with_pistol2_warns(self):
        result = self.post_content(text="hello there", image_name="pistol2.jpg")
        # Current weights classify this supplied pistol sample as Gun.
        self.assert_image_decision(result, "warn", "Gun")


if __name__ == "__main__":
    unittest.main()
