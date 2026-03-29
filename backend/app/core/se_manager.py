"""
SE singleton that serializes access to libse.so via asyncio.Lock +
ThreadPoolExecutor(max_workers=1).
"""

import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Awaitable

from app.config import settings
from app.models.mesh import MeshData

_executor = ThreadPoolExecutor(max_workers=1)
_lock = asyncio.Lock()
_cancel_flag = threading.Event()
_active_session_id: str | None = None
_se = None


def _get_se():
    global _se
    if _se is None:
        from bindings.python.se import SurfaceEvolver
        _se = SurfaceEvolver(settings.se_lib_path)
    return _se


def is_busy() -> bool:
    """Return True if the SE lock is currently held."""
    return _lock.locked()


async def load_session(session_id: str, fe_path: str) -> dict:
    """Load a .fe file into the SE singleton. Returns stats dict."""
    global _active_session_id

    def _do() -> dict:
        se = _get_se()
        se.load(fe_path)
        return {
            "energy": se.energy,
            "area": se.area,
            "scale": se.scale,
            "vertex_count": se.vertex_count(),
            "edge_count": se.edge_count(),
            "facet_count": se.facet_count(),
        }

    async with _lock:
        _active_session_id = session_id
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(_executor, _do)
    return result


async def run_command(session_id: str, command: str) -> dict:
    """Run a single SE command. Returns {output, energy, area}."""
    def _do() -> dict:
        se = _get_se()
        output = se.run(command)
        return {
            "output": output,
            "energy": se.energy,
            "area": se.area,
        }

    async with _lock:
        if _active_session_id != session_id:
            raise RuntimeError(
                f"Session {session_id!r} is not currently loaded "
                f"(active: {_active_session_id!r})"
            )
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(_executor, _do)
    return result


async def get_mesh(session_id: str) -> MeshData:
    """Return current mesh data from the SE singleton."""
    def _do() -> MeshData:
        se = _get_se()
        vertices = [list(v) for v in se.get_vertices()]
        vertex_ids = se.get_vertex_ids()
        facets = [list(f) for f in se.get_facets()]
        body_data = se.get_body_volumes()
        body_volumes = {i + 1: bd["volume"] for i, bd in enumerate(body_data)}
        return MeshData(
            vertices=vertices,
            vertex_ids=vertex_ids,
            facets=facets,
            body_volumes=body_volumes,
        )

    async with _lock:
        if _active_session_id != session_id:
            raise RuntimeError(
                f"Session {session_id!r} is not currently loaded "
                f"(active: {_active_session_id!r})"
            )
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(_executor, _do)
    return result


async def iterate_async(
    session_id: str,
    steps: int,
    progress_cb: Callable[[int, int, float], Awaitable[None]],
) -> dict:
    """
    Run `steps` iterations in batches of 10, emitting progress via progress_cb.
    Returns {steps_completed, energy_start, energy_end}.
    """
    loop = asyncio.get_running_loop()

    def _run_in_thread() -> dict:
        se = _get_se()
        energy_start = se.energy
        steps_completed = 0
        batch = 10

        while steps_completed < steps:
            if _cancel_flag.is_set():
                break
            n = min(batch, steps - steps_completed)
            se.run(f"g {n}")   # drains output buffer + raises SEError on failure
            steps_completed += n
            energy = se.energy
            asyncio.run_coroutine_threadsafe(
                progress_cb(steps_completed, steps, energy), loop
            )

        return {
            "steps_completed": steps_completed,
            "energy_start": energy_start,
            "energy_end": se.energy,
        }

    async with _lock:
        if _active_session_id != session_id:
            raise RuntimeError(
                f"Session {session_id!r} is not currently loaded "
                f"(active: {_active_session_id!r})"
            )
        result = await loop.run_in_executor(_executor, _run_in_thread)
    return result


def cancel_current() -> None:
    """Signal the running iterate_async to stop after the current batch."""
    _cancel_flag.set()


def clear_cancel() -> None:
    _cancel_flag.clear()