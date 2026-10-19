"""Evaluate YOLO detection weights on the configured held-out validation set."""
import argparse
from pathlib import Path
import yaml

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--data", default="datasets/weapons/data.yaml")
    p.add_argument("--weights", required=True)
    p.add_argument("--split", choices=("val", "test"), default="val")
    a = p.parse_args()
    if not Path(a.weights).is_file():
        raise SystemExit(f"Weights not found: {a.weights}")
    data = yaml.safe_load(Path(a.data).read_text(encoding="utf-8"))
    names = data["names"]
    print("Dataset classes:", names)
    from ultralytics import YOLO
    metrics = YOLO(a.weights).val(data=a.data, split=a.split)
    print(f"split={a.split} precision={metrics.box.mp:.6f} recall={metrics.box.mr:.6f} "
          f"mAP50={metrics.box.map50:.6f} mAP50-95={metrics.box.map:.6f}")
    class_ids = metrics.box.ap_class_index
    for position, class_id in enumerate(class_ids):
        name = names[int(class_id)] if isinstance(names, list) else names[int(class_id)]
        ap50 = float(metrics.box.all_ap[position, 0])
        ap5095 = float(metrics.box.maps[int(class_id)])
        print(f"class={name} precision={float(metrics.box.p[position]):.6f} "
              f"recall={float(metrics.box.r[position]):.6f} mAP50={ap50:.6f} mAP50-95={ap5095:.6f}")

if __name__ == "__main__":
    main()
