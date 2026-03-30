#!/usr/bin/env python3
"""
Long-lived facial analysis worker.

Protocol: newline-delimited JSON over stdin/stdout.

Incoming (from Electron main):
  {"type": "ping", "id": "<uuid>"}
  {"type": "process", "id": "<uuid>", "filepath": "/abs/path/to/image.jpg"}
  {"type": "shutdown"}

Outgoing (to Electron main):
  {"type": "ready"}
  {"type": "pong", "id": "<uuid>"}
  {"type": "result", "id": "<uuid>", "status": "ok",
   "face_detected": true,
   "sex_label": "female",        # "male" | "female" | "unknown"
   "sex_confidence": 0.82,       # float or null
   "metrics": {...}}             # flattened FacialMetrics dict
  {"type": "result", "id": "<uuid>", "status": "error", "error": "..."}
  {"type": "bye"}

Errors during a request produce a result with status="error".
Errors during initialisation are logged to stderr; the worker still starts
and returns status="error" for every subsequent process request.
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Graceful import — import errors must not prevent the worker from starting.
# ---------------------------------------------------------------------------

_IMPORT_OK = True
_IMPORT_ERROR: str = ""

try:
    import cv2  # type: ignore
    import mediapipe as mp  # type: ignore
    from mediapipe.tasks import python  # type: ignore
    from mediapipe.tasks.python import vision  # type: ignore
    from mediapipe.tasks.python.vision import FaceLandmarker  # type: ignore
    from deepface import DeepFace
    from deepface.modules import modeling
    import numpy as np

    import facial_analysis  # type: ignore
except ImportError as _exc:
    _IMPORT_OK = False
    _IMPORT_ERROR = str(_exc)


# ---------------------------------------------------------------------------
# Model path — resolved relative to this script so it works both in dev and
# when packaged (set FACE_LANDMARKER_MODEL env var to override).
# ---------------------------------------------------------------------------

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.environ.get(
    "FACE_LANDMARKER_MODEL",
    os.path.normpath(os.path.join(_SCRIPT_DIR, "data", "face_landmarker_v2_with_blendshapes.task")),
)

DEEPFACE_GENDER_PATH = os.environ.get(
    "DEEPFACE_GENDER_MODEL",
    os.path.normpath(os.path.join(_SCRIPT_DIR, "data", "gender_model_weights.h5")),
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _send(msg: dict[str, Any]) -> None:
    """Write a single JSON line to stdout and flush immediately."""
    sys.stdout.write(json.dumps(msg, allow_nan=False) + "\n")
    sys.stdout.flush()


def _log(text: str) -> None:
    """Write a diagnostic line to stderr (never shown to the renderer)."""
    sys.stderr.write(f"[facial-worker] {text}\n")
    sys.stderr.flush()


def _flatten(d: dict, parent: str = "", sep: str = "_") -> dict[str, Any]:
    """Recursively flatten a nested dict using `sep`-joined keys."""
    out: dict[str, Any] = {}
    for k, v in d.items():
        key = f"{parent}{sep}{k}" if parent else k
        if isinstance(v, dict):
            out.update(_flatten(v, key, sep))
        elif isinstance(v, (list, tuple)):
            # Expand short sequences; skip long blobs to keep CSV manageable.
            if len(v) <= 16:
                for i, item in enumerate(v):
                    sub_key = f"{key}_{i}"
                    if isinstance(item, dict):
                        out.update(_flatten(item, sub_key, sep))
                    else:
                        out[sub_key] = item
            # else: silently drop — caller can handle raw data separately
        else:
            out[key] = v
    return out


import sys
_log(f"Worker is using Python located at: {sys.executable}")


# ---------------------------------------------------------------------------
# Sex classification
#
# Swap out the body of _classify_sex() to plug in a trained model.
# The contract is: receive the flattened metrics dict (string keys, numeric
# or None values) and return (label, confidence).
#
# Current implementation: rule-of-thumb geometric heuristics derived from
# published facial-morphometry literature.  They are intentionally simple and
# are marked here so they are easy to replace.
# ---------------------------------------------------------------------------

_SEX_CONFIDENCE_THRESHOLD = 0.60  # below this → "unknown"


def _classify_sex(metrics: dict[str, Any]) -> tuple[str, Optional[float]]:
    """
    Return (sex_label, confidence).
    sex_label ∈ {"male", "female", "unknown"}.
    confidence is a float in [0, 1] or None when not computable.

    --- REPLACE THIS FUNCTION with a trained model ---
    The heuristics below use facial-index ratios that are statistically
    dimorphic but not individually reliable.  A logistic regression or
    lightweight CNN trained on a labelled dataset will outperform them.
    """
    if not metrics:
        return "unknown", None

    try:
        scores: list[float] = []

        # --- Heuristic 1: facial width-to-height ratio (fWHR) --------------
        # Males tend to have higher fWHR (wider relative to height between
        # brow and upper lip).
        # Keys expected: "geometry_face_width", "geometry_face_height"
        fw = metrics.get("geometry_face_width")
        fh = metrics.get("geometry_face_height")
        if fw and fh and fh > 0:
            fwhr = fw / fh
            # Empirical midpoint ≈ 1.90; males skew higher
            scores.append(_sigmoid((fwhr - 1.90) * 8.0))  # male → closer to 1

        # --- Heuristic 2: jaw width / bizygomatic width ratio ---------------
        # Males have proportionally wider jaws.
        jaw = metrics.get("geometry_jaw_width")
        biz = metrics.get("geometry_bizygomatic_width") or fw
        if jaw and biz and biz > 0:
            jaw_ratio = jaw / biz
            scores.append(_sigmoid((jaw_ratio - 0.72) * 10.0))

        # --- Heuristic 3: nose width / face width ratio ---------------------
        nw = metrics.get("geometry_nose_width") or metrics.get("geometry_nose_base_width")
        if nw and fw and fw > 0:
            nose_ratio = nw / fw
            scores.append(_sigmoid((nose_ratio - 0.26) * 14.0))

        # --- Heuristic 4: upper-lip height indicator ------------------------
        # Females have proportionally taller upper lips relative to face height.
        lip_h = metrics.get("geometry_upper_lip_height") or metrics.get("geometry_lip_height")
        if lip_h and fh and fh > 0:
            lip_ratio = lip_h / fh
            # females → higher ratio → score closer to 0 (female)
            scores.append(1.0 - _sigmoid((lip_ratio - 0.07) * 20.0))

        if not scores:
            return "unknown", None

        male_prob = sum(scores) / len(scores)
        confidence = abs(male_prob - 0.5) * 2.0  # re-scale to [0, 1]

        if confidence < _SEX_CONFIDENCE_THRESHOLD:
            return "unknown", round(confidence, 4)

        label = "male" if male_prob >= 0.5 else "female"
        return label, round(confidence, 4)

    except Exception as exc:
        _log(f"sex classification error: {exc}")
        return "unknown", None


def _classify_sex_v2(image_bgr: np.ndarray, model) -> tuple[str, float]:
    img = cv2.resize(image_bgr, (224, 224))  # DeepFace gender input size
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    img = img.astype("float32") / 255.0
    img = np.expand_dims(img, axis=0)
    
    try:
        labels = ["Woman", "Man"]

        preds = model.predict(img)
        idx = np.argmax(preds)
        return labels[idx], preds[idx]

    except ValueError as e:
        # This will trigger if enforce_detection=True and absolutely zero faces are found
        _log(f"No face detected in the image: {e}")
        cv2.imshow('error debug', image_bgr)
        cv2.waitKey(0)
        return None



def _sigmoid(x: float) -> float:
    import math
    try:
        return 1.0 / (1.0 + math.exp(-x))
    except OverflowError:
        return 0.0 if x < 0 else 1.0


# ---------------------------------------------------------------------------
# Worker class
# ---------------------------------------------------------------------------

class FacialAnalysisWorker:
    def __init__(self) -> None:
        self._detector: Any = None
        self._init_error: Optional[str] = None
        self._setup()

    def _setup(self) -> None:
        if not _IMPORT_OK:
            self._init_error = f"Missing Python dependencies: {_IMPORT_ERROR}"
            _log(self._init_error)
            return

        if not os.path.isfile(MODEL_PATH):
            self._init_error = (
                f"Face landmarker model not found at: {MODEL_PATH}\n"
                "Set the FACE_LANDMARKER_MODEL environment variable to the correct path."
            )
            _log(self._init_error)
            return

        try:
            base_options = python.BaseOptions(model_asset_path=MODEL_PATH)
            options = vision.FaceLandmarkerOptions(
                base_options=base_options,
                output_face_blendshapes=True,
                output_facial_transformation_matrixes=True,
                num_faces=1,
            )
            self._detector = FaceLandmarker.create_from_options(options)
            _log(f"Face landmarker loaded from {MODEL_PATH}")
        except Exception as exc:
            self._init_error = f"Failed to initialise face landmarker: {exc}"
            _log(self._init_error)
        
        try:    
            # Build default model
            model = modeling.build_model(model_name="Gender", task="facial_attribute")
            model.model.load_weights(DEEPFACE_GENDER_PATH)        
            self._model = model
            _log(f"Gender detector loaded from {DEEPFACE_GENDER_PATH}")
        except Exception as exc:
            self._init_error = f"Failed to initialise gender detector: {exc}"
            _log(self._init_error)


    def process(self, filepath: str) -> dict[str, Any]:
        """
        Analyse one image file.  Returns a result dict suitable for the
        "result" message (without the type/id fields).
        Raises on unrecoverable error; caller wraps in try/except.
        """
        if self._init_error:
            raise RuntimeError(self._init_error)

        # Read image
        image_bgr = cv2.imread(filepath)
        if image_bgr is None:
            raise ValueError(
                f"cv2.imread returned None — file missing, corrupt, or not an image: {filepath}"
            )

        image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=image_rgb)
        detection_result = self._detector.detect(image)

        h, w = image_rgb.shape[:2]
        features: Optional[Any] = facial_analysis.extract_all_metrics(detection_result, w, h)

        metrics_dict = _flatten(features.to_dict()) if features else {}
        face_detected = features is not None

        sex_label, sex_confidence = _classify_sex_v2(image_bgr, self._model)
        # sex_label, sex_confidence = _classify_sex(metrics_dict) if face_detected else ("unknown", None)

        return {
            "face_detected": face_detected,
            "sex_label": sex_label,
            "sex_confidence": float(sex_confidence),
            "metrics": metrics_dict,
        }


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main() -> None:
    worker = FacialAnalysisWorker()
    _send({"type": "ready"})

    while True:
        raw_line = sys.stdin.readline()
        
        if not raw_line:
            continue
        
        line = raw_line.strip()

        # Parse incoming message
        try:
            msg: dict[str, Any] = json.loads(line)
        except json.JSONDecodeError as exc:
            _log(f"JSON parse error: {exc} | raw: {line[:120]}")
            continue

        msg_type: str = msg.get("type", "")
        msg_id: str = msg.get("id", "")

        # --- ping ---
        if msg_type == "ping":
            _send({"type": "pong", "id": msg_id})

        # --- shutdown ---
        elif msg_type == "shutdown":
            _send({"type": "bye"})
            break

        # --- process (single image) ---
        elif msg_type == "process":
            filepath: str = msg.get("filepath", "")
            _log(f"Processing {filepath}")
            try:
                result = worker.process(filepath)
                _send({"type": "result", "id": msg_id, "status": "ok", **result})
            except Exception as exc:
                _log(traceback.format_exc())
                _send({
                    "type": "result",
                    "id": msg_id,
                    "status": "error",
                    "error": str(exc),
                })

        # --- batch (many images, results streamed back one by one) ---
        elif msg_type == "batch":
            # items: list of {"filename": str, "filepath": str}
            items: list = msg.get("items", [])
            total: int = len(items)
            for index, item in enumerate(items):
                filename: str = item.get("filename", "")
                filepath: str = item.get("filepath", "")
                try:
                    result = worker.process(filepath)
                    _send({
                        "type": "batch_item",
                        "batch_id": msg_id,
                        "filename": filename,
                        "status": "ok",
                        "index": index,
                        "total": total,
                        **result,
                    })
                except Exception as exc:
                    _log(traceback.format_exc())
                    _send({
                        "type": "batch_item",
                        "batch_id": msg_id,
                        "filename": filename,
                        "status": "error",
                        "index": index,
                        "total": total,
                        "error": str(exc),
                    })
            _send({"type": "batch_done", "batch_id": msg_id, "total": total})

        else:
            _log(f"Unknown message type: {msg_type!r}")


if __name__ == "__main__":
    main()
