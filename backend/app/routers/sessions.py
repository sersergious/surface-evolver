import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.config import settings
from app.core import session_store, se_manager
from app.models.session import SessionCreate, SessionResponse, SessionState

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.post("", response_model=SessionResponse, status_code=201)
async def create_session(body: SessionCreate) -> SessionResponse:
    fe_path = Path(settings.se_fe_dir) / body.fe_file
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
