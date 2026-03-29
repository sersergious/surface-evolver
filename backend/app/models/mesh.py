from pydantic import BaseModel


class MeshData(BaseModel):
    vertices: list[list[float]]
    vertex_ids: list[int]
    facets: list[list[int]]
    body_volumes: dict[int, float]
