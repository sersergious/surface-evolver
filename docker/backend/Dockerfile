# ── Stage 1: Build libse.so ──────────────────────────────────────────────────
FROM debian:bookworm-slim AS se-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        cmake \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

RUN cmake -B build \
        -DCMAKE_BUILD_TYPE=Release \
        -DSE_HEADLESS=ON \
    && cmake --build build --parallel

# ── Stage 2: Python runtime ──────────────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

COPY --from=se-builder /app/build/libse.so /app/libse.so
COPY --from=se-builder /app/fe             /app/fe
RUN ln -sf /app/fe/OCTA.WLF /app/fe/octa.wlf

COPY app/backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/bindings/python /app/bindings/python
COPY app/backend/app     /app/app

ENV SE_LIB_PATH=/app/libse.so \
    SE_FE_DIR=/app/fe \
    EVOLVERPATH=/app/fe \
    PYTHONPATH=/app

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
