"""Run real combined moderation on one held-out example per class and gun.jpg."""
import argparse
import base64
import json
from pathlib import Path
import sys

import yaml

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))


def image_for_class(dataset_root, names, class_name, excluded_stems):
    class_id = names.index(class_name)
    label_root = dataset_root / "test" / "labels"
    image_root = dataset_root / "test" / "images"
    for label_path in sorted(label_root.glob("*.txt")):
        for line in label_path.read_text(encoding="utf-8").splitlines():
            if line.split() and int(line.split()[0]) == class_id:
                matches = [p for p in image_root.glob(label_path.stem + ".*") if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp", ".webp"}]
                if matches and matches[0].stem not in excluded_stems:
                    return matches[0]
    raise SystemExit(f"No test image found with a {class_name} annotation")


def image_without_annotations(dataset_root):
    label_root = dataset_root / "test" / "labels"
    image_root = dataset_root / "test" / "images"
    for label_path in sorted(label_root.glob("*.txt")):
        if not label_path.read_text(encoding="utf-8").strip():
            matches = [p for p in image_root.glob(label_path.stem + ".*") if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp", ".webp"}]
            if matches:
                return matches[0]
    raise SystemExit("No annotation-empty test image is available as a negative sample")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default=r"C:\weapon_dataset\data.yaml")
    parser.add_argument("--weights", default="models/weapons/best.pt")
    parser.add_argument("--gun-image", default=r"C:\Users\meeta\Downloads\gun.jpg")
    args = parser.parse_args()
    data_path = Path(args.data).resolve()
    dataset = yaml.safe_load(data_path.read_text(encoding="utf-8"))
    names = dataset["names"]
    expected = ["Grenade", "Gun", "Knife", "Pistol"]
    if names != expected:
        raise SystemExit(f"Expected classes {expected}, found {names}")

    from app import weapon_moderator
    weapon_moderator.WEAPON_MODEL_PATH = str(Path(args.weights).resolve())
    from app.image_moderator import moderate_image_bytes

    dataset_root = data_path.parent
    selected = []
    excluded_stems = set()
    for name in expected:
        path = image_for_class(dataset_root, names, name, excluded_stems)
        selected.append((name, path))
        excluded_stems.add(path.stem)
    negative = image_without_annotations(dataset_root)
    if negative.stem in excluded_stems:
        raise SystemExit("Negative sample unexpectedly overlaps a positive sample")
    selected.append(("No annotated weapon", negative))
    gun_image = Path(args.gun_image)
    if gun_image.is_file():
        selected.append(("External gun.jpg", gun_image))
    else:
        print(f"gun image missing: {gun_image}")

    results = []
    for kind, path in selected:
        result = moderate_image_bytes(path.read_bytes())
        item = {
            "sample": kind,
            "filename": path.name,
            "decision": result["decision"],
            "nsfw": result["categories"]["nsfw"],
            "detections": result["categories"]["weapons"]["detections"],
        }
        print(json.dumps(item, ensure_ascii=False))
        results.append((kind, path, result))

    # Exercise the actual FastAPI request path on the annotated Gun sample.
    api_path = next((path for kind, path, _ in results if kind == "External gun.jpg"), None)
    if api_path is None:
        api_path = next(path for kind, path, _ in results if kind == "Gun")
    mime = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".bmp": "image/bmp"}[api_path.suffix.lower()]
    from fastapi.testclient import TestClient
    from app.main import app
    client = TestClient(app)
    response = client.post("/moderate-image", json={
        "image_base64": base64.b64encode(api_path.read_bytes()).decode("ascii"),
        "mime_type": mime,
    })
    print(json.dumps({"api_status": response.status_code, "api_response": response.json()}, ensure_ascii=False))
    if response.status_code != 200:
        raise SystemExit("Real POST /moderate-image failed")


if __name__ == "__main__":
    main()
