cmake_minimum_required(VERSION 3.16)
project(surface_evolver C)

set(CMAKE_C_STANDARD 11)

# ── Build options ───────────────────────────────────────────────────────────
option(SE_HEADLESS "Build without X11 graphics (nulgraph)" OFF)

# ── Compiler flags ──────────────────────────────────────────────────────────
add_compile_options(-O3)
add_compile_definitions(GENERIC)

# ── Include paths ───────────────────────────────────────────────────────────
include_directories(app/src app/src/core)

# ── Source lists ────────────────────────────────────────────────────────────
set(SE_CORE_SOURCES
    app/src/core/alloca.c
    app/src/core/check.c
    app/src/core/command.c
    app/src/core/dump.c
    app/src/core/eval_all.c
    app/src/core/eval_sec.c
    app/src/core/evalmore.c
    app/src/core/evaltree.c
    app/src/core/exprint.c
    app/src/core/help.c
    app/src/core/lexinit.c
    app/src/core/lexinit2.c
    app/src/core/lexyy.c
    app/src/core/machine.c
    app/src/core/modify.c
    app/src/core/odrv.c
    app/src/core/quantity.c
    app/src/core/query.c
    app/src/core/registry.c
    app/src/core/sdrv.c
    app/src/core/stringl.c
    app/src/core/stringq.c
    app/src/core/symtable.c
    app/src/core/tmain.c
    app/src/core/userfunc.c
    app/src/core/userio.c
    app/src/core/utility.c
    app/src/core/variable.c
    app/src/core/yexparse.c
    app/src/core/ytab.c
)

set(SE_SURFACE_SOURCES
    app/src/surface/alice.c
    app/src/surface/bk.c
    app/src/surface/boundary.c
    app/src/surface/calcforc.c
    app/src/surface/cnstrnt.c
    app/src/surface/curtest.c
    app/src/surface/diffuse.c
    app/src/surface/dodecGroup.c
    app/src/surface/filml.c
    app/src/surface/filmq.c
    app/src/surface/fixvol.c
    app/src/surface/gauss.c
    app/src/surface/hessian.c
    app/src/surface/hessian2.c
    app/src/surface/hessian3.c
    app/src/surface/hidim.c
    app/src/surface/iterate.c
    app/src/surface/khyp.c
    app/src/surface/klein.c
    app/src/surface/knot1.c
    app/src/surface/knot2.c
    app/src/surface/knot3.c
    app/src/surface/kusner.c
    app/src/surface/lagrange.c
    app/src/surface/matrix.c
    app/src/surface/meanint.c
    app/src/surface/method1.c
    app/src/surface/method2.c
    app/src/surface/method3.c
    app/src/surface/method4.c
    app/src/surface/method5.c
    app/src/surface/metis.c
    app/src/surface/metric.c
    app/src/surface/mindeg.c
    app/src/surface/model.c
    app/src/surface/popfilm.c
    app/src/surface/quotient.c
    app/src/surface/simequi2.c
    app/src/surface/simplex.c
    app/src/surface/skeleton.c
    app/src/surface/sqcurve.c
    app/src/surface/sqcurve2.c
    app/src/surface/sqcurve3.c
    app/src/surface/storage.c
    app/src/surface/teix.c
    app/src/surface/tordup.c
    app/src/surface/torus.c
    app/src/surface/torvol.c
    app/src/surface/trirevis.c
    app/src/surface/veravg.c
    app/src/surface/verpopst.c
    app/src/surface/wulff.c
)

set(SE_GRAPHICS_COMMON
    app/src/graphics/display.c
    app/src/graphics/filgraph.c
    app/src/graphics/geomgraph.c
    app/src/graphics/grapher.c
    app/src/graphics/graphgen.c
    app/src/graphics/mvgraph.c
    app/src/graphics/painter.c
    app/src/graphics/pixgraph.c
    app/src/graphics/psgraph.c
    app/src/graphics/softimag.c
    app/src/graphics/zoom.c
)

# ── Graphics backend ────────────────────────────────────────────────────────
if(SE_HEADLESS)
    set(SE_GRAPH_SOURCE app/src/graphics/nulgraph.c)
    set(SE_GRAPH_LIBS "")
else()
    find_package(X11 REQUIRED)
    set(SE_GRAPH_SOURCE app/src/graphics/xgraph.c)
    set(SE_GRAPH_LIBS X11::X11)
endif()

# ── Executable ──────────────────────────────────────────────────────────────
add_executable(surface_evolver
    ${SE_CORE_SOURCES}
    ${SE_SURFACE_SOURCES}
    ${SE_GRAPHICS_COMMON}
    ${SE_GRAPH_SOURCE}
)
target_link_libraries(surface_evolver PRIVATE m ${SE_GRAPH_LIBS})

# ── Shared library (libse) for Python / FFI bindings ────────────────────────
# Always built headless — library callers have no display.
add_library(se SHARED
    ${SE_CORE_SOURCES}
    ${SE_SURFACE_SOURCES}
    ${SE_GRAPHICS_COMMON}
    app/src/graphics/nulgraph.c
    app/bindings/c/se_api.c
)
target_include_directories(se PRIVATE app/src app/src/core app/bindings/c)
target_link_libraries(se PRIVATE m)

# ── Tests ────────────────────────────────────────────────────────────────────
option(BUILD_TESTS "Build the test suite" ON)
if(BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()
