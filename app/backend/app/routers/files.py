import re
from pathlib import Path

from fastapi import APIRouter

from app.config import settings

router = APIRouter(prefix="/api/files", tags=["files"])

# Patterns that indicate a file cannot be rendered with the current viewer:
#   SIMPLEX_REPRESENTATION — higher-dimensional simplex (e.g. 4-space bubble)
#   space_dimension N where N < 3 — 2D or 1D space, crashes libse on some files
_UNSUPPORTED = [
    re.compile(r'^\s*SIMPLEX_REPRESENTATION\b', re.IGNORECASE),
    re.compile(r'^\s*space_dimension\s+[12]\b', re.IGNORECASE),
]


def _is_renderable(path: Path) -> bool:
    try:
        with path.open('r', errors='replace') as f:
            for i, line in enumerate(f):
                if i >= 120:
                    break
                for pat in _UNSUPPORTED:
                    if pat.match(line):
                        return False
    except OSError:
        return False
    return True


@router.get("")
async def list_files() -> list[str]:
    """Return names of bundled .fe files from SE_FE_DIR."""
    fe_dir = Path(settings.se_fe_dir)
    if not fe_dir.is_dir():
        return []
    return sorted(p.name for p in fe_dir.glob("*.fe") if _is_renderable(p))
