"""
facial_analysis.py
------------------
Complete facial metrics extraction from a MediaPipe FaceLandmarkerResult.

Usage:
    result = landmarker.detect(mp_image)
    h, w = image_rgb.shape[:2]
    metrics = extract_all_metrics(result, w, h)
    collected[idx].update({'features': metrics})

All pixel distances are also returned as ratios (normalised by inter-ocular
distance) so they are comparable across images taken at different distances.
"""

from __future__ import annotations

import numpy as np
import cv2
from dataclasses import dataclass, asdict
from typing import Optional
import numpy.typing as npt

NDArray = npt.NDArray[np.float64]

PHI = 1.618033988749895   # golden ratio

# ---------------------------------------------------------------------------
# Landmark index constants (MediaPipe 478-point canonical face model)
# ---------------------------------------------------------------------------

# Eyes
R_EYE_INNER      = 133
R_EYE_OUTER      = 33
R_EYE_TOP        = 159
R_EYE_BOT        = 145
R_PUPIL          = 468   # requires refine_landmarks=True

L_EYE_INNER      = 362
L_EYE_OUTER      = 263
L_EYE_TOP        = 386
L_EYE_BOT        = 374
L_PUPIL          = 473   # requires refine_landmarks=True

# Eyebrows
R_BROW_INNER     = 55
R_BROW_OUTER     = 46
R_BROW_PEAK      = 52
L_BROW_INNER     = 285
L_BROW_OUTER     = 276
L_BROW_PEAK      = 282

# Nose
NOSE_TIP         = 4
NOSE_BRIDGE      = 6
NOSE_L_ALA       = 358
NOSE_R_ALA       = 129
NOSE_COLUMELLA   = 2

# Lips
UPPER_LIP_TOP     = 13
LOWER_LIP_BOT     = 14
UPPER_LIP_CUPID_L = 37
UPPER_LIP_CUPID_R = 267
UPPER_LIP_CUPID_V = 0
LIP_L_CORNER      = 61
LIP_R_CORNER      = 291

# Philtrum
PHILTRUM_TOP     = 164
PHILTRUM_BOT     = UPPER_LIP_TOP

# Face outline / structure
FACE_TOP         = 10
CHIN_TIP         = 152
MENTON           = 18
GONION_R         = 172
GONION_L         = 397
ZYGION_R         = 234
ZYGION_L         = 454
FOREHEAD_L       = 54
FOREHEAD_R       = 284

# Midface
SUBNASALE        = 2
GLABELLA         = 9


# ---------------------------------------------------------------------------
# Result dataclasses
# ---------------------------------------------------------------------------

@dataclass
class SymmetryMetrics:
    symmetry_score: float         # 0-1, 1 = perfect
    mean_deviation_ratio: float   # mean absolute horizontal deviation / face width


@dataclass
class AveragenessRatios:
    eye_width_to_iod: float
    nose_width_to_face_w: float
    mouth_to_face_w: float
    lower_face_to_total: float


@dataclass
class AveragenessZScores:
    eye_width_to_iod: float
    nose_width_to_face_w: float
    mouth_to_face_w: float
    lower_face_to_total: float


@dataclass
class AveragenessMetrics:
    averageness_score: float      # 0-1, 1 = maximally average
    ratios: AveragenessRatios
    z_scores: AveragenessZScores


@dataclass
class GoldenRatioValues:
    face_h_to_face_w: float
    face_w_to_mouth_w: float
    mouth_w_to_nose_w: float
    lower_to_upper_lip: float
    eye_w_to_iod: float
    nose_h_to_face_h: float


@dataclass
class GoldenRatioMetrics:
    overall_deviation: float      # 0 = perfect phi; lower is closer
    ratios: GoldenRatioValues
    deviations: GoldenRatioValues


@dataclass
class JawlineMetrics:
    bigonial_width_px: float
    bigonial_width_iod: float
    chin_projection_px: float     # positive = chin below gonion line
    gonion_angle_r_deg: float
    gonion_angle_l_deg: float
    mean_gonion_angle_deg: float
    gonion_r: list[float]
    gonion_l: list[float]
    menton: list[float]
    chin_tip: list[float]


@dataclass
class ChinMetrics:
    chin_width_px: float
    chin_width_iod: float
    chin_height_px: float
    chin_height_iod: float
    chin_tip: list[float]


@dataclass
class CheekboneMetrics:
    bizygomatic_width_px: float
    bizygomatic_width_iod: float
    cheek_to_jaw_ratio: float     # >1 = wider at cheeks
    zygion_r: list[float]
    zygion_l: list[float]


@dataclass
class MidfaceMetrics:
    midface_height_px: float
    lower_face_height_px: float
    midface_ratio: float          # ~1.0 = balanced


@dataclass
class EyeMetrics:
    right_eye_width_px: float
    right_eye_height_px: float
    right_eye_width_iod: float
    right_almond_index: Optional[float]    # width/height; almond ~2.5-3.5
    right_eyelid_exposure: float
    left_eye_width_px: float
    left_eye_height_px: float
    left_eye_width_iod: float
    left_almond_index: Optional[float]
    left_eyelid_exposure: float
    eye_size_asymmetry: float


@dataclass
class CanthalTiltMetrics:
    right_deg: float              # + = upward tilt, - = downward
    left_deg: float
    mean_deg: float


@dataclass
class EyebrowMetrics:
    right_brow_length_px: float
    right_brow_arch_height_px: float
    right_brow_tilt_deg: float
    right_brow_length_iod: float
    left_brow_length_px: float
    left_brow_arch_height_px: float
    left_brow_tilt_deg: float
    left_brow_length_iod: float


@dataclass
class BrowRidgeMetrics:
    right_brow_ridge_px: float
    left_brow_ridge_px: float
    mean_brow_ridge_px: float
    mean_brow_ridge_iod: float


@dataclass
class IPDMetrics:
    ipd_px: float
    ipd_to_face_w: float


@dataclass
class NoseMetrics:
    nose_height_px: float
    nose_width_px: float
    nose_height_iod: float
    nose_width_iod: float
    nose_width_to_face_w: float
    nasal_index: float            # <70 leptorrhine, 70-85 mesorrhine, >85 platyrrhine
    tip: list[float]
    bridge: list[float]
    ala_r: list[float]
    ala_l: list[float]


@dataclass
class LipMetrics:
    mouth_width_px: float
    mouth_width_iod: float
    total_lip_height_px: float
    upper_lip_height_px: float
    lower_lip_height_px: float
    lip_fullness_ratio: float
    upper_lower_ratio: float
    cupid_bow_depth_px: float
    cupid_bow_width_px: float
    philtrum_length_px: float
    philtrum_length_iod: float


@dataclass
class FaceShapeMetrics:
    face_width_px: float
    face_height_px: float
    face_width_to_height: float   # ~0.7 is average
    forehead_height_px: float
    forehead_to_face_ratio: float


@dataclass
class SkinMetrics:
    mean_brightness_lab: float
    tone_evenness_score: float    # 0-1, 1 = very even
    mean_texture_lapvar: float
    mean_redness_a_star: float


@dataclass
class HeadPoseMetrics:
    pitch_deg: float
    yaw_deg: float
    roll_deg: float


@dataclass
class FacialMetrics:
    iod_px: float
    symmetry: SymmetryMetrics
    averageness: AveragenessMetrics
    golden_ratio: GoldenRatioMetrics
    face_shape: FaceShapeMetrics
    jawline: JawlineMetrics
    chin: ChinMetrics
    cheekbones: CheekboneMetrics
    midface_ratio: MidfaceMetrics
    eyes: EyeMetrics
    canthal_tilt: CanthalTiltMetrics
    eyebrows: EyebrowMetrics
    brow_ridge: BrowRidgeMetrics
    ipd: IPDMetrics
    nose: NoseMetrics
    lips: LipMetrics
    blendshapes: dict[str, float]
    teeth_visibility: Optional[float]        # mouthShrugUpper blendshape proxy
    skin: Optional[SkinMetrics]
    head_pose: Optional[HeadPoseMetrics]

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _px(landmarks, idx: int, w: int, h: int) -> NDArray:
    lm = landmarks[idx]
    return np.array([lm.x * w, lm.y * h], dtype=float)


def _dist(a: NDArray, b: NDArray) -> float:
    return float(np.linalg.norm(a - b))


def _angle_deg(a: NDArray, vertex: NDArray, b: NDArray) -> float:
    v1 = a - vertex
    v2 = b - vertex
    cos_a = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-9)
    return float(np.degrees(np.arccos(np.clip(cos_a, -1, 1))))


def _rise_angle(p1: NDArray, p2: NDArray) -> float:
    """Signed angle of p1->p2 relative to horizontal.
    Positive = p2 is anatomically higher (lower y in image coords)."""
    dx = p2[0] - p1[0]
    dy = p2[1] - p1[1]
    return float(np.degrees(np.arctan2(-dy, abs(dx))))


def _ratio(a: float, b: float) -> float:
    return round(float(a) / (float(b) + 1e-9), 4)


# ---------------------------------------------------------------------------
# Individual metric functions
# ---------------------------------------------------------------------------

def _symmetry(lm, w: int, h: int) -> SymmetryMetrics:
    pairs = [
        (R_EYE_INNER, L_EYE_INNER), (R_EYE_OUTER, L_EYE_OUTER),
        (R_BROW_INNER, L_BROW_INNER), (R_BROW_OUTER, L_BROW_OUTER),
        (GONION_R, GONION_L), (ZYGION_R, ZYGION_L),
        (NOSE_R_ALA, NOSE_L_ALA), (LIP_R_CORNER, LIP_L_CORNER),
    ]
    midline_x = _px(lm, NOSE_TIP, w, h)[0]
    face_w    = _dist(_px(lm, ZYGION_R, w, h), _px(lm, ZYGION_L, w, h))

    deviations = []
    for r_idx, l_idx in pairs:
        r = _px(lm, r_idx, w, h)
        l = _px(lm, l_idx, w, h)
        l_mirrored_x = 2 * midline_x - l[0]
        deviations.append(abs(r[0] - l_mirrored_x) / (face_w + 1e-9))

    mean_dev = float(np.mean(deviations))
    return SymmetryMetrics(
        symmetry_score=round(max(0.0, 1.0 - mean_dev * 10), 4),
        mean_deviation_ratio=round(mean_dev, 4),
    )


def _averageness(lm, w: int, h: int, iod: float) -> AveragenessMetrics:
    targets = {
        'eye_width_to_iod':     (0.31, 0.05),
        'nose_width_to_face_w': (0.25, 0.03),
        'mouth_to_face_w':      (0.50, 0.04),
        'lower_face_to_total':  (0.55, 0.04),
    }

    face_w     = _dist(_px(lm, ZYGION_R, w, h), _px(lm, ZYGION_L, w, h))
    face_h     = _dist(_px(lm, FACE_TOP, w, h),  _px(lm, MENTON, w, h))
    eye_w_r    = _dist(_px(lm, R_EYE_INNER, w, h), _px(lm, R_EYE_OUTER, w, h))
    eye_w_l    = _dist(_px(lm, L_EYE_INNER, w, h), _px(lm, L_EYE_OUTER, w, h))
    nose_w     = _dist(_px(lm, NOSE_R_ALA, w, h), _px(lm, NOSE_L_ALA, w, h))
    mouth_w    = _dist(_px(lm, LIP_R_CORNER, w, h), _px(lm, LIP_L_CORNER, w, h))
    lower_face = _dist(_px(lm, SUBNASALE, w, h), _px(lm, MENTON, w, h))

    measured = dict(
        eye_width_to_iod=    _ratio((eye_w_r + eye_w_l) / 2, iod),
        nose_width_to_face_w=_ratio(nose_w, face_w),
        mouth_to_face_w=     _ratio(mouth_w, face_w),
        lower_face_to_total= _ratio(lower_face, face_h),
    )
    z_scores = {k: abs(measured[k] - t) / tol for k, (t, tol) in targets.items()}
    score = float(np.mean([max(0.0, 1.0 - z / 2) for z in z_scores.values()]))

    return AveragenessMetrics(
        averageness_score=round(score, 4),
        ratios=AveragenessRatios(**{k: round(v, 4) for k, v in measured.items()}),
        z_scores=AveragenessZScores(**{k: round(v, 4) for k, v in z_scores.items()}),
    )


def _golden_ratio(lm, w: int, h: int) -> GoldenRatioMetrics:
    face_w      = _dist(_px(lm, ZYGION_R, w, h), _px(lm, ZYGION_L, w, h))
    face_h      = _dist(_px(lm, FACE_TOP, w, h),  _px(lm, MENTON, w, h))
    mouth_w     = _dist(_px(lm, LIP_R_CORNER, w, h), _px(lm, LIP_L_CORNER, w, h))
    nose_w      = _dist(_px(lm, NOSE_R_ALA, w, h), _px(lm, NOSE_L_ALA, w, h))
    upper_lip_h = abs(_px(lm, UPPER_LIP_TOP, w, h)[1] - _px(lm, PHILTRUM_TOP, w, h)[1])
    lower_lip_h = abs(_px(lm, LOWER_LIP_BOT, w, h)[1] - _px(lm, UPPER_LIP_TOP, w, h)[1])
    eye_w_r     = _dist(_px(lm, R_EYE_INNER, w, h), _px(lm, R_EYE_OUTER, w, h))
    iod         = _dist(_px(lm, R_EYE_INNER, w, h), _px(lm, L_EYE_INNER, w, h))
    nose_h      = _dist(_px(lm, NOSE_BRIDGE, w, h), _px(lm, NOSE_TIP, w, h))

    raw = dict(
        face_h_to_face_w=   _ratio(face_h, face_w),
        face_w_to_mouth_w=  _ratio(face_w, mouth_w),
        mouth_w_to_nose_w=  _ratio(mouth_w, nose_w),
        lower_to_upper_lip= _ratio(lower_lip_h, upper_lip_h),
        eye_w_to_iod=       _ratio(eye_w_r, iod),
        nose_h_to_face_h=   _ratio(nose_h, face_h),
    )
    ideals = dict(
        face_h_to_face_w=PHI, face_w_to_mouth_w=PHI,
        mouth_w_to_nose_w=PHI, lower_to_upper_lip=PHI,
        eye_w_to_iod=1/PHI, nose_h_to_face_h=1/3,
    )
    devs = {k: round(abs(raw[k] / ideals[k] - 1), 4) for k in raw}

    return GoldenRatioMetrics(
        overall_deviation=round(float(np.mean(list(devs.values()))), 4),
        ratios=GoldenRatioValues(**{k: round(v, 4) for k, v in raw.items()}),
        deviations=GoldenRatioValues(**devs),
    )


def _jawline(lm, w: int, h: int, iod: float) -> JawlineMetrics:
    gonion_r = _px(lm, GONION_R, w, h)
    gonion_l = _px(lm, GONION_L, w, h)
    menton   = _px(lm, MENTON, w, h)
    chin_tip = _px(lm, CHIN_TIP, w, h)

    bigonial_w      = _dist(gonion_r, gonion_l)
    chin_projection = (gonion_r[1] + gonion_l[1]) / 2 - menton[1]
    angle_r = _angle_deg(_px(lm, ZYGION_R, w, h), gonion_r, menton)
    angle_l = _angle_deg(_px(lm, ZYGION_L, w, h), gonion_l, menton)

    return JawlineMetrics(
        bigonial_width_px=    round(bigonial_w, 2),
        bigonial_width_iod=   _ratio(bigonial_w, iod),
        chin_projection_px=   round(float(chin_projection), 2),
        gonion_angle_r_deg=   round(angle_r, 2),
        gonion_angle_l_deg=   round(angle_l, 2),
        mean_gonion_angle_deg=round((angle_r + angle_l) / 2, 2),
        gonion_r=gonion_r.tolist(),
        gonion_l=gonion_l.tolist(),
        menton=menton.tolist(),
        chin_tip=chin_tip.tolist(),
    )


def _chin(lm, w: int, h: int, iod: float) -> ChinMetrics:
    CHIN_L = 176
    CHIN_R = 400
    chin_w   = _dist(_px(lm, CHIN_L, w, h), _px(lm, CHIN_R, w, h))
    chin_tip = _px(lm, CHIN_TIP, w, h)
    menton   = _px(lm, MENTON, w, h)
    chin_h   = abs(menton[1] - _px(lm, LIP_R_CORNER, w, h)[1])

    return ChinMetrics(
        chin_width_px=  round(chin_w, 2),
        chin_width_iod= _ratio(chin_w, iod),
        chin_height_px= round(chin_h, 2),
        chin_height_iod=_ratio(chin_h, iod),
        chin_tip=chin_tip.tolist(),
    )


def _cheekbones(lm, w: int, h: int, iod: float) -> CheekboneMetrics:
    zyg_r    = _px(lm, ZYGION_R, w, h)
    zyg_l    = _px(lm, ZYGION_L, w, h)
    biz_w    = _dist(zyg_r, zyg_l)
    gonion_w = _dist(_px(lm, GONION_R, w, h), _px(lm, GONION_L, w, h))

    return CheekboneMetrics(
        bizygomatic_width_px= round(biz_w, 2),
        bizygomatic_width_iod=_ratio(biz_w, iod),
        cheek_to_jaw_ratio=   _ratio(biz_w, gonion_w),
        zygion_r=zyg_r.tolist(),
        zygion_l=zyg_l.tolist(),
    )


def _midface_ratio(lm, w: int, h: int) -> MidfaceMetrics:
    glabella  = _px(lm, GLABELLA, w, h)
    subnasale = _px(lm, SUBNASALE, w, h)
    menton    = _px(lm, MENTON, w, h)
    midface_h    = abs(subnasale[1] - glabella[1])
    lower_face_h = abs(menton[1] - subnasale[1])

    return MidfaceMetrics(
        midface_height_px=   round(midface_h, 2),
        lower_face_height_px=round(lower_face_h, 2),
        midface_ratio=       _ratio(midface_h, lower_face_h),
    )


def _eye_metrics(lm, w: int, h: int, iod: float) -> EyeMetrics:
    def _eye(
        inner: int, outer: int, top: int, bot: int
    ) -> tuple[float, float, float, Optional[float], float]:
        eye_w = _dist(_px(lm, inner, w, h), _px(lm, outer, w, h))
        eye_h = abs(_px(lm, top, w, h)[1] - _px(lm, bot, w, h)[1])
        almond: Optional[float] = round(_ratio(eye_w, eye_h), 3) if eye_h > 0 else None
        return eye_w, eye_h, _ratio(eye_w, iod), almond, eye_h

    rw, rh, rwiod, ra, re = _eye(R_EYE_INNER, R_EYE_OUTER, R_EYE_TOP, R_EYE_BOT)
    lw, lh, lwiod, la, le = _eye(L_EYE_INNER, L_EYE_OUTER, L_EYE_TOP, L_EYE_BOT)

    return EyeMetrics(
        right_eye_width_px=   round(rw, 2),
        right_eye_height_px=  round(rh, 2),
        right_eye_width_iod=  rwiod,
        right_almond_index=   ra,
        right_eyelid_exposure=round(re, 2),
        left_eye_width_px=    round(lw, 2),
        left_eye_height_px=   round(lh, 2),
        left_eye_width_iod=   lwiod,
        left_almond_index=    la,
        left_eyelid_exposure= round(le, 2),
        eye_size_asymmetry=   round(abs(rw - lw) / (iod + 1e-9), 4),
    )


def _canthal_tilt(lm, w: int, h: int) -> CanthalTiltMetrics:
    r = _rise_angle(_px(lm, R_EYE_INNER, w, h), _px(lm, R_EYE_OUTER, w, h))
    l = _rise_angle(_px(lm, L_EYE_INNER, w, h), _px(lm, L_EYE_OUTER, w, h))
    return CanthalTiltMetrics(
        right_deg=round(r, 2),
        left_deg= round(l, 2),
        mean_deg= round((r + l) / 2, 2),
    )


def _eyebrow(lm, w: int, h: int, iod: float) -> EyebrowMetrics:
    def _brow(
        inner: int, outer: int, peak: int, eye_top: int
    ) -> tuple[float, float, float, float]:
        brow_len = _dist(_px(lm, inner, w, h), _px(lm, outer, w, h))
        arch_h   = abs(_px(lm, eye_top, w, h)[1] - _px(lm, peak, w, h)[1])
        tilt     = _rise_angle(_px(lm, inner, w, h), _px(lm, outer, w, h))
        return brow_len, arch_h, tilt, _ratio(brow_len, iod)

    rl, ra, rt, ri = _brow(R_BROW_INNER, R_BROW_OUTER, R_BROW_PEAK, R_EYE_TOP)
    ll, la, lt, li = _brow(L_BROW_INNER, L_BROW_OUTER, L_BROW_PEAK, L_EYE_TOP)

    return EyebrowMetrics(
        right_brow_length_px=     round(rl, 2),
        right_brow_arch_height_px=round(ra, 2),
        right_brow_tilt_deg=      round(rt, 2),
        right_brow_length_iod=    ri,
        left_brow_length_px=      round(ll, 2),
        left_brow_arch_height_px= round(la, 2),
        left_brow_tilt_deg=       round(lt, 2),
        left_brow_length_iod=     li,
    )


def _brow_ridge(lm, w: int, h: int, iod: float) -> BrowRidgeMetrics:
    r    = abs(_px(lm, R_BROW_PEAK, w, h)[1] - _px(lm, R_EYE_TOP, w, h)[1])
    l    = abs(_px(lm, L_BROW_PEAK, w, h)[1] - _px(lm, L_EYE_TOP, w, h)[1])
    mean = (r + l) / 2
    return BrowRidgeMetrics(
        right_brow_ridge_px= round(r, 2),
        left_brow_ridge_px=  round(l, 2),
        mean_brow_ridge_px=  round(mean, 2),
        mean_brow_ridge_iod= _ratio(mean, iod),
    )


def _ipd(lm, w: int, h: int) -> IPDMetrics:
    ipd    = _dist(_px(lm, R_EYE_INNER, w, h), _px(lm, L_EYE_INNER, w, h))
    face_w = _dist(_px(lm, ZYGION_R, w, h),    _px(lm, ZYGION_L, w, h))
    return IPDMetrics(
        ipd_px=       round(ipd, 2),
        ipd_to_face_w=_ratio(ipd, face_w),
    )


def _nose(lm, w: int, h: int, iod: float) -> NoseMetrics:
    tip    = _px(lm, NOSE_TIP, w, h)
    bridge = _px(lm, NOSE_BRIDGE, w, h)
    ala_r  = _px(lm, NOSE_R_ALA, w, h)
    ala_l  = _px(lm, NOSE_L_ALA, w, h)
    face_w = _dist(_px(lm, ZYGION_R, w, h), _px(lm, ZYGION_L, w, h))

    nose_h = _dist(bridge, tip)
    nose_w = _dist(ala_r, ala_l)

    return NoseMetrics(
        nose_height_px=      round(nose_h, 2),
        nose_width_px=       round(nose_w, 2),
        nose_height_iod=     _ratio(nose_h, iod),
        nose_width_iod=      _ratio(nose_w, iod),
        nose_width_to_face_w=_ratio(nose_w, face_w),
        nasal_index=         round(_ratio(nose_w, nose_h) * 100, 2),
        tip=tip.tolist(),
        bridge=bridge.tolist(),
        ala_r=ala_r.tolist(),
        ala_l=ala_l.tolist(),
    )


def _lips(lm, w: int, h: int, iod: float) -> LipMetrics:
    upper_top = _px(lm, UPPER_LIP_TOP, w, h)
    lower_bot = _px(lm, LOWER_LIP_BOT, w, h)
    corner_r  = _px(lm, LIP_R_CORNER, w, h)
    corner_l  = _px(lm, LIP_L_CORNER, w, h)
    cupid_l   = _px(lm, UPPER_LIP_CUPID_L, w, h)
    cupid_r   = _px(lm, UPPER_LIP_CUPID_R, w, h)
    cupid_v   = _px(lm, UPPER_LIP_CUPID_V, w, h)
    philtrum  = _px(lm, PHILTRUM_TOP, w, h)

    mouth_w     = _dist(corner_r, corner_l)
    total_lip_h = abs(lower_bot[1] - upper_top[1])
    upper_h     = abs(upper_top[1] - cupid_v[1])
    lower_h     = max(0.0, total_lip_h - upper_h)
    cupid_depth = abs(cupid_v[1] - (cupid_l[1] + cupid_r[1]) / 2)
    cupid_width = _dist(cupid_l, cupid_r)
    philtrum_h  = abs(upper_top[1] - philtrum[1])

    return LipMetrics(
        mouth_width_px=     round(mouth_w, 2),
        mouth_width_iod=    _ratio(mouth_w, iod),
        total_lip_height_px=round(total_lip_h, 2),
        upper_lip_height_px=round(upper_h, 2),
        lower_lip_height_px=round(lower_h, 2),
        lip_fullness_ratio= _ratio(total_lip_h, mouth_w),
        upper_lower_ratio=  _ratio(upper_h, lower_h),
        cupid_bow_depth_px= round(cupid_depth, 2),
        cupid_bow_width_px= round(cupid_width, 2),
        philtrum_length_px= round(philtrum_h, 2),
        philtrum_length_iod=_ratio(philtrum_h, iod),
    )


def _face_proportions(lm, w: int, h: int) -> FaceShapeMetrics:
    face_w     = _dist(_px(lm, ZYGION_R, w, h), _px(lm, ZYGION_L, w, h))
    face_h     = abs(_px(lm, MENTON, w, h)[1]   - _px(lm, FACE_TOP, w, h)[1])
    forehead_h = abs(_px(lm, GLABELLA, w, h)[1] - _px(lm, FACE_TOP, w, h)[1])

    return FaceShapeMetrics(
        face_width_px=         round(face_w, 2),
        face_height_px=        round(face_h, 2),
        face_width_to_height=  _ratio(face_w, face_h),
        forehead_height_px=    round(forehead_h, 2),
        forehead_to_face_ratio=_ratio(forehead_h, face_h),
    )


def _skin_metrics(
    image_rgb: npt.NDArray[np.uint8],
    lm,
    w: int,
    h: int,
) -> Optional[SkinMetrics]:
    def roi(cx: float, cy: float, size: int = 40) -> npt.NDArray[np.uint8]:
        x1 = max(0, int(cx - size // 2))
        y1 = max(0, int(cy - size // 2))
        x2 = min(image_rgb.shape[1], x1 + size)
        y2 = min(image_rgb.shape[0], y1 + size)
        return image_rgb[y1:y2, x1:x2]

    cheek_r    = _px(lm, 205, w, h)
    cheek_l    = _px(lm, 425, w, h)
    forehead_c = _px(lm, GLABELLA, w, h)
    regions    = [roi(*cheek_r), roi(*cheek_l), roi(*forehead_c)]

    clarity_scores: list[float] = []
    brightness_vals: list[float] = []
    redness_vals: list[float] = []

    for region in regions:
        if region.size == 0:
            continue
        gray    = cv2.cvtColor(region, cv2.COLOR_RGB2GRAY)
        lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        clarity_scores.append(lap_var)
        lab = cv2.cvtColor(region, cv2.COLOR_RGB2LAB)
        brightness_vals.append(float(lab[:, :, 0].mean()))
        redness_vals.append(float(lab[:, :, 1].mean()))

    if not clarity_scores:
        return None

    tone_evenness = 1.0 - min(1.0, float(np.std(brightness_vals)) / 20.0)
    return SkinMetrics(
        mean_brightness_lab=round(float(np.mean(brightness_vals)), 2),
        tone_evenness_score=round(tone_evenness, 4),
        mean_texture_lapvar=round(float(np.mean(clarity_scores)), 2),
        mean_redness_a_star=round(float(np.mean(redness_vals)), 2),
    )


def _head_pose(result) -> Optional[HeadPoseMetrics]:
    if not result.facial_transformation_matrixes:
        return None
    mat = np.array(result.facial_transformation_matrixes[0])
    sy  = float(np.sqrt(mat[0, 0] ** 2 + mat[1, 0] ** 2))
    if sy >= 1e-6:
        pitch = np.degrees(np.arctan2(-mat[2, 0], sy))
        yaw   = np.degrees(np.arctan2(mat[1, 0], mat[0, 0]))
        roll  = np.degrees(np.arctan2(mat[2, 1], mat[2, 2]))
    else:
        pitch = np.degrees(np.arctan2(-mat[1, 2], mat[1, 1]))
        yaw   = np.degrees(np.arctan2(-mat[2, 0], sy))
        roll  = 0.0
    return HeadPoseMetrics(
        pitch_deg=round(float(pitch), 2),
        yaw_deg=  round(float(yaw), 2),
        roll_deg= round(float(roll), 2),
    )


# ---------------------------------------------------------------------------
# Master extractor
# ---------------------------------------------------------------------------

def extract_all_metrics(
    result,
    image_width: int,
    image_height: int,
    image_rgb: Optional[npt.NDArray[np.uint8]] = None,
) -> Optional[FacialMetrics]:
    """
    Extract all facial metrics from a FaceLandmarkerResult.

    Args:
        result:       mediapipe FaceLandmarkerResult
        image_width:  image width in pixels
        image_height: image height in pixels
        image_rgb:    H x W x 3 uint8 RGB array -- required for skin metrics

    Returns:
        FacialMetrics dataclass, or None if no face detected.
        Call .to_dict() for a fully serialisable representation.
    """
    if not result.face_landmarks:
        return None

    lm   = result.face_landmarks[0]
    w, h = image_width, image_height
    iod  = _dist(_px(lm, R_EYE_INNER, w, h), _px(lm, L_EYE_INNER, w, h))

    blendshapes: dict[str, float] = {}
    teeth_visibility: Optional[float] = None
    if result.face_blendshapes:
        blendshapes = {
            bs.category_name: round(bs.score, 4)
            for bs in result.face_blendshapes[0]
        }
        teeth_visibility = blendshapes.get('mouthShrugUpper')

    return FacialMetrics(
        iod_px=       round(iod, 2),
        symmetry=     _symmetry(lm, w, h),
        averageness=  _averageness(lm, w, h, iod),
        golden_ratio= _golden_ratio(lm, w, h),
        face_shape=   _face_proportions(lm, w, h),
        jawline=      _jawline(lm, w, h, iod),
        chin=         _chin(lm, w, h, iod),
        cheekbones=   _cheekbones(lm, w, h, iod),
        midface_ratio=_midface_ratio(lm, w, h),
        eyes=         _eye_metrics(lm, w, h, iod),
        canthal_tilt= _canthal_tilt(lm, w, h),
        eyebrows=     _eyebrow(lm, w, h, iod),
        brow_ridge=   _brow_ridge(lm, w, h, iod),
        ipd=          _ipd(lm, w, h),
        nose=         _nose(lm, w, h, iod),
        lips=         _lips(lm, w, h, iod),
        blendshapes=  blendshapes,
        teeth_visibility=teeth_visibility,
        skin=         _skin_metrics(image_rgb, lm, w, h) if image_rgb is not None else None,
        head_pose=    _head_pose(result),
    )
