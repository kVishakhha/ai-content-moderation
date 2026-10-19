"""Validate images, YOLO labels, split paths, and class IDs before training."""
import argparse
from collections import Counter
from pathlib import Path

import yaml
from PIL import Image
from ultralytics.data.utils import check_det_dataset

EXPECTED_CLASSES = ["Grenade", "Gun", "Knife", "Pistol"]
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}


def _class_names(data):
    names = data.get("names")
    if isinstance(names, dict):
        return [str(names[key]) for key in sorted(names, key=lambda item: int(item))]
    return [str(name) for name in names or []]


def validate_dataset(yaml_path):
    yaml_path = Path(yaml_path).resolve()
    if not yaml_path.is_file():
        raise SystemExit(f"Dataset config not found: {yaml_path}")
    raw = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
    names = _class_names(raw)
    if int(raw.get("nc", -1)) != len(names) or names != EXPECTED_CLASSES:
        raise SystemExit(f"Expected the supplied dataset classes unchanged and in order: {EXPECTED_CLASSES}; found nc={raw.get('nc')}, names={names}")
    resolved = check_det_dataset(str(yaml_path))
    errors = []
    split_counts = {}
    class_counts = Counter()
    class_images = {class_id: set() for class_id in range(len(names))}
    for split in ("train", "val", "test"):
        split_path = resolved.get(split)
        if not split_path:
            if split == "test":
                continue
            errors.append(f"Missing {split} split in data.yaml")
            continue
        image_dir = Path(split_path)
        if not image_dir.is_dir():
            errors.append(f"{split} image directory does not exist: {image_dir}")
            continue
        images = sorted(p for p in image_dir.rglob("*") if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES)
        label_dir = image_dir.parent / "labels"
        labels = {p.stem: p for p in label_dir.rglob("*.txt")} if label_dir.is_dir() else {}
        image_stems = {p.stem for p in images}
        missing = sorted(image_stems - labels.keys())
        orphaned = sorted(labels.keys() - image_stems)
        if missing:
            errors.append(f"{split}: {len(missing)} images lack labels, e.g. {missing[:3]}")
        if orphaned:
            errors.append(f"{split}: {len(orphaned)} label files have no image, e.g. {orphaned[:3]}")
        boxes = 0
        for image_path in images:
            try:
                with Image.open(image_path) as image:
                    image.verify()
            except Exception as exc:
                errors.append(f"{split}: corrupt image {image_path}: {exc}")
            label_path = labels.get(image_path.stem)
            if label_path is None:
                continue
            try:
                for line_number, line in enumerate(label_path.read_text(encoding="utf-8").splitlines(), start=1):
                    fields = line.split()
                    if len(fields) != 5:
                        raise ValueError(f"line {line_number}: expected class_id x_center y_center width height")
                    class_id = int(fields[0])
                    x_center, y_center, width, height = map(float, fields[1:])
                    if class_id < 0 or class_id >= len(names):
                        raise ValueError(f"line {line_number}: class ID {class_id} is outside 0-{len(names)-1}")
                    if not all(0 <= value <= 1 for value in (x_center, y_center, width, height)) or width <= 0 or height <= 0:
                        raise ValueError(f"line {line_number}: coordinates must be normalized to [0,1] and size positive")
                    if x_center - width / 2 < 0 or x_center + width / 2 > 1 or y_center - height / 2 < 0 or y_center + height / 2 > 1:
                        raise ValueError(f"line {line_number}: bounding box extends beyond normalized image bounds")
                    class_counts[class_id] += 1
                    class_images[class_id].add(image_path.name)
                    boxes += 1
            except Exception as exc:
                errors.append(f"{split}: invalid annotation {label_path}: {exc}")
        split_counts[split] = (len(images), len(labels), boxes)
    for class_id, name in enumerate(names):
        print(f"{name}: {class_counts[class_id]} boxes in {len(class_images[class_id])} images")
        if class_counts[class_id] == 0:
            errors.append(f"Class {name!r} has no valid annotations")
    for split, (images, labels, boxes) in split_counts.items():
        print(f"{split}: {images} images, {labels} label files, {boxes} boxes")
    if errors:
        raise SystemExit("Dataset validation failed:\n- " + "\n- ".join(errors[:30]))
    return resolved


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("data", nargs="?", default="datasets/weapons/data.yaml")
    validate_dataset(parser.parse_args().data)
    print("Dataset validation passed")


if __name__ == "__main__":
    main()
