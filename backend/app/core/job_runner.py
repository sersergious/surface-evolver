"""
Manages long-running iterate jobs. Each job runs iterate_async and tracks
progress. Results are stored in an in-memory dict keyed by job_id.
"""

import asyncio
import uuid
from typing import Callable, Awaitable

from app.models.job import JobResult, JobStatus
from app.core import se_manager

_jobs: dict[str, JobResult] = {}


def get_job(job_id: str) -> JobResult | None:
    return _jobs.get(job_id)


def cancel_job(job_id: str) -> bool:
    job = _jobs.get(job_id)
    if job and job.status in (JobStatus.queued, JobStatus.running):
        se_manager.cancel_current()
        job.status = JobStatus.cancelled
        return True
    return False


async def submit_job(
    session_id: str,
    steps: int,
    progress_cb: Callable[[int, int, float], Awaitable[None]] | None = None,
) -> JobResult:
    job_id = str(uuid.uuid4())
    job = JobResult(
        job_id=job_id,
        session_id=session_id,
        status=JobStatus.queued,
        steps_requested=steps,
    )
    _jobs[job_id] = job

    async def _run() -> None:
        # Import here to avoid module-level circular import
        from app.ws.progress import broadcast

        job.status = JobStatus.running
        se_manager.clear_cancel()
        try:
            result = await se_manager.iterate_async(session_id, steps, progress_cb or _noop_cb)
            job.steps_completed = result["steps_completed"]
            job.energy_start = result.get("energy_start")
            job.energy_end = result.get("energy_end")
            job.status = JobStatus.completed
            await broadcast(session_id, {"type": "completed", "energy": job.energy_end})
        except asyncio.CancelledError:
            job.status = JobStatus.cancelled
        except Exception as exc:
            job.status = JobStatus.failed
            job.error = str(exc)
            await broadcast(session_id, {"type": "error", "message": str(exc)})

    asyncio.create_task(_run())
    return job


async def _noop_cb(step: int, total: int, energy: float) -> None:
    pass
