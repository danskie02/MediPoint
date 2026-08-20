"""CareMate Random Forest inference helpers."""

from __future__ import annotations

import re
from datetime import date, datetime
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
MODEL_PATH = REPO_ROOT / "caremate_rf_model.joblib"
ENCODERS_PATH = REPO_ROOT / "caremate_encoders.joblib"

_rf_model = None
_encoders = None


def load_artifacts() -> None:
    global _rf_model, _encoders

    if _rf_model is None:
        _rf_model = joblib.load(MODEL_PATH)

    if _encoders is None:
        _encoders = joblib.load(ENCODERS_PATH)


def compute_age(birthday: str | None, age: int | float | None = None) -> float:
    if age is not None:
        return float(age)

    if not birthday:
        return 25.0

    text = str(birthday).strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y"):
        try:
            born = datetime.strptime(text, fmt).date()
            today = date.today()
            years = today.year - born.year
            if (today.month, today.day) < (born.month, born.day):
                years -= 1
            return float(max(years, 0))
        except ValueError:
            continue

    return 25.0


def normalize_gender(value: str | None) -> str:
    text = str(value or "").strip().lower()
    if text in {"female", "f", "woman"}:
        return "Female"
    if text in {"male", "m", "man"}:
        return "Male"
    return "Male"


def categorize_bmi(bmi: float) -> str:
    if bmi < 18.5:
        return "UNDERWEIGHT"
    if bmi < 25:
        return "NORMAL WEIGHT"
    if bmi < 30:
        return "OVERWEIGHT"
    return "OBESE"


def categorize_bp(systolic: float, diastolic: float) -> str:
    if systolic > 180 or diastolic > 120:
        return "HYPERTENSIVE CRISIS"
    if systolic >= 140 or diastolic >= 90:
        return "HYPERTENSION STAGE 2"
    if systolic >= 130 or diastolic >= 80:
        return "HYPERTENSION STAGE 1"
    if systolic < 90 or diastolic < 60:
        return "LOW BLOOD PRESSURE"
    return "NORMAL"


def categorize_hr(heart_rate: float) -> str:
    if heart_rate < 60:
        return "BRADYCARDIA (LOW)"
    if heart_rate > 100:
        return "TACHYCARDIA (HIGH)"
    return "NORMAL"


def categorize_temp(temp_c: float) -> str:
    if temp_c < 35:
        return "HYPOTHERMIA"
    if temp_c < 37.5:
        return "NORMAL"
    if temp_c <= 38.0:
        return "LOW-GRADE FEVER"
    if temp_c <= 39.0:
        return "FEVER"
    return "HIGH FEVER"


def categorize_spo2(spo2: float) -> str:
    if spo2 < 90:
        return "Severe Hypoxemia"
    if spo2 < 95:
        return "Hypoxemia"
    return "Normal"


def _find_result(results: list[dict[str, Any]], *titles: str) -> dict[str, Any] | None:
    normalized = {title.strip().lower() for title in titles}
    for result in results:
        title = str(result.get("title", "")).strip().lower()
        if title in normalized:
            return result
    return None


def _parse_number(value: Any) -> float | None:
    if value is None:
        return None

    match = re.search(r"([\d.]+)", str(value))
    if not match:
        return None

    try:
        return float(match.group(1))
    except ValueError:
        return None


def _extract_pattern(text: str, pattern: str) -> float | None:
    match = re.search(pattern, text, re.IGNORECASE)
    return _parse_number(match.group(1)) if match else None


def extract_vitals_from_results(results: list[dict[str, Any]]) -> dict[str, float]:
    vitals: dict[str, float] = {}

    combined = _find_result(
        results,
        "Height & Weight",
        "Height and Weight",
        "Weight & BMI",
    )
    if combined:
        combined_value = str(combined.get("value", ""))
        height = _extract_pattern(combined_value, r"([\d.]+)\s*cm")
        weight = _extract_pattern(combined_value, r"([\d.]+)\s*kg")
        bmi = _extract_pattern(combined_value, r"BMI\s*([\d.]+)")
    else:
        height_result = _find_result(results, "Height")
        weight_result = _find_result(results, "Weight")
        bmi_result = _find_result(results, "BMI")

        height = _parse_number(height_result.get("value") if height_result else None)
        weight = _parse_number(weight_result.get("value") if weight_result else None)
        bmi = _parse_number(bmi_result.get("value") if bmi_result else None)

        if bmi is None and height and weight and height > 0:
            height_m = height / 100.0
            bmi = round(weight / (height_m * height_m), 1)

    if height:
        vitals["height_cm"] = height
    if weight:
        vitals["weight_kg"] = weight
    if bmi:
        vitals["BMI"] = bmi

    bp_result = _find_result(results, "Blood Pressure")
    if bp_result:
        bp_value = str(bp_result.get("value", ""))
        parts = bp_value.split("/")
        if len(parts) == 2:
            systolic = _parse_number(parts[0])
            diastolic = _parse_number(parts[1])
            if systolic is not None:
                vitals["SYS_BP"] = systolic
            if diastolic is not None:
                vitals["DIA_BP"] = diastolic

    hr_result = _find_result(results, "Heart Rate")
    if hr_result:
        heart_rate = _parse_number(hr_result.get("value"))
        if heart_rate is not None:
            vitals["heart_rate"] = heart_rate

    temp_result = _find_result(results, "Body Temperature")
    if temp_result:
        temp_c = _parse_number(temp_result.get("value"))
        if temp_c is not None:
            vitals["temp_c"] = temp_c

    spo2_result = _find_result(results, "Oxygen Saturation")
    if spo2_result:
        spo2 = _parse_number(spo2_result.get("value"))
        if spo2 is not None:
            vitals["spo2"] = spo2

    return vitals


REQUIRED_VITALS = (
    "height_cm",
    "weight_kg",
    "BMI",
    "SYS_BP",
    "DIA_BP",
    "heart_rate",
    "temp_c",
    "spo2",
)


def build_patient_payload(
    results: list[dict[str, Any]],
    *,
    birthday: str | None = None,
    gender: str | None = None,
    age: int | float | None = None,
) -> dict[str, Any]:
    vitals = extract_vitals_from_results(results)
    missing = [key for key in REQUIRED_VITALS if key not in vitals]
    if missing:
        raise ValueError(f"Missing required vitals: {', '.join(missing)}")

    gender_label = normalize_gender(gender)
    bmi = vitals["BMI"]
    systolic = vitals["SYS_BP"]
    diastolic = vitals["DIA_BP"]

    return {
        "AGE": compute_age(birthday, age),
        "height_cm": vitals["height_cm"],
        "weight_kg": vitals["weight_kg"],
        "BMI": bmi,
        "SYS_BP": systolic,
        "DIA_BP": diastolic,
        "heart_rate": vitals["heart_rate"],
        "temp_c": vitals["temp_c"],
        "spo2": vitals["spo2"],
        "GENDER": gender_label,
        "bmi_category": categorize_bmi(bmi),
        "bp_category": categorize_bp(systolic, diastolic),
        "hr_category": categorize_hr(vitals["heart_rate"]),
        "temp_category": categorize_temp(vitals["temp_c"]),
        "ox_category": categorize_spo2(vitals["spo2"]),
    }


def predict_assessment(
    results: list[dict[str, Any]],
    *,
    birthday: str | None = None,
    gender: str | None = None,
    age: int | float | None = None,
) -> dict[str, Any]:
    load_artifacts()

    patient = build_patient_payload(
        results,
        birthday=birthday,
        gender=gender,
        age=age,
    )

    encoders = _encoders
    feature_cols = encoders["feature_cols"]

    patient_df = pd.DataFrame([patient])
    patient_df["gender_enc"] = encoders["le_gender"].transform(patient_df["GENDER"])
    patient_df["bmi_enc"] = encoders["le_bmi"].transform(patient_df["bmi_category"])
    patient_df["bp_enc"] = encoders["le_bp"].transform(patient_df["bp_category"])
    patient_df["hr_enc"] = encoders["le_hr"].transform(patient_df["hr_category"])
    patient_df["temp_enc"] = encoders["le_temp"].transform(patient_df["temp_category"])
    patient_df["ox_enc"] = encoders["le_ox"].transform(patient_df["ox_category"])

    features = patient_df[feature_cols]
    prediction_encoded = _rf_model.predict(features)[0]
    probabilities = _rf_model.predict_proba(features)[0]
    classes = list(encoders["le_target"].classes_)

    recommendation = encoders["le_target"].inverse_transform([prediction_encoded])[0]
    probability_map = {
        label: round(float(probability), 4)
        for label, probability in zip(classes, probabilities)
    }

    return {
        "recommendation": str(recommendation),
        "probabilities": probability_map,
        "features": patient,
    }
