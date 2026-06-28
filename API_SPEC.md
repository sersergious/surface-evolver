# Surface Evolver API Specification

> **Stage 1 deliverable.** Audits existing endpoints, maps C API coverage, and
> defines every new endpoint required for Stages 2–5.

---

## 1. Current HTTP Endpoints (server.ts)

All routes share the same CORS / Basic-auth / rate-limit middleware.

| # | Method | Path | Auth | Body / Params | Response | Status |
|---|--------|------|------|---------------|----------|--------|
| 1 | GET | `/health` | none | — | `{status:"ok"}` | 200 |
| 2 | GET | `/api/files` | yes | — | `string[]` (`.fe` filenames) | 200 |
| 3 | GET | `/api/sessions` | yes | — | `SessionState[]` | 200 |
| 4 | POST | `/api/sessions` | yes | `{fe_file:string}` | `SessionState` | 201 |
| 5 | GET | `/api/sessions/:id` | yes | — | `SessionState` | 200 |
| 6 | DELETE | `/api/sessions/:id` | yes | — | — | 204 |
| 7 | POST | `/api/sessions/:id/iterate` | yes | `{steps?:number}` | `JobResult` | 202 |
| 8 | POST | `/api/sessions/:id/run` | yes | `{command:string}` | `RunResult` | 200 |
| 9 | GET | `/api/sessions/:id/mesh` | yes | — | `MeshData` | 200 |
| 10 | GET | `/api/jobs/:id` | yes | — | `JobResult` | 200 |
| 11 | DELETE | `/api/jobs/:id` | yes | — | — | 204 |
| 12 | WS | `/api/ws/sessions/:id/progress` | none | — | `{type:"progress",step,total,energy}` | upgrade |

### Current Electrobun RPC handlers (index.ts)

Identical surface to the HTTP API; the client in `api/client.ts` maps HTTP-style
calls to the appropriate RPC name.

| RPC method | Maps to |
|---|---|
| `listFiles()` | `GET /api/files` |
| `createSession({fe_file})` | `POST /api/sessions` |
| `iterate({sessionId,steps?})` | `POST /api/sessions/:id/iterate` |
| `runCommand({sessionId,command})` | `POST /api/sessions/:id/run` |
| `getMesh({sessionId})` | `GET /api/sessions/:id/mesh` |

### Current schemas

```ts
interface SessionState {
  session_id:   string;
  fe_file:      string;
  energy:       number | null;
  area:         number | null;
  scale:        number | null;
  vertex_count: number | null;
  edge_count:   number | null;
  facet_count:  number | null;
  last_accessed: string; // ISO-8601
}

interface RunResult {
  ok:     true;
  output: string;
  energy: number;
  area:   number;
}

interface MeshData {
  ok:           true;
  vertices:     [number,number,number][];  // [x,y,z] per vertex
  vertex_ids:   number[];                 // 1-based SE ordinal
  facets:       [number,number,number][]; // 0-based indices into vertices[]
  body_volumes: Record<string,number>;    // body_id → volume
}

interface JobResult {
  job_id:          string;
  status:          "running" | "done" | "cancelled" | "error";
  steps_requested: number;
  steps_completed: number;
  energy_start:    number | null;
  energy_end:      number | null;
}
```

---

## 2. C API Coverage Audit

### se_api.h — complete function list

| Function | Signature | Exposed? | How |
|---|---|---|---|
| `se_init` | `int ()` | ✅ | worker init |
| `se_load` | `int (const char*)` | ✅ | `load` cmd |
| `se_run` | `int (const char*)` | ✅ | `run` cmd + iteration |
| `se_iterate` | `void (int)` | ⚠️ | unused; worker calls `se_run("g N")` |
| `se_get_energy` | `double ()` | ✅ | load, run, iterate |
| `se_get_area` | `double ()` | ✅ | load, run, iterate |
| `se_get_scale` | `double ()` | ✅ | load result |
| **`se_set_scale`** | `void (double)` | ❌ | not exposed |
| **`se_get_sdim`** | `int ()` | ❌ | not exposed |
| `se_get_vertex_count` | `int ()` | ✅ | load, mesh |
| `se_get_edge_count` | `int ()` | ✅ | load |
| `se_get_facet_count` | `int ()` | ✅ | load, mesh |
| `se_get_body_count` | `int ()` | ✅ | mesh |
| `se_get_vertices` | `int (double*,int)` | ✅ | mesh |
| `se_get_vertex_ids` | `int (int*,int)` | ✅ | mesh |
| `se_get_facets` | `int (int*,int)` | ✅ | mesh |
| `se_get_body_volumes` | `int (double*,double*,int)` | ⚠️ | volumes only; **pressures dropped** |
| `se_pop_output` | `int (char*,int)` | ✅ | run result |
| `se_pop_errout` | `int (char*,int)` | ✅ | error path |
| `se_last_error` | `const char* ()` | ✅ | error path |

### C API gaps to fill

1. **`se_set_scale`** — needed for `POST /api/sessions/:id/scale`
2. **`se_get_sdim`** — should be included in session stats
3. **Body pressures** — `se_get_body_volumes` collects them but worker discards them
4. **Per-vertex star area** — new C function needed for Stage 4 colormap:
   `int se_get_vertex_star_areas(double *out, int max_count)` — writes each
   vertex's share of incident facet area (sum of 1/3 × facet area for each
   incident facet). Proxy for per-vertex energy density.

---

## 3. New Endpoints — Stage 2

### 3.1 File upload

```
POST /api/files/upload
Content-Type: multipart/form-data
Field: file  (the .fe file binary)

201 Created
{
  "filename":     string,    // stored name inside fe/ dir
  "size_bytes":   number,
  "vertex_count": number | null,  // null if parse check skipped
  "renderable":   boolean         // passes isRenderable() check
}

400 if field missing, extension wrong, or file exceeds 5 MB
409 if a file with that name already exists (caller must rename)
```

RPC equivalent: `uploadFile({filename:string, content:string})` — base64 content,
decoded and written to `fe/` dir. Electrobun has no multipart support, so the RPC
path uses base64.

### 3.2 Mesh / state export (.dmp)

```
GET /api/sessions/:id/export/dmp

200 OK
Content-Type: application/json
Content-Disposition: attachment; filename="<fe_file_stem>_<timestamp>.dmp.json"

{
  "format":   "se-dmp-json-v1",
  "metadata": {
    "fe_file":       string,
    "energy":        number,
    "area":          number,
    "scale":         number,
    "sdim":          number,
    "vertex_count":  number,
    "edge_count":    number,
    "facet_count":   number,
    "body_count":    number,
    "exported_at":   string   // ISO-8601
  },
  "vertices":     [[x,y,z], ...],
  "vertex_ids":   [1, 2, ...],
  "facets":       [[i,j,k], ...],
  "body_volumes": { "1": number, ... },
  "body_pressures": { "1": number, ... }
}
```

RPC equivalent: `exportDmp({sessionId})` → same object (frontend triggers download).

### 3.3 .fe file download

```
GET /api/sessions/:id/export/fe

200 OK
Content-Type: text/plain
Content-Disposition: attachment; filename="<fe_file>"

<raw .fe file contents>
```

RPC equivalent: `exportFe({sessionId})` → `{filename:string, content:string}`.

### 3.4 Set scale factor

```
POST /api/sessions/:id/scale
{ "scale": number }

200 OK
{ "scale": number, "energy": number, "area": number }

400 if scale ≤ 0 or not a number
```

RPC equivalent: `setScale({sessionId, scale})`.

### 3.5 Session stats (extended)

Extend existing `GET /api/sessions/:id` response to include `sdim` and `body_pressures`:

```
GET /api/sessions/:id

200 OK
{
  ...SessionState,
  "sdim":           number,
  "body_pressures": Record<string,number>
}
```

---

## 4. New Endpoints — Stage 4 (Scalar Field / Colormap)

### 4.1 Scalar fields in scope

Two fields are implemented (others deferred to BACKLOG.md):

| ID | Name | Backend work | Source |
|---|---|---|---|
| `height` | Z-coordinate | **none** — already in `vertices[i][2]` | frontend only |
| `mean_curvature` | Discrete mean curvature H | new C function `se_get_vertex_mean_curvatures` | se_api.c |

#### New C function for mean curvature (se_api.c/h)

Uses the cotangent-Laplacian formula: for each vertex v_i, iterate incident
triangles, accumulate (cot α + cot β)(v_i − v_j) over opposite edges, divide by
2 × star_area. The signed magnitude gives mean curvature H.

```c
/* Compute discrete mean curvature H at each vertex using the cotangent-
 * Laplacian formula.  out[0..n-1] receives H values (signed, in surface units),
 * n = min(vertex_count, max_count).
 * Returns number of vertices written, or -1 on error / wrong representation.
 * Caller allocates: double out[max_count]. */
int se_get_vertex_mean_curvatures(double *out, int max_count);
```

### 4.2 Mesh endpoint extended with scalar field

```
GET /api/sessions/:id/mesh?scalars=height|mean_curvature|none

200 OK — MeshData extended:
{
  ...MeshData,
  "scalars": {
    "field":  "height" | "mean_curvature" | "none",
    "values": number[] | null,   // one per vertex, parallel to vertices[]
    "min":    number | null,
    "max":    number | null
  }
}
```

`?scalars=none` (default) → `values: null` (no change to current clients).
`?scalars=height` → computed on frontend from `vertices[i][2]`, no round-trip.
`?scalars=mean_curvature` → fills values from `se_get_vertex_mean_curvatures`.

RPC equivalent: `getMesh({sessionId, scalars?:"height"|"mean_curvature"|"none"})`.

---

## 5. New RPC Handlers Required (Electrobun path, index.ts)

| Handler | Params | Returns |
|---|---|---|
| `uploadFile` | `{filename,content}` (base64) | `{filename,size_bytes,renderable}` |
| `exportDmp` | `{sessionId}` | DmpExport object |
| `exportFe` | `{sessionId}` | `{filename,content}` |
| `setScale` | `{sessionId,scale}` | `{scale,energy,area}` |

Plus extend `getMesh` to accept `{sessionId, scalars?}`.

---

## 6. Worker Protocol Extensions (se-worker.ts)

New `cmd` values on stdin:

| cmd | Payload | stdout result |
|---|---|---|
| `set_scale` | `{scale:number}` | `{ok,scale,energy,area}` |
| `get_mean_curvatures` | `{}` | `{ok,values:number[],min,max}` |

The `mesh` cmd gains an optional `scalars` field:
```json
{"cmd":"mesh","scalars":"mean_curvature"}
```
When `scalars:"mean_curvature"` the result includes `{scalars:{field,values,min,max}}`.
When `scalars:"height"` the result is identical to plain `mesh` — the frontend
derives height from `vertices[i][2]` without a round-trip.

---

## 7. Implementation Order

| Stage | Items |
|---|---|
| **2a** | `se_set_scale` & `se_get_sdim` wired into worker |
| **2b** | `uploadFile` handler (server + RPC) |
| **2c** | `exportDmp` handler (server + RPC) |
| **2d** | `exportFe` handler (server + RPC) |
| **2e** | `setScale` endpoint (server + RPC) |
| **2f** | Extend session stats with `sdim` + pressures |
| **4a** | Add `se_get_vertex_star_areas` to se_api.c/h |
| **4b** | Wire `get_star_areas` worker cmd |
| **4c** | Extend `mesh` cmd with optional `scalars` field |
| **4d** | Extend HTTP + RPC mesh endpoint with `?scalars=` |
