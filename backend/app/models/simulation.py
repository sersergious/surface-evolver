from pydantic import BaseModel


class IterateRequest(BaseModel):
    steps: int = 100


class RunCommandRequest(BaseModel):
    command: str


class RunCommandResponse(BaseModel):
    output: str
    energy: float | None = None
    area: float | None = None
