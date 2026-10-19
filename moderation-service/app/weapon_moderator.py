"""Lazy inference for a locally trained YOLO weapon detector.

The weights are produced by the training workflow, never during service startup.
"""
import os
from pathlib import Path

WEAPON_CLASS_NAMES = ("Grenade", "Gun", "Knife", "Pistol")
DEFAULT_WEAPON_MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "weapons" / "best.pt"
WEAPON_MODEL_PATH = os.environ.get("WEAPON_MODEL_PATH", str(DEFAULT_WEAPON_MODEL_PATH))
_model = None


class WeaponModelError(RuntimeError):
    """Weapon weights are missing or the detector could not run."""


def _get_model():
    global _model
    if _model is None:
        path = Path(WEAPON_MODEL_PATH).expanduser().resolve()
        if not path.is_file():
            raise WeaponModelError(
                f"Weapon detector weights not found at {path}; train/export a model or configure WEAPON_MODEL_PATH"
            )
        try:
            from ultralytics import YOLO
            model = YOLO(str(path))
            names = model.names
            if isinstance(names, dict):
                actual_names = tuple(str(names[key]) for key in sorted(names, key=lambda key: int(key)))
            else:
                actual_names = tuple(str(name) for name in names)
            if actual_names != WEAPON_CLASS_NAMES:
                raise WeaponModelError(
                    f"Weapon weights must contain classes {WEAPON_CLASS_NAMES} in order; found {actual_names}"
                )
            _model = model
        except WeaponModelError:
            raise
        except Exception as exc:
            raise WeaponModelError("Could not load weapon detector weights") from exc
    return _model


def moderate_weapons(image_bytes: bytes):
    """Return localized detections using only class names in the loaded model."""
    try:
        import io
        from PIL import Image
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        result = _get_model()(image, verbose=False)[0]
        names = result.names
        if isinstance(names, dict):
            names = {int(key): value for key, value in names.items()}
        detections = []
        for box in result.boxes:
            class_id = int(box.cls[0].item())
            label = str(names[class_id])
            if label not in WEAPON_CLASS_NAMES:
                raise WeaponModelError(f"Detector returned unsupported model class: {label}")
            detections.append({"label": label, "confidence": float(box.conf[0].item())})
        return {"detected": bool(detections), "detections": detections}
    except WeaponModelError:
        raise
    except Exception as exc:
        raise WeaponModelError("Weapon detector inference failed") from exc
