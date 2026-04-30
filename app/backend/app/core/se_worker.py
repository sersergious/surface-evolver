"""
SE worker subprocess.
Spawned once per session by se_manager. Handles one .fe file per lifetime,
so libse.so startup() is only called once — matching SE's original design.

Protocol: line-delimited JSON on stdin/stdout.
  stdin  <- {"cmd": "load"|"run"|"mesh"|"iterate"|"cancel", ...}
  stdout -> {"type": "result", "ok": true|false, ...}
           {"type": "progress", "step": N, "total": M, "energy": E}  (iterate only)
"""
import json
import os
import sys

# PYTHONPATH=/app is set in Docker; locally it must be on sys.path
_here = os.path.dirname(os.path.abspath(__file__))
_root = os.path.normpath(os.path.join(_here, "..", "..", "..", ".."))
if _root not in sys.path:
    sys.path.insert(0, _root)

try:
    from bindings.python.se import SurfaceEvolver, SEError  # type: ignore
    _se = SurfaceEvolver(os.environ.get("SE_LIB_PATH"))
except Exception as _exc:
    sys.stdout.write(json.dumps({"type": "fatal", "error": str(_exc)}) + "\n")
    sys.stdout.flush()
    sys.exit(1)

_cancel = False


def _send(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def _handle_load(req: dict) -> dict:
    _se.load(req["path"])
    return {
        "ok": True,
        "energy": _se.energy,
        "area": _se.area,
        "scale": _se.scale,
        "vertex_count": _se.vertex_count(),
        "edge_count": _se.edge_count(),
        "facet_count": _se.facet_count(),
    }


def _handle_run(req: dict) -> dict:
    output = _se.run(req["command"])
    return {"ok": True, "output": output, "energy": _se.energy, "area": _se.area}


def _handle_mesh(_req: dict) -> dict:
    vertices = [list(v) for v in _se.get_vertices()]
    vertex_ids = _se.get_vertex_ids()
    facets = [list(f) for f in _se.get_facets()]
    body_data = _se.get_body_volumes()
    # JSON keys must be strings
    body_volumes = {str(i + 1): bd["volume"] for i, bd in enumerate(body_data)}
    return {
        "ok": True,
        "vertices": vertices,
        "vertex_ids": vertex_ids,
        "facets": facets,
        "body_volumes": body_volumes,
    }


def _handle_iterate(req: dict) -> None:
    """Streams progress lines then sends a final result line."""
    global _cancel
    _cancel = False
    steps = req["steps"]
    energy_start = _se.energy
    steps_done = 0
    batch = 10

    while steps_done < steps:
        if _cancel:
            break
        n = min(batch, steps - steps_done)
        _se.run(f"g {n}")
        steps_done += n
        _send({"type": "progress", "step": steps_done, "total": steps, "energy": _se.energy})

    _send({
        "type": "result",
        "ok": True,
        "steps_completed": steps_done,
        "energy_start": energy_start,
        "energy_end": _se.energy,
    })


_HANDLERS = {"load": _handle_load, "run": _handle_run, "mesh": _handle_mesh}

for _line in sys.stdin:
    _line = _line.strip()
    if not _line:
        continue
    try:
        _req = json.loads(_line)
        _cmd = _req.get("cmd", "")

        if _cmd == "cancel":
            _cancel = True
            _send({"type": "result", "ok": True})
            continue

        if _cmd == "iterate":
            try:
                _handle_iterate(_req)
            except SEError as _e:
                _send({"type": "result", "ok": False, "se_error": str(_e)})
            except Exception as _e:
                _send({"type": "result", "ok": False, "error": str(_e)})
            continue

        _handler = _HANDLERS.get(_cmd)
        if _handler is None:
            _send({"type": "result", "ok": False, "error": f"unknown cmd: {_cmd}"})
            continue

        _result = _handler(_req)
        _send({"type": "result", **_result})

    except SEError as _e:
        _send({"type": "result", "ok": False, "se_error": str(_e)})
    except Exception as _e:
        _send({"type": "result", "ok": False, "error": str(_e)})
