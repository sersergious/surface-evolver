"""
WebSocket endpoint: WS /api/ws/sessions/{session_id}/progress

Clients connect and receive JSON messages:
  { "type": "progress", "step": int, "total": int, "energy": float }
  { "type": "completed", "energy": float }
  { "type": "error", "message": str }
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core import session_store

router = APIRouter(prefix="/api/ws", tags=["ws"])

# Simple per-session connection registry
_connections: dict[str, list[WebSocket]] = {}


def _register(session_id: str, ws: WebSocket) -> None:
    _connections.setdefault(session_id, []).append(ws)


def _unregister(session_id: str, ws: WebSocket) -> None:
    conns = _connections.get(session_id, [])
    if ws in conns:
        conns.remove(ws)


async def broadcast(session_id: str, message: dict) -> None:
    """Send a message to all connected clients for this session."""
    for ws in list(_connections.get(session_id, [])):
        try:
            await ws.send_json(message)
        except Exception:
            _unregister(session_id, ws)


@router.websocket("/sessions/{session_id}/progress")
async def progress_ws(websocket: WebSocket, session_id: str) -> None:
    if not session_store.exists(session_id):
        await websocket.close(code=4004)
        return

    await websocket.accept()
    _register(session_id, websocket)
    try:
        while True:
            # Keep connection alive; server pushes via broadcast()
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _unregister(session_id, websocket)
