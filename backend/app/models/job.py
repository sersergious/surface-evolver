from enum import Enum
from pydantic import BaseModel


class JobStatus(str, Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    cancelled = "cancelled"
    failed = "failed"


class JobResult(BaseModel):
    job_id: str
    session_id: str
    status: JobStatus
    steps_requested: int
    steps_completed: int = 0
    energy_start: float | None = None
    energy_end: float | None = None
    error: str | None = None
