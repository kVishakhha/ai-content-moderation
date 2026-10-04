import base64
import io
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from app.weapon_moderator import WeaponModelError


def png_bytes():
    stream = io.BytesIO()
    Image.new("RGB", (8, 8), "white").save(stream, format="PNG")
    return stream.getvalue()


class ModerateImageIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.payload = {"image_base64": base64.b64encode(png_bytes()).decode(), "mime_type": "image/png"}

    def test_valid_image_and_both_mocked_models_returns_200(self):
        with patch("app.image_moderator._get_classifier", return_value=lambda image: [
            {"label": "normal", "score": .99}, {"label": "nsfw", "score": .01}
        ]), patch("app.image_moderator.moderate_weapons", return_value={"detected": False, "detections": []}):
            response = self.client.post("/moderate-image", json=self.payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["decision"], "allow")

    def test_weapon_detection_blocks_and_is_returned(self):
        with patch("app.image_moderator._get_classifier", return_value=lambda image: [
            {"label": "normal", "score": .999}, {"label": "nsfw", "score": .001}
        ]), patch("app.image_moderator.moderate_weapons", return_value={
            "detected": True, "detections": [{"label": "gun", "confidence": .91}]
        }):
            response = self.client.post("/moderate-image", json=self.payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["decision"], "block")
        self.assertEqual(response.json()["categories"]["weapons"]["detections"][0]["label"], "gun")

    def test_missing_weapon_model_returns_clear_503(self):
        with patch("app.image_moderator._get_classifier", return_value=lambda image: [
            {"label": "normal", "score": .99}, {"label": "nsfw", "score": .01}
        ]), patch("app.image_moderator.moderate_weapons", side_effect=WeaponModelError("weights missing; set WEAPON_MODEL_PATH")):
            response = self.client.post("/moderate-image", json=self.payload)
        self.assertEqual(response.status_code, 503)
        self.assertIn("Weapon moderation is unavailable", response.json()["detail"])
        self.assertIn("WEAPON_MODEL_PATH", response.json()["detail"])

    def test_invalid_base64_returns_400(self):
        response = self.client.post("/moderate-image", json={"image_base64": "%%%", "mime_type": "image/png"})
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
