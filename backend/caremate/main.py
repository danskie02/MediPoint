"""CareMate AI triage API for MediPoint."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from predict import load_artifacts, predict_assessment

app = FastAPI(title="MediPoint CareMate API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PredictRequest(BaseModel):
    results: list[dict[str, Any]] = Field(default_factory=list)
    birthday: str | None = None
    gender: str | None = None
    age: float | None = None


@app.on_event("startup")
def startup() -> None:
    load_artifacts()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "caremate"}


@app.post("/predict")
def predict(payload: PredictRequest) -> dict[str, Any]:
    if not payload.results:
        raise HTTPException(status_code=400, detail="Assessment results are required.")

    try:
        return predict_assessment(
            payload.results,
            birthday=payload.birthday,
            gender=payload.gender,
            age=payload.age,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail="CareMate prediction failed.") from error
