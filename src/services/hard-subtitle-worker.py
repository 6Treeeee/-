"""OCR worker: accepts only newly captured image bytes over stdin, never transcripts/files."""
import base64
import hashlib
import importlib.metadata
import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from rapidocr_onnxruntime import RapidOCR

engine = RapidOCR(use_cls=False, det_limit_type="max", det_limit_side_len=1280,
                  intra_op_num_threads=2, inter_op_num_threads=1)
previous_mask = None
package = Path(importlib.metadata.distribution("rapidocr-onnxruntime").locate_file("rapidocr_onnxruntime"))
models = [{"name": p.name, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
          for p in sorted((package / "models").glob("*.onnx"))]
print(json.dumps({"ready": True, "engine": "rapidocr_onnxruntime",
                  "version": importlib.metadata.version("rapidocr-onnxruntime"), "models": models}), flush=True)
for line in sys.stdin:
    if len(line) > 4_000_000:
        raise ValueError("OCR image message exceeds limit")
    message = json.loads(line)
    started = time.monotonic()
    image_bytes = base64.b64decode(message["image"], validate=True)
    image = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Invalid captured image")
    height, width = image.shape[:2]
    if message.get("op") == "probe":
        scaled_height = max(1, round(512 * height / width))
        small = cv2.resize(image, (512, scaled_height), interpolation=cv2.INTER_AREA)
        x1, x2 = round(512*.1), round(512*.9)
        y1, y2 = round(scaled_height*.68), round(scaled_height*.96)
        gray = cv2.cvtColor(small[y1:y2, x1:x2], cv2.COLOR_BGR2GRAY)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
        contrast = cv2.subtract(gray, cv2.erode(gray, kernel))
        mask = np.logical_and(gray > 210, contrast > 45)
        score = 0 if previous_mask is None else float(np.mean(mask != previous_mask))
        previous_mask = mask
        print(json.dumps({"id": message["id"], "score": score,
                          "frame_sha256": hashlib.sha256(image_bytes).hexdigest(),
                          "elapsed_ms": round((time.monotonic()-started)*1000)}), flush=True)
        continue
    # Relative geometry works for landscape and portrait; no video-id-specific ROI.
    top = int(height * .45)
    result, _ = engine(image[top:, :], use_cls=False)
    pieces = []
    for box, text, score in result or []:
        if score < .58:
            continue
        xs = [float(p[0]) for p in box]
        ys = [float(p[1]) + top for p in box]
        x1, x2 = max(0, int(min(xs))), min(width, int(max(xs)))
        y1, y2 = max(0, int(min(ys))), min(height, int(max(ys)))
        patch = image[y1:y2, x1:x2]
        white = float(np.mean(np.min(patch, axis=2) > 200)) if patch.size else 0
        pieces.append({"text": text.strip(), "confidence": float(score),
                       "cx": sum(xs)/4, "cy": sum(ys)/4, "height": max(ys)-min(ys),
                       "width": max(xs)-min(xs),
                       "white_fraction": white,
                       "box": [[float(p[0]), float(p[1])+top] for p in box]})
    # Subtitle candidates are substantial centered light text, not arbitrary scene labels.
    candidates = [p for p in pieces if .18*width <= p["cx"] <= .82*width
                  and p["height"] >= max(12, height*.027) and p["white_fraction"] >= .12]
    # Dialogue captions may sit above bottom controls on portrait video, but never
    # fall back to centered title/scene text when no lower caption is present.
    candidates = [p for p in candidates if p["cy"] >= height*.62]
    if candidates:
        largest = max(p["height"] for p in candidates)
        candidates = [p for p in candidates if p["height"] >= largest*.72]
    if len(candidates) > 1:
        # A centered infographic label can share the subtitle's color and size.
        # Keep rows comparable to the widest dialogue row; a lone short caption
        # remains valid because this filter applies only when multiple rows exist.
        widest = max(p["width"] for p in candidates)
        candidates = [p for p in candidates if p["width"] >= widest*.5]
    candidates.sort(key=lambda p: (round(p["cy"]/max(10,height*.025)), p["cx"]))
    text = "".join(p["text"] for p in candidates)
    confidence = sum(p["confidence"] for p in candidates)/len(candidates) if candidates else 0
    print(json.dumps({"id": message["id"], "text": text, "confidence": confidence,
                      "pieces": pieces, "selected": candidates,
                      "frame_sha256": hashlib.sha256(image_bytes).hexdigest(),
                      "elapsed_ms": round((time.monotonic()-started)*1000)}, ensure_ascii=False), flush=True)
