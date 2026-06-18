# ── Stage 1: Build libse.so ──────────────────────────────────────────────────
FROM debian:bookworm-slim AS se-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        cmake \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY . .

RUN cmake -B build \
        -DCMAKE_BUILD_TYPE=Release \
        -DSE_HEADLESS=ON \
    && cmake --build build --parallel

# ── Stage 2: Bun runtime ─────────────────────────────────────────────────────
FROM oven/bun:1

WORKDIR /app

COPY --from=se-builder /build/build/libse.so /app/libse.so
COPY --from=se-builder /build/fe             /app/fe
RUN ln -sf /app/fe/OCTA.WLF /app/fe/octa.wlf

COPY app/backend-bun/package.json /app/package.json
RUN bun install --production

COPY app/backend-bun/src /app/src

ENV SE_LIB_PATH=/app/libse.so \
    SE_FE_DIR=/app/fe \
    EVOLVERPATH=/app/fe

EXPOSE 8000

CMD ["bun", "run", "/app/src/server.ts"]
