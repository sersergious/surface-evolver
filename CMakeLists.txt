cmake_minimum_required(VERSION 3.16)
project(surface_evolver C)

set(CMAKE_C_STANDARD 11)

# ── Build options ───────────────────────────────────────────────────────────
option(SE_HEADLESS "Build without X11 graphics (nulgraph)" OFF)

# ── Compiler flags ──────────────────────────────────────────────────────────
add_compile_options(-O3)
add_compile_definitions(GENERIC)

# ── Include paths ───────────────────────────────────────────────────────────
include_directories(engine/src engine/src/core)

# ── Source lists ────────────────────────────────────────────────────────────
set(SE_CORE_SOURCES
    engine/src/core/alloca.c
    engine/src/core/check.c
    engine/src/core/command.c
    engine/src/core/dump.c
    engine/src/core/eval_all.c
    engine/src/core/eval_sec.c
    engine/src/core/evalmore.c
    engine/src/core/evaltree.c
    engine/src/core/exprint.c
    engine/src/core/help.c
    engine/src/core/lexinit.c
    engine/src/core/lexinit2.c
    engine/src/core/lexyy.c
    engine/src/core/machine.c
    engine/src/core/modify.c
    engine/src/core/odrv.c
    engine/src/core/quantity.c
    engine/src/core/query.c
    engine/src/core/registry.c
    engine/src/core/sdrv.c
    engine/src/core/stringl.c
    engine/src/core/stringq.c
    engine/src/core/symtable.c
    engine/src/core/tmain.c
    engine/src/core/userfunc.c
    engine/src/core/userio.c
    engine/src/core/utility.c
    engine/src/core/variable.c
    engine/src/core/yexparse.c
    engine/src/core/ytab.c
)

set(SE_SURFACE_SOURCES
    engine/src/surface/alice.c
    engine/src/surface/bk.c
    engine/src/surface/boundary.c
    engine/src/surface/calcforc.c
    engine/src/surface/cnstrnt.c
    engine/src/surface/curtest.c
    engine/src/surface/diffuse.c
    engine/src/surface/dodecGroup.c
    engine/src/surface/filml.c
    engine/src/surface/filmq.c
    engine/src/surface/fixvol.c
    engine/src/surface/gauss.c
    engine/src/surface/hessian.c
    engine/src/surface/hessian2.c
    engine/src/surface/hessian3.c
    engine/src/surface/hidim.c
    engine/src/surface/iterate.c
    engine/src/surface/khyp.c
    engine/src/surface/klein.c
    engine/src/surface/knot1.c
    engine/src/surface/knot2.c
    engine/src/surface/knot3.c
    engine/src/surface/kusner.c
    engine/src/surface/lagrange.c
    engine/src/surface/matrix.c
    engine/src/surface/meanint.c
    engine/src/surface/method1.c
    engine/src/surface/method2.c
    engine/src/surface/method3.c
    engine/src/surface/method4.c
    engine/src/surface/method5.c
    engine/src/surface/metis.c
    engine/src/surface/metric.c
    engine/src/surface/mindeg.c
    engine/src/surface/model.c
    engine/src/surface/popfilm.c
    engine/src/surface/quotient.c
    engine/src/surface/simequi2.c
    engine/src/surface/simplex.c
    engine/src/surface/skeleton.c
    engine/src/surface/sqcurve.c
    engine/src/surface/sqcurve2.c
    engine/src/surface/sqcurve3.c
    engine/src/surface/storage.c
    engine/src/surface/teix.c
    engine/src/surface/tordup.c
    engine/src/surface/torus.c
    engine/src/surface/torvol.c
    engine/src/surface/trirevis.c
    engine/src/surface/veravg.c
    engine/src/surface/verpopst.c
    engine/src/surface/wulff.c
)

set(SE_GRAPHICS_COMMON
    engine/src/graphics/display.c
    engine/src/graphics/filgraph.c
    engine/src/graphics/geomgraph.c
    engine/src/graphics/grapher.c
    engine/src/graphics/graphgen.c
    engine/src/graphics/mvgraph.c
    engine/src/graphics/painter.c
    engine/src/graphics/pixgraph.c
    engine/src/graphics/psgraph.c
    engine/src/graphics/softimag.c
    engine/src/graphics/zoom.c
)

# ── Graphics backend ────────────────────────────────────────────────────────
if(SE_HEADLESS)
    set(SE_GRAPH_SOURCE engine/src/graphics/nulgraph.c)
    set(SE_GRAPH_LIBS "")
else()
    find_package(X11 REQUIRED)
    set(SE_GRAPH_SOURCE engine/src/graphics/xgraph.c)
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
    engine/src/graphics/nulgraph.c
    engine/src/graphics/psgraph.c
    engine/src/graphics/painter.c
    engine/src/graphics/geomgraph.c
    engine/bindings/c/se_api.c
)
target_include_directories(se PRIVATE engine/src engine/src/core engine/bindings/c)
target_link_libraries(se PRIVATE m)

# ── Tests ────────────────────────────────────────────────────────────────────
option(BUILD_TESTS "Build the test suite" ON)
if(BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()
