"""Train YOLO from a supplied dataset; inference is handled by the service."""
import argparse
from pathlib import Path
import shutil
import time
import yaml

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--data", default="datasets/weapons/data.yaml")
    p.add_argument("--base", default="yolo11n.pt")
    p.add_argument("--epochs", type=int, default=100)
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--batch", type=int, default=16)
    p.add_argument("--workers", type=int, default=0)
    p.add_argument("--device", default="")
    p.add_argument("--fraction", type=float, default=1.0)
    p.add_argument("--output", default="runs/weapons")
    p.add_argument("--best-output", default="models/weapons/best.pt")
    a = p.parse_args()
    if not Path(a.data).is_file():
        raise SystemExit(f"Dataset config not found: {a.data}")
    if not yaml.safe_load(Path(a.data).read_text(encoding="utf-8")).get("names"):
        raise SystemExit("Dataset must declare its actual class names")
    from ultralytics import YOLO
    started = time.monotonic()
    results = YOLO(a.base).train(
        data=a.data, epochs=a.epochs, imgsz=a.imgsz, batch=a.batch,
        workers=a.workers, device=a.device or None, fraction=a.fraction,
        project=str(Path(a.output).resolve()), name="train", exist_ok=True,
    )
    save_dir = Path(results.save_dir)
    best = save_dir / "weights" / "best.pt"
    if not best.is_file():
        raise SystemExit(f"Training finished without producing best.pt at {best}")
    destination = Path(a.best_output).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(best, destination)
    print(f"Training duration: {time.monotonic() - started:.1f} seconds")
    print(f"Best weights: {best}")
    print(f"Copied best weights: {destination}")

if __name__ == "__main__":
    main()
