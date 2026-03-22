# Surface Evolver MVP — Implementation Checklist

## Step 0 — Documentation
- [x] Update `system-design.md` to reflect MVP scope

## Backend

- [ ] `backend/requirements.txt` + `backend/app/config.py`
- [ ] `backend/app/models/session.py`, `mesh.py`, `simulation.py`, `job.py`
- [ ] `backend/app/core/session_store.py`
- [ ] `backend/app/core/se_manager.py` ← most critical
- [ ] `backend/app/routers/files.py` + `sessions.py`
- [ ] `backend/app/core/job_runner.py` + `backend/app/ws/progress.py`
- [ ] `backend/app/routers/simulation.py` + `jobs.py`
- [ ] `backend/app/main.py`
- [ ] `backend/Dockerfile`

## Infrastructure

- [ ] `docker-compose.yml` + `docker-compose.dev.yml`

## Frontend

- [ ] Scaffold: `frontend/package.json`, `vite.config.ts`, `tsconfig.json`
- [ ] `frontend/src/api/` — `client.ts`, `files.ts`, `sessions.ts`, `simulation.ts`, `jobs.ts`
- [ ] `frontend/src/store/useStore.ts`
- [ ] `frontend/src/hooks/useProgressWS.ts` + `useMesh.ts`
- [ ] `frontend/src/components/FilePane/FilePane.tsx`
- [ ] `frontend/src/components/CliPane/CliPane.tsx` + `OutputLog.tsx`
- [ ] `frontend/src/components/ViewerPane/ViewerPane.tsx` + `MeshGeometry.tsx`
- [ ] `frontend/src/App.tsx` + `main.tsx`
- [ ] `frontend/Dockerfile` + `nginx.conf`
