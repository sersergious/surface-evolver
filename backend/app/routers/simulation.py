from fastapi import APIRouter, HTTPException

from bindings.python.se import SEError
from app.core import session_store, job_runner, se_manager
from app.models.job import JobResult
from app.models.mesh import MeshData
from app.models.simulation import IterateRequest, RunCommandRequest, RunCommandResponse
from app.ws.progress import broadcast

router = APIRouter(prefix="/api/sessions", tags=["simulation"])


def _require_session(session_id: str):
    session = session_store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


def _check_busy():
    if se_manager.is_busy():
        raise HTTPException(
            status_code=409,
            detail="SE is busy — retry after current operation completes",
            headers={"Retry-After": "1"},
        )


@router.post("/{session_id}/iterate", response_model=JobResult, status_code=202)
async def iterate(session_id: str, body: IterateRequest) -> JobResult:
    _require_session(session_id)
    _check_busy()

    async def _progress_cb(step: int, total: int, energy: float) -> None:
        await broadcast(
            session_id,
            {"type": "progress", "step": step, "total": total, "energy": energy},
        )

    job = await job_runner.submit_job(session_id, body.steps, _progress_cb)
    return job


@router.post("/{session_id}/run", response_model=RunCommandResponse)
async def run_command(session_id: str, body: RunCommandRequest) -> RunCommandResponse:
    _require_session(session_id)
    _check_busy()

    try:
        result = await se_manager.run_command(session_id, body.command)
    except SEError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except RuntimeError as exc:          # session-mismatch only
        raise HTTPException(status_code=409, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    # Refresh session stats in store
    session = session_store.get(session_id)
    if session:
        session.energy = result["energy"]
        session.area = result["area"]
        session_store.put(session)

    return RunCommandResponse(**result)


@router.get("/{session_id}/mesh", response_model=MeshData)
async def get_mesh(session_id: str) -> MeshData:
    _require_session(session_id)
    _check_busy()

    try:
        return await se_manager.get_mesh(session_id)
    except SEError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except RuntimeError as exc:          # session-mismatch only
        raise HTTPException(status_code=409, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))