"""
SE subprocess manager.

Each load_session() kills the previous worker and spawns a fresh Python
subprocess that owns exactly one libse.so instance. This prevents the
double-free / heap corruption that occurs when SE's startup() is called
more than once inside the same process.

All blocking subprocess I/O runs in a single-threaded executor so the
asyncio event loop is never blocked.
"""

import asyncio
import json
import os
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable, Awaitable

from app.models.mesh import MeshData

_executor = ThreadPoolExecutor(max_workers=1)
_lock = asyncio.Lock()
_cancel_flag = threading.Event()
_active_session_id: str | None = None
_worker: subprocess.Popen | None = None

_WORKER_SCRIPT = str(Path(__file__).with_name("se_worker.py"))


# ── subprocess lifecycle ───────────────────────────────────────────────────

def _kill_worker() -> None:
    """Kill the current worker process and wait for it to exit."""
    global _worker
    if _worker is not None:
        try:
            _worker.kill()
            _worker.wait(timeout=5)
        except Exception:
            pass
        _worker = None


def _spawn_worker() -> subprocess.Popen:
    """Kill any existing worker then start a fresh one."""
    global _worker
    _kill_worker()
    _worker = subprocess.Popen(
        [sys.executable, _WORKER_SCRIPT],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
        bufsize=1,          # line-buffered
        env=os.environ,     # pass SE_LIB_PATH, PYTHONPATH, etc.
    )
    return _worker


# ── low-level I/O helpers ──────────────────────────────────────────────────

def _send(proc: subprocess.Popen, obj: dict) -> None:
    proc.stdin.write(json.dumps(obj) + "\n")
    proc.stdin.flush()


def _recv_result(proc: subprocess.Popen) -> dict:
    """Read lines from the worker until a {type: result} line arrives."""
    while True:
        line = proc.stdout.readline()
        if not line:
            raise RuntimeError("SE worker process terminated unexpectedly")
        line = line.strip()
        if not line:
            continue
        data = json.loads(line)
        if data.get("type") == "result":
            return data
        # Ignore progress lines (shouldn't appear here, but be defensive)


def _check_result(data: dict) -> dict:
    """Raise the appropriate exception if the result indicates failure."""
    if data.get("ok"):
        return data
    from bindings.python.se import SEError
    if "se_error" in data:
        raise SEError(data["se_error"])
    raise RuntimeError(data.get("error") or "SE worker returned an error")


# ── public API ─────────────────────────────────────────────────────────────

def is_busy() -> bool:
    return _lock.locked()


async def load_session(session_id: str, fe_path: str) -> dict:
    global _active_session_id

    def _do() -> dict:
        proc = _spawn_worker()
        _send(proc, {"cmd": "load", "path": fe_path})
        return _check_result(_recv_result(proc))

    async with _lock:
        _active_session_id = session_id
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(_executor, _do)
    return result


async def run_command(session_id: str, command: str) -> dict:
    def _do() -> dict:
        if _worker is None:
            raise RuntimeError(f"No active SE worker for session {session_id!r}")
        _send(_worker, {"cmd": "run", "command": command})
        return _check_result(_recv_result(_worker))

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
    def _do() -> MeshData:
        if _worker is None:
            raise RuntimeError(f"No active SE worker for session {session_id!r}")
        _send(_worker, {"cmd": "mesh"})
        data = _check_result(_recv_result(_worker))
        body_volumes = {int(k): v for k, v in data["body_volumes"].items()}
        return MeshData(
            vertices=data["vertices"],
            vertex_ids=data["vertex_ids"],
            facets=data["facets"],
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
    loop = asyncio.get_running_loop()

    def _run_in_thread() -> dict:
        if _worker is None:
            raise RuntimeError(f"No active SE worker for session {session_id!r}")
        proc = _worker
        _cancel_flag.clear()
        _send(proc, {"cmd": "iterate", "steps": steps})

        energy_start: float | None = None
        steps_done = 0

        while True:
            # Check for cancel before blocking on readline
            if _cancel_flag.is_set():
                # Process already killed by cancel_current(); drain is gone.
                return {
                    "steps_completed": steps_done,
                    "energy_start": energy_start,
                    "energy_end": None,
                }

            line = proc.stdout.readline()
            if not line:
                # EOF: process was killed (cancel) or crashed
                if _cancel_flag.is_set():
                    return {
                        "steps_completed": steps_done,
                        "energy_start": energy_start,
                        "energy_end": None,
                    }
                raise RuntimeError("SE worker terminated during iteration")

            data = json.loads(line.strip())
            t = data.get("type")

            if t == "progress":
                if energy_start is None:
                    energy_start = data["energy"]
                steps_done = data["step"]
                asyncio.run_coroutine_threadsafe(
                    progress_cb(data["step"], data["total"], data["energy"]),
                    loop,
                )

            elif t == "result":
                return _check_result(data)

    async with _lock:
        if _active_session_id != session_id:
            raise RuntimeError(
                f"Session {session_id!r} is not currently loaded "
                f"(active: {_active_session_id!r})"
            )
        result = await loop.run_in_executor(_executor, _run_in_thread)
    return result


def clear_session(session_id: str) -> None:
    global _active_session_id
    if _active_session_id == session_id:
        _active_session_id = None
        _kill_worker()


def cancel_current() -> None:
    """Signal the running iterate_async to stop. Non-blocking."""
    _cancel_flag.set()
    # Kill the worker non-blockingly (no wait — we're on the event loop thread)
    global _worker
    if _worker is not None:
        try:
            _worker.kill()
        except Exception:
            pass
        # Don't set _worker = None here; _run_in_thread will see EOF and return.
        # The next _spawn_worker() call will reap the zombie via wait().


def clear_cancel() -> None:
    _cancel_flag.clear()
