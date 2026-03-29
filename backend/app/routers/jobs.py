from fastapi import APIRouter, HTTPException

from app.core import job_runner
from app.models.job import JobResult

router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"])


@router.get("/{job_id}", response_model=JobResult)
async def get_job(job_id: str) -> JobResult:
    job = job_runner.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.delete("/{job_id}", status_code=204)
async def cancel_job(job_id: str) -> None:
    if not job_runner.cancel_job(job_id):
        raise HTTPException(status_code=404, detail="Job not found or already finished")
