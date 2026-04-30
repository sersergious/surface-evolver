from datetime import datetime

from app.models.session import SessionState

# In-memory store: session_id -> SessionState
_store: dict[str, SessionState] = {}


def get(session_id: str) -> SessionState | None:
    session = _store.get(session_id)
    if session:
        session.last_accessed = datetime.utcnow()
    return session


def count() -> int:
    return len(_store)


def all_sessions() -> list[SessionState]:
    return list(_store.values())


def put(session: SessionState) -> None:
    _store[session.session_id] = session


def delete(session_id: str) -> bool:
    if session_id in _store:
        del _store[session_id]
        return True
    return False


def exists(session_id: str) -> bool:
    return session_id in _store
