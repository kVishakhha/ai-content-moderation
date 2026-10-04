# Weapon detector training

## Dataset and classes

The locally available dataset is `C:\\weapon_dataset`, sourced from Roboflow project `weapon_detection_final-rvhn1`, version 3 (CC BY 4.0). It is external to this repository and must not be fabricated or silently replaced. Its `data.yaml` defines train, valid, and test image paths and class names in this exact order:

```yaml
names: [Grenade, Gun, Knife, Pistol]
```

The matching class IDs are 0=Grenade, 1=Gun, 2=Knife, and 3=Pistol. The dataset contains 4,197 train, 1,361 validation, and 1,265 test images. `prepare_dataset.py` verifies all splits, corresponding labels, class IDs, normalized box geometry, image decoding, and annotations. YOLO's scan reported zero corrupt images.

Each image has a same-stem `.txt` label file. Each object annotation line is:

```text
class_id x_center y_center width height
```

The class ID is zero-based; coordinates are normalized to [0,1]. `data.yaml` must provide `train`, `val`, `test`, and `names`. Names and IDs must match the trained model and production loader exactly. Do not infer or add class labels beyond the dataset.

## Install, train, evaluate

From `moderation-service`:

```powershell
python -m pip install -r requirements.txt
python training/prepare_dataset.py C:\\weapon_dataset\\data.yaml
python training/train_weapon_detector.py --data C:\\weapon_dataset\\data.yaml --base yolo11n.pt --epochs 20 --imgsz 320 --batch 16 --workers 0 --device cpu --fraction 1.0 --best-output models/weapons/best.pt
python training/evaluate_weapon_detector.py --data C:\\weapon_dataset\\data.yaml --weights models/weapons/best.pt --split val
python training/evaluate_weapon_detector.py --data C:\\weapon_dataset\\data.yaml --weights models/weapons/best.pt --split test
```

The selected longer run used Ultralytics 8.4.171, YOLO11n pretrained COCO initialization, PyTorch CPU, 320-pixel images, batch 16, 20 epochs, full training split, and took 21,582.8 seconds (about 5 hours 59 minutes). Raw training runs are under `runs/weapons/longrun20/`. The validation-selected checkpoint is installed at `models/weapons/best.pt` (5.4 MB); `.gitignore` excludes model weights and run artifacts. Production resolves that path relative to the service, or reads an explicit `WEAPON_MODEL_PATH`. `app.weapon_moderator` lazily loads and caches the model, checks the exact class order, and returns model detections to the image decision engine. The service does not train at startup.

The selected checkpoint validation metrics were precision 0.832, recall 0.692, mAP50 0.777, mAP50-95 0.547. Held-out test evaluation reported:

| Class | Precision | Recall | mAP50 | mAP50-95 |
|---|---:|---:|---:|---:|
| Grenade | 0.881 | 0.712 | 0.788 | 0.635 |
| Gun | 0.776 | 0.763 | 0.812 | 0.543 |
| Knife | 0.709 | 0.623 | 0.666 | 0.381 |
| Pistol | 0.830 | 0.739 | 0.818 | 0.584 |
| Overall | 0.799 | 0.709 | 0.771 | 0.536 |

The detector is experimental and still misses objects, especially Knife. At the detector confidence floor 0.25, the test confusion matrix (rows predicted, columns true, final column/row background) records 158 missed Grenades, 114 missed Guns, 108 missed Knives, and 83 missed Pistols. It also contains 670 unmatched predicted boxes across the test images: 126 Grenade, 237 Gun, 186 Knife, and 121 Pistol predictions. These are unmatched detection counts, not the number of images with false positives. Cross-class confusion is also present, including 149 true Guns predicted as Knife and 136 as Pistol. The policy thresholds remain warn >=0.40 and block >=0.70; they are separate from the detector's 0.25 inference floor. Missing or incompatible weights cause HTTP 503, never an allow result.

## Real image inference

Use the external dataset's held-out examples and optionally an image file such as `C:\\Users\\meeta\\Downloads\\gun.jpg`:

```powershell
python training/test_weapon_images.py --data C:\\weapon_dataset\\data.yaml --weights models/weapons/best.pt --image C:\\Users\\meeta\\Downloads\\gun.jpg
```

This runs actual model inference, the combined decision path, and a real in-process FastAPI request. It selects images from dataset annotations; it does not simulate predictions using filenames.
