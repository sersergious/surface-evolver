from pydantic import BaseModel


class SessionCreate(BaseModel):
    fe_file: str


class SessionState(BaseModel):
    session_id: str
    fe_file: str
    energy: float | None = None
    area: float | None = None
    scale: float | None = None
    vertex_count: int | None = None
    facet_count: int | None = None
    edge_count: int | None = None


class SessionResponse(SessionState):
    pass
