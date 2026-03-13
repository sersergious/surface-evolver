cmake_minimum_required(VERSION 3.16)
project(surface_evolver C)

set(CMAKE_C_STANDARD 11)

# ── Build options ───────────────────────────────────────────────────────────
option(SE_HEADLESS "Build without X11 graphics (nulgraph)" OFF)

# ── Compiler flags ──────────────────────────────────────────────────────────
add_compile_options(-O3)
add_compile_definitions(GENERIC)

# ── Include paths ───────────────────────────────────────────────────────────
include_directories(src src/core)

# ── Source lists ────────────────────────────────────────────────────────────
set(SE_CORE_SOURCES
    src/core/alloca.c
    src/core/check.c
    src/core/command.c
    src/core/dump.c
    src/core/eval_all.c
    src/core/eval_sec.c
    src/core/evalmore.c
    src/core/evaltree.c
    src/core/exprint.c
    src/core/help.c
    src/core/lexinit.c
    src/core/lexinit2.c
    src/core/lexyy.c
    src/core/machine.c
    src/core/modify.c
    src/core/odrv.c
    src/core/quantity.c
    src/core/query.c
    src/core/registry.c
    src/core/sdrv.c
    src/core/stringl.c
    src/core/stringq.c
    src/core/symtable.c
    src/core/tmain.c
    src/core/userfunc.c
    src/core/userio.c
    src/core/utility.c
    src/core/variable.c
    src/core/yexparse.c
    src/core/ytab.c
)

set(SE_SURFACE_SOURCES
    src/surface/alice.c
    src/surface/bk.c
    src/surface/boundary.c
    src/surface/calcforc.c
    src/surface/cnstrnt.c
    src/surface/curtest.c
    src/surface/diffuse.c
    src/surface/dodecGroup.c
    src/surface/filml.c
    src/surface/filmq.c
    src/surface/fixvol.c
    src/surface/gauss.c
    src/surface/hessian.c
    src/surface/hessian2.c
    src/surface/hessian3.c
    src/surface/hidim.c
    src/surface/iterate.c
    src/surface/khyp.c
    src/surface/klein.c
    src/surface/knot1.c
    src/surface/knot2.c
    src/surface/knot3.c
    src/surface/kusner.c
    src/surface/lagrange.c
    src/surface/matrix.c
    src/surface/meanint.c
    src/surface/method1.c
    src/surface/method2.c
    src/surface/method3.c
    src/surface/method4.c
    src/surface/method5.c
    src/surface/metis.c
    src/surface/metric.c
    src/surface/mindeg.c
    src/surface/model.c
    src/surface/popfilm.c
    src/surface/quotient.c
    src/surface/simequi2.c
    src/surface/simplex.c
    src/surface/skeleton.c
    src/surface/sqcurve.c
    src/surface/sqcurve2.c
    src/surface/sqcurve3.c
    src/surface/storage.c
    src/surface/teix.c
    src/surface/tordup.c
    src/surface/torus.c
    src/surface/torvol.c
    src/surface/trirevis.c
    src/surface/veravg.c
    src/surface/verpopst.c
    src/surface/wulff.c
)

set(SE_GRAPHICS_COMMON
    src/graphics/display.c
    src/graphics/filgraph.c
    src/graphics/geomgraph.c
    src/graphics/grapher.c
    src/graphics/graphgen.c
    src/graphics/mvgraph.c
    src/graphics/painter.c
    src/graphics/pixgraph.c
    src/graphics/psgraph.c
    src/graphics/softimag.c
    src/graphics/zoom.c
)

# ── Graphics backend ────────────────────────────────────────────────────────
if(SE_HEADLESS)
    set(SE_GRAPH_SOURCE src/graphics/nulgraph.c)
    set(SE_GRAPH_LIBS "")
else()
    find_package(X11 REQUIRED)
    set(SE_GRAPH_SOURCE src/graphics/xgraph.c)
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
    src/graphics/nulgraph.c
    bindings/c/se_api.c
)
target_include_directories(se PRIVATE src src/core bindings/c)
target_link_libraries(se PRIVATE m)

# ── Tests ────────────────────────────────────────────────────────────────────
option(BUILD_TESTS "Build the test suite" ON)
if(BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()
