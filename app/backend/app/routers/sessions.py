import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from app.config import settings
from app.core import session_store, se_manager
from app.core.rate_limit import limiter
from app.models.session import SessionCreate, SessionResponse, SessionState

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.post("", response_model=SessionResponse, status_code=201)
@limiter.limit("5/minute")
async def create_session(request: Request, body: SessionCreate) -> SessionResponse:
    if session_store.count() >= settings.max_sessions:
        raise HTTPException(status_code=429, detail="Maximum concurrent sessions reached")

    fe_dir = Path(settings.se_fe_dir).resolve()
    try:
        fe_path = fe_dir.joinpath(body.fe_file).resolve()
        fe_path.relative_to(fe_dir)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid file path")
    if not fe_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {body.fe_file}")

    if se_manager.is_busy():
        raise HTTPException(
            status_code=409,
            detail="SE is busy — retry after current operation completes",
            headers={"Retry-After": "1"},
        )

    session_id = str(uuid.uuid4())
    try:
        stats = await se_manager.load_session(session_id, str(fe_path))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    session = SessionState(
        session_id=session_id,
        fe_file=body.fe_file,
        energy=stats["energy"],
        area=stats["area"],
        scale=stats["scale"],
        vertex_count=stats["vertex_count"],
        edge_count=stats["edge_count"],
        facet_count=stats["facet_count"],
    )
    session_store.put(session)
    return SessionResponse(**session.model_dump())


@router.get("", response_model=list[SessionResponse])
async def list_sessions() -> list[SessionResponse]:
    return [SessionResponse(**s.model_dump()) for s in session_store.all_sessions()]


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(session_id: str) -> SessionResponse:
    session = session_store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return SessionResponse(**session.model_dump())


@router.delete("/{session_id}", status_code=204)
async def delete_session(session_id: str) -> None:
    if not session_store.delete(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    se_manager.clear_session(session_id)
