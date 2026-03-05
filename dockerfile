FROM gcc:latest AS builder

RUN apt-get update && apt-get install -y \
    build-essential \
    libx11-dev \
    && rm -rf /var/lib/apt/lists/*
    

WORKDIR /app
COPY . .
RUN apt-get update && apt-get install -y  libx11-dev && apt-get clean && rm -rf /var/lib/apt/lists/*
RUN cd src && sed -i 's/^CFLAGS= -DGENERIC/CFLAGS= -DLINUX -DOOGL/' Makefile \
            && sed -i 's/^GRAPH= xgraph.o/GRAPH= xgraph.o/' Makefile \
            && sed -i 's/^GRAPHLIB= -lX11/GRAPHLIB= -lX11/' Makefile \
            && sed -i 's/^GRAPH_INCLUDE= xgraph.h/GRAPH_INCLUDE= xgraph.h/' Makefile \
            && sed -i 's/^GRAPH_LIBRARY= xgraph.o/GRAPH_LIBRARY= xgraph.o/' Makefile \
            && sed -i 's/^GRAPH_LIBRARY_PATH= \/usr\/local\/lib/GRAPH_LIBRARY_PATH= \/usr\/local\/lib/' Makefile \
            && make clean && make -f Makefile

FROM debian:trixie-slim
WORKDIR /app
RUN apt-get update && apt-get install -y libx11-6 && apt-get clean && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/src/evolver ./
COPY fe/ fe/
CMD ["./evolver", "./fe/cube.fe"]

