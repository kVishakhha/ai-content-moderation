"""End-to-end checks for the existing text and image moderation endpoints.

The service currently exposes independent /moderate and /moderate-image routes;
this test submits both requests for each scenario and combines their decisions
using the restrictive decision returned by either route. It does not introduce
or imply a new production endpoint or alter either route's decision policy.
"""
import base64
import os
from pathlib import Path
import unittest

from fastapi.testclient import TestClient

from app.main import app


IMAGE_ROOT = Path(os.environ.get(
    "WEAPON_TEST_IMAGES", r"C:\Users\meeta\Downloads\weapon-tests"
))
DECISION_RANK = {"allow": 0, "warn": 1, "block": 2}


class FullModerationEndToEndTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def moderate_text_and_image(self, text, image_name):
        image_path = IMAGE_ROOT / image_name
        self.assertTrue(image_path.is_file(), f"Missing supplied test image: {image_path}")
        text_response = self.client.post("/moderate", json={"text": text})
        self.assertEqual(text_response.status_code, 200, text_response.text)
        image_response = self.client.post("/moderate-image", json={
            "image_base64": base64.b64encode(image_path.read_bytes()).decode("ascii"),
            "mime_type": "image/jpeg",
        })
        self.assertEqual(image_response.status_code, 200, image_response.text)
        text_result = text_response.json()
        image_result = image_response.json()
        combined_decision = max(
            (text_result["decision"], image_result["decision"]),
            key=DECISION_RANK.__getitem__,
        )
        return text_result, image_result, combined_decision

    def assert_weapon_sample(self, image_name, expected_label, expected_decision):
        text, image, combined = self.moderate_text_and_image("hello there", image_name)
        self.assertEqual(text["decision"], "allow")
        self.assertTrue(image["categories"]["weapons"]["detected"])
        detections = image["categories"]["weapons"]["detections"]
        self.assertTrue(detections)
        self.assertIn(expected_label.casefold(), {d["label"].casefold() for d in detections})
        self.assertEqual(image["decision"], expected_decision)
        self.assertEqual(combined, expected_decision)
        # Independently verify the observed weapon confidence justifies the API decision.
        strongest_weapon = max(d["confidence"] for d in detections)
        expected_from_confidence = (
            "block" if strongest_weapon >= 0.70 else
            "warn" if strongest_weapon >= 0.40 else
            "allow"
        )
        self.assertEqual(image["decision"], expected_from_confidence)
        return image

    def test_safe_text_and_normal_image_allow(self):
        text, image, combined = self.moderate_text_and_image("hello there", "normal1.jpg")
        self.assertEqual(text["decision"], "allow")
        self.assertEqual(image["decision"], "allow")
        self.assertFalse(image["categories"]["weapons"]["detected"])
        self.assertEqual(combined, "allow")

    def test_safe_text_and_gun_image_follow_weapon_threshold(self):
        self.assert_weapon_sample("gun.jpg", "Gun", "block")

    def test_safe_text_and_grenade_image_block(self):
        self.assert_weapon_sample("garnade2.jpg", "Grenade", "block")

    def test_safe_text_and_knife_images_follow_confidence(self):
        self.assert_weapon_sample("knife1.jpg", "Knife", "warn")
        self.assert_weapon_sample("knife2.jpg", "Knife", "block")

    def test_safe_text_and_pistol_images_follow_confidence(self):
        self.assert_weapon_sample("pistol1.jpg", "Pistol", "block")
        # The second supplied pistol sample currently resolves to the model's Gun class.
        self.assert_weapon_sample("pistol2.jpg", "Gun", "warn")

    def test_harmful_text_and_normal_image_use_text_decision(self):
        text, image, combined = self.moderate_text_and_image("kill him", "normal1.jpg")
        self.assertEqual(text["decision"], "block")
        self.assertEqual(image["decision"], "allow")
        self.assertEqual(combined, "block")

    def test_harmful_text_and_weapon_image_combine_to_block(self):
        text, image, combined = self.moderate_text_and_image("kill him", "gun.jpg")
        self.assertEqual(text["decision"], "block")
        self.assertTrue(image["categories"]["weapons"]["detected"])
        self.assertEqual(image["decision"], "block")
        self.assertEqual(combined, "block")

    def test_normal_text_and_normal_image_allow(self):
        text, image, combined = self.moderate_text_and_image("A pleasant day outside.", "normal1.jpg")
        self.assertEqual(text["decision"], "allow")
        self.assertEqual(image["decision"], "allow")
        self.assertEqual(combined, "allow")


if __name__ == "__main__":
    unittest.main()

