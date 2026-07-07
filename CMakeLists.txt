cmake_minimum_required(VERSION 3.16)
project(surface_evolver C)

set(CMAKE_C_STANDARD 11)

# ── Build options ───────────────────────────────────────────────────────────
option(SE_HEADLESS "Build without X11 graphics (nulgraph)" OFF)

# ── Compiler flags ──────────────────────────────────────────────────────────
add_compile_options(-O3)
add_compile_definitions(GENERIC)

# ── Include paths ───────────────────────────────────────────────────────────
include_directories(engine/src)

# ── Source lists ────────────────────────────────────────────────────────────
set(SE_CORE_SOURCES
    engine/src/alloca.c
    engine/src/check.c
    engine/src/command.c
    engine/src/dump.c
    engine/src/eval_all.c
    engine/src/eval_sec.c
    engine/src/evalmore.c
    engine/src/evaltree.c
    engine/src/exprint.c
    engine/src/help.c
    engine/src/lexinit.c
    engine/src/lexinit2.c
    engine/src/lexyy.c
    engine/src/machine.c
    engine/src/modify.c
    engine/src/odrv.c
    engine/src/quantity.c
    engine/src/query.c
    engine/src/registry.c
    engine/src/sdrv.c
    engine/src/stringl.c
    engine/src/stringq.c
    engine/src/symtable.c
    engine/src/tmain.c
    engine/src/userfunc.c
    engine/src/userio.c
    engine/src/utility.c
    engine/src/variable.c
    engine/src/yexparse.c
    engine/src/ytab.c
)

set(SE_SURFACE_SOURCES
    engine/src/alice.c
    engine/src/bk.c
    engine/src/boundary.c
    engine/src/calcforc.c
    engine/src/cnstrnt.c
    engine/src/curtest.c
    engine/src/diffuse.c
    engine/src/dodecGroup.c
    engine/src/filml.c
    engine/src/filmq.c
    engine/src/fixvol.c
    engine/src/gauss.c
    engine/src/hessian.c
    engine/src/hessian2.c
    engine/src/hessian3.c
    engine/src/hidim.c
    engine/src/iterate.c
    engine/src/khyp.c
    engine/src/klein.c
    engine/src/knot1.c
    engine/src/knot2.c
    engine/src/knot3.c
    engine/src/kusner.c
    engine/src/lagrange.c
    engine/src/matrix.c
    engine/src/meanint.c
    engine/src/method1.c
    engine/src/method2.c
    engine/src/method3.c
    engine/src/method4.c
    engine/src/method5.c
    engine/src/metis.c
    engine/src/metric.c
    engine/src/mindeg.c
    engine/src/model.c
    engine/src/popfilm.c
    engine/src/quotient.c
    engine/src/simequi2.c
    engine/src/simplex.c
    engine/src/skeleton.c
    engine/src/sqcurve.c
    engine/src/sqcurve2.c
    engine/src/sqcurve3.c
    engine/src/storage.c
    engine/src/teix.c
    engine/src/tordup.c
    engine/src/torus.c
    engine/src/torvol.c
    engine/src/trirevis.c
    engine/src/veravg.c
    engine/src/verpopst.c
    engine/src/wulff.c
)

set(SE_GRAPHICS_COMMON
    engine/src/display.c
    engine/src/filgraph.c
    engine/src/geomgraph.c
    engine/src/grapher.c
    engine/src/graphgen.c
    engine/src/mvgraph.c
    engine/src/painter.c
    engine/src/pixgraph.c
    engine/src/psgraph.c
    engine/src/softimag.c
    engine/src/zoom.c
)

# ── Graphics backend ────────────────────────────────────────────────────────
if(SE_HEADLESS)
    set(SE_GRAPH_SOURCE engine/src/nulgraph.c)
    set(SE_GRAPH_LIBS "")
else()
    find_package(X11 REQUIRED)
    set(SE_GRAPH_SOURCE engine/src/xgraph.c)
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
    engine/src/nulgraph.c
    engine/src/psgraph.c
    engine/src/painter.c
    engine/src/geomgraph.c
    engine/bindings/c/se_api.c
)
target_include_directories(se PRIVATE engine/src engine/bindings/c)
target_link_libraries(se PRIVATE m)

# ── Tests ────────────────────────────────────────────────────────────────────
option(BUILD_TESTS "Build the test suite" ON)
if(BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()
