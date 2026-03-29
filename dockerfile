# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        cmake \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

# Headless build: no X11 needed inside a container.
# Produces both surface_evolver and libse.so (Python/FFI bindings).
RUN cmake -B build \
        -DCMAKE_BUILD_TYPE=Release \
        -DSE_HEADLESS=ON \
    && cmake --build build --parallel

# ── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM debian:bookworm-slim

WORKDIR /app

COPY --from=builder /app/build/surface_evolver ./
COPY --from=builder /app/build/libse.so ./
COPY fe/ fe/

CMD ["./surface_evolver"]
