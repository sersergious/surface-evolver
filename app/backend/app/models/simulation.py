from pydantic import BaseModel, Field


class IterateRequest(BaseModel):
    steps: int = Field(default=100, ge=1, le=1000)


class RunCommandRequest(BaseModel):
    command: str = Field(max_length=512)


class RunCommandResponse(BaseModel):
    output: str
    energy: float | None = None
    area: float | None = None
