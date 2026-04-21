"""
tests/python/test_backend_api.py

Integration-style tests for the FastAPI backend.
Uses starlette.testclient.TestClient (sync) so no async test runner is needed.
The SE singleton (se_manager) is mocked throughout — libse.so is not required.
"""
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, patch, MagicMock
from starlette.testclient import TestClient

from app.main import app
from app.core import session_store
from app.models.mesh import MeshData
from app.models.job import JobResult, JobStatus


# ── fixtures ───────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def clear_session_store():
    """Wipe the in-memory session store before every test."""
    import app.core.session_store as store
    store._store.clear()
    yield
    store._store.clear()


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def fe_dir(tmp_path: Path):
    """A temporary directory containing two fake .fe files."""
    (tmp_path / "cube.fe").write_text("// cube")
    (tmp_path / "torus.fe").write_text("// torus")
    return tmp_path


_LOAD_STATS = {
    "energy": 1.5,
    "area": 6.0,
    "scale": 0.1,
    "vertex_count": 8,
    "edge_count": 12,
    "facet_count": 6,
}


# ── health ─────────────────────────────────────────────────────────────────────

def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


# ── /api/files ──────────────────────────────────────────────────────────────

def test_list_files_missing_dir(client):
    """If SE_FE_DIR does not exist the endpoint returns an empty list."""
    with patch("app.routers.files.settings") as mock_settings:
        mock_settings.se_fe_dir = "/nonexistent/path/xxx"
        r = client.get("/api/files")
    assert r.status_code == 200
    assert r.json() == []


def test_list_files(client, fe_dir):
    with patch("app.routers.files.settings") as mock_settings:
        mock_settings.se_fe_dir = str(fe_dir)
        r = client.get("/api/files")
    assert r.status_code == 200
    assert sorted(r.json()) == ["cube.fe", "torus.fe"]


# ── POST /api/sessions ──────────────────────────────────────────────────────

def test_create_session_file_not_found(client, fe_dir):
    with patch("app.routers.sessions.settings") as mock_settings, \
         patch("app.routers.sessions.se_manager") as mock_se:
        mock_settings.se_fe_dir = str(fe_dir)
        mock_settings.max_sessions = 10
        mock_se.is_busy.return_value = False
        r = client.post("/api/sessions", json={"fe_file": "missing.fe"})
    assert r.status_code == 404


def test_create_session_busy(client, fe_dir):
    with patch("app.routers.sessions.settings") as mock_settings, \
         patch("app.routers.sessions.se_manager") as mock_se:
        mock_settings.se_fe_dir = str(fe_dir)
        mock_settings.max_sessions = 10
        mock_se.is_busy.return_value = True
        r = client.post("/api/sessions", json={"fe_file": "cube.fe"})
    assert r.status_code == 409
    assert r.headers.get("retry-after") == "1"


def test_create_session_success(client, fe_dir):
    with patch("app.routers.sessions.settings") as mock_settings, \
         patch("app.routers.sessions.se_manager") as mock_se:
        mock_settings.se_fe_dir = str(fe_dir)
        mock_settings.max_sessions = 10
        mock_se.is_busy.return_value = False
        mock_se.load_session = AsyncMock(return_value=_LOAD_STATS)

        r = client.post("/api/sessions", json={"fe_file": "cube.fe"})

    assert r.status_code == 201
    body = r.json()
    assert body["fe_file"] == "cube.fe"
    assert body["energy"] == pytest.approx(1.5)
    assert body["vertex_count"] == 8
    assert "session_id" in body


# ── session CRUD ───────────────────────────────────────────────────────────────

def _seed_session(fe_dir, client) -> str:
    with patch("app.routers.sessions.settings") as mock_settings, \
         patch("app.routers.sessions.se_manager") as mock_se:
        mock_settings.se_fe_dir = str(fe_dir)
        mock_settings.max_sessions = 10
        mock_se.is_busy.return_value = False
        mock_se.load_session = AsyncMock(return_value=_LOAD_STATS)
        r = client.post("/api/sessions", json={"fe_file": "cube.fe"})
    assert r.status_code == 201
    return r.json()["session_id"]


def test_list_sessions(client, fe_dir):
    _seed_session(fe_dir, client)
    r = client.get("/api/sessions")
    assert r.status_code == 200
    assert len(r.json()) == 1


def test_get_session(client, fe_dir):
    sid = _seed_session(fe_dir, client)
    r = client.get(f"/api/sessions/{sid}")
    assert r.status_code == 200
    assert r.json()["session_id"] == sid


def test_get_session_not_found(client):
    r = client.get("/api/sessions/nonexistent-id")
    assert r.status_code == 404


def test_delete_session(client, fe_dir):
    sid = _seed_session(fe_dir, client)
    r = client.delete(f"/api/sessions/{sid}")
    assert r.status_code == 204
    assert client.get(f"/api/sessions/{sid}").status_code == 404


def test_delete_session_not_found(client):
    r = client.delete("/api/sessions/nonexistent-id")
    assert r.status_code == 404


# ── POST /api/sessions/{id}/run ────────────────────────────────────────────

def test_run_command_session_not_found(client):
    r = client.post("/api/sessions/bad-id/run", json={"command": "u"})
    assert r.status_code == 404


def test_run_command_busy(client, fe_dir):
    sid = _seed_session(fe_dir, client)
    with patch("app.routers.simulation.se_manager") as mock_se:
        mock_se.is_busy.return_value = True
        r = client.post(f"/api/sessions/{sid}/run", json={"command": "u"})
    assert r.status_code == 409


def test_run_command_success(client, fe_dir):
    sid = _seed_session(fe_dir, client)
    with patch("app.routers.simulation.se_manager") as mock_se:
        mock_se.is_busy.return_value = False
        mock_se.run_command = AsyncMock(return_value={
            "output": "Energy: 1.23\n",
            "energy": 1.23,
            "area": 5.9,
        })
        r = client.post(f"/api/sessions/{sid}/run", json={"command": "u"})
    assert r.status_code == 200
    body = r.json()
    assert "Energy" in body["output"]
    assert body["energy"] == pytest.approx(1.23)


def test_run_command_updates_session_stats(client, fe_dir):
    """After a successful run, GET /sessions/{id} reflects the new energy/area."""
    sid = _seed_session(fe_dir, client)
    with patch("app.routers.simulation.se_manager") as mock_se:
        mock_se.is_busy.return_value = False
        mock_se.run_command = AsyncMock(return_value={
            "output": "",
            "energy": 0.99,
            "area": 5.5,
        })
        client.post(f"/api/sessions/{sid}/run", json={"command": "u"})

    r = client.get(f"/api/sessions/{sid}")
    assert r.json()["energy"] == pytest.approx(0.99)
    assert r.json()["area"] == pytest.approx(5.5)


# ── GET /api/sessions/{id}/mesh ────────────────────────────────────────────

def test_get_mesh_success(client, fe_dir):
    sid = _seed_session(fe_dir, client)
    mesh = MeshData(
        vertices=[[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]],
        vertex_ids=[1, 2, 3, 4],
        facets=[[0, 1, 2], [0, 1, 3]],
        body_volumes={1: 0.166},
    )
    with patch("app.routers.simulation.se_manager") as mock_se:
        mock_se.is_busy.return_value = False
        mock_se.get_mesh = AsyncMock(return_value=mesh)
        r = client.get(f"/api/sessions/{sid}/mesh")
    assert r.status_code == 200
    body = r.json()
    assert len(body["vertices"]) == 4
    assert len(body["facets"]) == 2


# ── POST /api/sessions/{id}/iterate ────────────────────────────────────────

def test_iterate_returns_job(client, fe_dir):
    sid = _seed_session(fe_dir, client)
    with patch("app.routers.simulation.se_manager") as mock_se, \
         patch("app.core.job_runner.se_manager") as mock_jr_se:
        mock_se.is_busy.return_value = False
        # iterate_async never actually runs (task is background); just mock it
        mock_jr_se.iterate_async = AsyncMock(return_value={
            "steps_completed": 100,
            "energy_start": 1.5,
            "energy_end": 1.2,
        })
        mock_jr_se.clear_cancel = MagicMock()
        r = client.post(f"/api/sessions/{sid}/iterate", json={"steps": 100})
    assert r.status_code == 202
    body = r.json()
    assert body["session_id"] == sid
    assert body["steps_requested"] == 100
    assert body["status"] in ("queued", "running", "completed")
    assert "job_id" in body


def test_iterate_busy(client, fe_dir):
    sid = _seed_session(fe_dir, client)
    with patch("app.routers.simulation.se_manager") as mock_se:
        mock_se.is_busy.return_value = True
        r = client.post(f"/api/sessions/{sid}/iterate", json={"steps": 100})
    assert r.status_code == 409


# ── /api/jobs ──────────────────────────────────────────────────────────────

def test_get_job_not_found(client):
    r = client.get("/api/jobs/nonexistent-job")
    assert r.status_code == 404


def test_cancel_job_not_found(client):
    r = client.delete("/api/jobs/nonexistent-job")
    assert r.status_code == 404


def test_get_job_after_iterate(client, fe_dir):
    """A job submitted via /iterate should be retrievable by its job_id."""
    sid = _seed_session(fe_dir, client)
    with patch("app.routers.simulation.se_manager") as mock_se, \
         patch("app.core.job_runner.se_manager") as mock_jr_se:
        mock_se.is_busy.return_value = False
        mock_jr_se.iterate_async = AsyncMock(return_value={
            "steps_completed": 50,
            "energy_start": 1.5,
            "energy_end": 1.3,
        })
        mock_jr_se.clear_cancel = MagicMock()
        r = client.post(f"/api/sessions/{sid}/iterate", json={"steps": 50})

    job_id = r.json()["job_id"]
    r2 = client.get(f"/api/jobs/{job_id}")
    assert r2.status_code == 200
    assert r2.json()["job_id"] == job_id
