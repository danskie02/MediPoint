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


def categorize_rr(resp_rate: float) -> str:
    if resp_rate < 12:
        return "BRADYPNEA (LOW)"
    if resp_rate > 20:
        return "TACHYPNEA (HIGH)"
    return "NORMAL"


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

    rr_result = _find_result(
        results,
        "Respiratory Rate",
        "Respiration Rate",
        "Breathing Rate",
    )
    if rr_result:
        resp_rate = _parse_number(rr_result.get("value"))
        if resp_rate is not None:
            vitals["resp_rate"] = resp_rate

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

    payload = {
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

    # Optional vital: included for interpretations/safeguards, not RF model features.
    if "resp_rate" in vitals:
        payload["resp_rate"] = vitals["resp_rate"]
        payload["rr_category"] = categorize_rr(vitals["resp_rate"])

    return payload


NORMAL_CATEGORY_VALUES = {
    "temp_category": frozenset({"NORMAL"}),
    "bp_category": frozenset({"NORMAL"}),
    "hr_category": frozenset({"NORMAL"}),
    "ox_category": frozenset({"Normal"}),
    "rr_category": frozenset({"NORMAL"}),
    "bmi_category": frozenset({"NORMAL WEIGHT"}),
}


def count_abnormal_vitals(patient: dict[str, Any]) -> int:
    """Count how many categorized vitals fall outside their normal band."""

    abnormal = 0
    for key, normal_values in NORMAL_CATEGORY_VALUES.items():
        category = str(patient.get(key) or "")
        if category and category not in normal_values:
            abnormal += 1
    return abnormal


def recommendation_from_abnormal_count(abnormal_count: int) -> str:
    """
    Map abnormal vital count to CareMate triage recommendation.

    - 0 abnormal → Maintain Healthy
    - 1 or 2 abnormal → Lifestyle Changes and Monitoring
    - 3 or more abnormal → Emergency Care Required
    """

    if abnormal_count <= 0:
        return "MAINTAIN_HEALTHY"
    if abnormal_count <= 2:
        return "LIFESTYLE_AND_MONITOR"
    return "EMERGENCY_CARE"


def apply_vital_count_recommendation(
    model_recommendation: str,
    patient: dict[str, Any],
) -> tuple[str, bool, int]:
    """Override the RF label with the vital-count triage rule."""

    abnormal_count = count_abnormal_vitals(patient)
    rule_recommendation = recommendation_from_abnormal_count(abnormal_count)
    overridden = rule_recommendation != str(model_recommendation)
    return rule_recommendation, overridden, abnormal_count


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

    model_recommendation = str(
        encoders["le_target"].inverse_transform([prediction_encoded])[0]
    )
    probability_map = {
        label: round(float(probability), 4)
        for label, probability in zip(classes, probabilities)
    }
    recommendation, rule_applied, abnormal_count = apply_vital_count_recommendation(
        model_recommendation,
        patient,
    )

    return {
        "recommendation": recommendation,
        "probabilities": probability_map,
        "features": patient,
        "interpretations": build_vital_interpretations(patient),
        "modelRecommendation": model_recommendation,
        "safeguardApplied": rule_applied,
        "abnormalVitalCount": abnormal_count,
    }


def build_vital_interpretations(patient: dict[str, Any]) -> list[dict[str, str]]:
    """Translate categorized vitals into plain-language measurement indications."""

    interpretations: list[dict[str, str]] = []

    temp_c = patient.get("temp_c")
    temp_category = str(patient.get("temp_category") or "")
    if temp_c is not None and temp_category:
        temp_meanings = {
            "NORMAL": "a normal body temperature",
            "LOW-GRADE FEVER": "a low-grade fever",
            "FEVER": "fever",
            "HIGH FEVER": "a high fever",
            "HYPOTHERMIA": "hypothermia (below-normal body temperature)",
        }
        interpretations.append(
            {
                "metric": "Body Temperature",
                "value": f"{temp_c} °C",
                "category": temp_category,
                "indication": temp_meanings.get(temp_category, temp_category.lower()),
                "text": (
                    f"Body Temperature of {temp_c} °C indicates "
                    f"{temp_meanings.get(temp_category, temp_category.lower())}."
                ),
            }
        )

    systolic = patient.get("SYS_BP")
    diastolic = patient.get("DIA_BP")
    bp_category = str(patient.get("bp_category") or "")
    if systolic is not None and diastolic is not None and bp_category:
        bp_meanings = {
            "NORMAL": "normal blood pressure",
            "LOW BLOOD PRESSURE": "low blood pressure (hypotension)",
            "HYPERTENSION STAGE 1": "stage 1 hypertension",
            "HYPERTENSION STAGE 2": "stage 2 hypertension",
            "HYPERTENSIVE CRISIS": "a hypertensive crisis reading",
        }
        interpretations.append(
            {
                "metric": "Blood Pressure",
                "value": f"{systolic}/{diastolic} mmHg",
                "category": bp_category,
                "indication": bp_meanings.get(bp_category, bp_category.lower()),
                "text": (
                    f"Blood Pressure of {systolic}/{diastolic} mmHg indicates "
                    f"{bp_meanings.get(bp_category, bp_category.lower())}."
                ),
            }
        )

    heart_rate = patient.get("heart_rate")
    hr_category = str(patient.get("hr_category") or "")
    if heart_rate is not None and hr_category:
        hr_meanings = {
            "NORMAL": "a normal resting heart rate",
            "BRADYCARDIA (LOW)": "bradycardia (a low heart rate)",
            "TACHYCARDIA (HIGH)": "tachycardia (an elevated heart rate)",
        }
        interpretations.append(
            {
                "metric": "Heart Rate",
                "value": f"{heart_rate} bpm",
                "category": hr_category,
                "indication": hr_meanings.get(hr_category, hr_category.lower()),
                "text": (
                    f"Heart Rate of {heart_rate} bpm indicates "
                    f"{hr_meanings.get(hr_category, hr_category.lower())}."
                ),
            }
        )

    spo2 = patient.get("spo2")
    ox_category = str(patient.get("ox_category") or "")
    if spo2 is not None and ox_category:
        ox_meanings = {
            "Normal": "normal oxygen saturation",
            "Hypoxemia": "mildly reduced oxygen saturation (hypoxemia)",
            "Severe Hypoxemia": "severely reduced oxygen saturation",
        }
        interpretations.append(
            {
                "metric": "Oxygen Saturation",
                "value": f"{spo2}%",
                "category": ox_category,
                "indication": ox_meanings.get(ox_category, ox_category.lower()),
                "text": (
                    f"Oxygen Saturation of {spo2}% indicates "
                    f"{ox_meanings.get(ox_category, ox_category.lower())}."
                ),
            }
        )

    resp_rate = patient.get("resp_rate")
    rr_category = str(patient.get("rr_category") or "")
    if resp_rate is not None and rr_category:
        rr_meanings = {
            "NORMAL": "a normal resting respiratory rate",
            "BRADYPNEA (LOW)": "bradypnea (a low respiratory rate)",
            "TACHYPNEA (HIGH)": "tachypnea (an elevated respiratory rate)",
        }
        interpretations.append(
            {
                "metric": "Respiratory Rate",
                "value": f"{resp_rate} breaths/min",
                "category": rr_category,
                "indication": rr_meanings.get(rr_category, rr_category.lower()),
                "text": (
                    f"Respiratory Rate of {resp_rate} breaths/min indicates "
                    f"{rr_meanings.get(rr_category, rr_category.lower())}."
                ),
            }
        )

    bmi = patient.get("BMI")
    bmi_category = str(patient.get("bmi_category") or "")
    if bmi is not None and bmi_category:
        bmi_meanings = {
            "UNDERWEIGHT": "an underweight BMI category",
            "NORMAL WEIGHT": "a normal BMI category",
            "OVERWEIGHT": "an overweight BMI category",
            "OBESE": "an obese BMI category",
        }
        interpretations.append(
            {
                "metric": "BMI",
                "value": str(bmi),
                "category": bmi_category,
                "indication": bmi_meanings.get(bmi_category, bmi_category.lower()),
                "text": (
                    f"BMI of {bmi} indicates "
                    f"{bmi_meanings.get(bmi_category, bmi_category.lower())}."
                ),
            }
        )

    return interpretations
