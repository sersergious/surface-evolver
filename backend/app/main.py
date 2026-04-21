import asyncio
import logging
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.config import settings
from app.core import se_manager, session_store
from app.core.rate_limit import limiter
from app.routers import files, sessions, simulation, jobs
from app.ws import progress

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("surface_evolver")

_http_basic = HTTPBasic(auto_error=False)


async def verify_auth(credentials: HTTPBasicCredentials | None = Depends(_http_basic)):
    if not settings.demo_password:
        return
    ok = credentials is not None and secrets.compare_digest(
        credentials.password.encode(), settings.demo_password.encode()
    )
    if not ok:
        logger.warning("auth failure from %s", credentials and credentials.username)
        raise HTTPException(
            status_code=401,
            detail="Unauthorized",
            headers={"WWW-Authenticate": 'Basic realm="demo"'},
        )


async def _evict_loop() -> None:
    while True:
        await asyncio.sleep(300)
        cutoff = datetime.utcnow() - timedelta(minutes=30)
        for s in session_store.all_sessions():
            if s.last_accessed < cutoff:
                session_store.delete(s.session_id)
                se_manager.clear_session(s.session_id)
                logger.info("evicted idle session %s", s.session_id)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_evict_loop())
    yield
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)


_deps = [Depends(verify_auth)]

app = FastAPI(title="Surface Evolver API", version="0.1.0", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(files.router, dependencies=_deps)
app.include_router(sessions.router, dependencies=_deps)
app.include_router(simulation.router, dependencies=_deps)
app.include_router(jobs.router, dependencies=_deps)
app.include_router(progress.router)  # WebSocket: HTTPBasic incompatible with WS upgrade


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
