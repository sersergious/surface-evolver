from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import files, sessions, simulation, jobs
from app.ws import progress

app = FastAPI(title="Surface Evolver API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(files.router)
app.include_router(sessions.router)
app.include_router(simulation.router)
app.include_router(jobs.router)
app.include_router(progress.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
