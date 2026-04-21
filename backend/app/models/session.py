from datetime import datetime
from pydantic import BaseModel, Field


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
    last_accessed: datetime = Field(default_factory=datetime.utcnow)


class SessionResponse(SessionState):
    pass
