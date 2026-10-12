"""CareMate AI triage API for MediPoint."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from predict import load_artifacts, predict_assessment
from test_bp import BloodPressureMonitorService

app = FastAPI(title="MediPoint CareMate API", version="1.0.0")
monitor_service = BloodPressureMonitorService()

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
async def startup() -> None:
    load_artifacts()
    await monitor_service.start()


@app.on_event("shutdown")
async def shutdown() -> None:
    await monitor_service.stop()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "caremate"}


@app.post("/bp/start")
async def start_blood_pressure_monitor() -> dict[str, Any]:
    await monitor_service.start()
    return {"status": "started", "after_revision": monitor_service.revision}


@app.get("/bp/latest")
def get_latest_blood_pressure() -> dict[str, Any]:
    return {"latest": monitor_service.latest}


@app.post("/bp/stop")
async def stop_blood_pressure_monitor() -> dict[str, Any]:
    latest = await monitor_service.stop()
    return {"status": "stopped", "latest": latest}


@app.post("/bp/wait")
async def wait_for_blood_pressure_result(
    after_revision: int = 0, timeout_seconds: float = 120.0
) -> dict[str, Any]:
    latest = await monitor_service.wait_for_result(
        after_revision=after_revision, timeout_seconds=timeout_seconds
    )
    return {"latest": latest}


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
