# Moderation Service

FastAPI service with separate text and image moderation paths.

## Text moderation

`POST /moderate` continues to use Detoxify (`original-small`) with the existing text decision engine. The separate Phase-II DistilBERT experiment is not used for live text moderation.

## Image Moderation

`POST /moderate-image` uses two independent models:

- NSFW: pretrained [`Falconsai/nsfw_image_detection`](https://huggingface.co/Falconsai/nsfw_image_detection), which provides `normal` and `nsfw` probabilities. It does not identify weapons.
- Weapons: YOLO11n object detector trained locally on the Roboflow `weapon_detection_final-rvhn1` v3 dataset (CC BY 4.0). Its classes, in the exact model order, are `Grenade`, `Gun`, `Knife`, and `Pistol`.

The dataset is external at `C:\\weapon_dataset`; it is not copied into this repository. It contains train/valid/test splits (4,197/1,361/1,265 images). Training validation found 0 corrupt images and validated YOLO-format boxes and class IDs. The current experimental weights are `models/weapons/best.pt` (5,429,978 bytes), ignored by Git. The service defaults to that path and supports `WEAPON_MODEL_PATH` to point elsewhere. It loads weights lazily on first inference and caches the model. Missing/unusable weights raise a clear model error and the endpoint responds HTTP 503; it never treats unavailable weapon inference as allow or claims a scan occurred.

### Combined decision logic

Decisions use the NSFW and weapon scores independently:

- **BLOCK:** NSFW >= 0.85 OR a weapon detection confidence >= 0.70.
- **WARN:** NSFW >= 0.50 OR a weapon detection confidence >= 0.40.
- **ALLOW:** none of those conditions is met.

The defaults are configurable with `NSFW_WARN_THRESHOLD`, `NSFW_BLOCK_THRESHOLD`, `WEAPON_WARN_THRESHOLD`, and `WEAPON_BLOCK_THRESHOLD`. Validate and calibrate them on a representative held-out dataset before production use. NSFW scores never imply weapon presence. The response retains `score`, `decision`, and `categories.normal`/`categories.nsfw`, and adds `categories.weapons` with `detected` and actual model detections (`label`, `confidence`). The combined `score` is the highest risk score.

### Training workflow

Install requirements, validate the dataset, train, and evaluate the held-out test split:

```powershell
cd moderation-service
python -m pip install -r requirements.txt
python training/prepare_dataset.py C:\\weapon_dataset\\data.yaml
python training/train_weapon_detector.py --data C:\\weapon_dataset\\data.yaml --base yolo11n.pt --epochs 20 --imgsz 320 --batch 16 --workers 0 --device cpu --fraction 1.0 --best-output models/weapons/best.pt
python training/evaluate_weapon_detector.py --data C:\\weapon_dataset\\data.yaml --weights models/weapons/best.pt --split test
```

The training scripts accept a YOLO dataset YAML with `train`, `val`, and `test` image paths, exact class `names`, and matching YOLO text labels. See [training/README.md](training/README.md) for annotation format and the exact reproduction details. Training output is under `runs/weapons/`; the service loads the copied `models/weapons/best.pt`.

### Inference workflow and current limits

Run `uvicorn app.main:app --host 0.0.0.0 --port 3003`, then send a JSON request to `/moderate-image`. Real inference can also be exercised with `python training/test_weapon_images.py --data C:\\weapon_dataset\\data.yaml --weights models/weapons/best.pt --image C:\\Users\\meeta\\Downloads\\gun.jpg`.

The current model is an experimental 20-epoch CPU YOLO11n fine-tune, not a production-ready detector. Training took 21,582.8 seconds (about 6 hours). On the held-out test split it measured precision 0.799, recall 0.709, mAP50 0.771, and mAP50-95 0.536. Class recall was Grenade 0.712, Gun 0.763, Knife 0.623, and Pistol 0.739; class precision was 0.881, 0.776, 0.709, and 0.830 respectively. Real sample inference detected Gun on the Gun image and external `gun.jpg`, but classified the selected Grenade image as Gun at 0.6902 (Grenade confidence 0.3104), returned no detection on the Knife sample, and returned two Pistol detections below the 0.40 warning threshold. These results still show material class-specific misses and false positives; further representative evaluation and threshold calibration are required. Dataset annotations and model coverage limit what can be detected. The NSFW classifier is not a weapon detector.

## Integration contract

Request: JSON containing base64-encoded raw image bytes (without a data-URL prefix) and declared MIME type. Supported image formats are JPEG, PNG, WebP, GIF, and BMP; decoded size is limited to 10 MiB.

```json
{"image_base64":"iVBORw0KGgo...","mime_type":"image/png"}
```

Example success response:

```json
{
  "decision": "block",
  "score": 0.91,
  "categories": {
    "normal": 0.09,
    "nsfw": 0.001,
    "weapons": {"detected": true, "detections": [{"label": "Gun", "confidence": 0.91}]}
  }
}
```

Malformed image/base64 returns HTTP 400 (unsupported declared MIME returns 415); model loading or inference failure returns HTTP 503. Callers should fail closed on errors and deliver only on `allow` according to their product policy.

## Install and run

```bash
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 3003 --reload
```

First startup may download text, NSFW, or YOLO base model assets if the configured local cache is empty. Weapon inference specifically requires `models/weapons/best.pt` or `WEAPON_MODEL_PATH`.
