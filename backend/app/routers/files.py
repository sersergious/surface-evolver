from pathlib import Path

from fastapi import APIRouter

from app.config import settings

router = APIRouter(prefix="/api/files", tags=["files"])


@router.get("")
async def list_files() -> list[str]:
    """Return names of bundled .fe files from SE_FE_DIR."""
    fe_dir = Path(settings.se_fe_dir)
    if not fe_dir.is_dir():
        return []
    return sorted(p.name for p in fe_dir.glob("*.fe"))
