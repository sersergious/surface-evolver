# tests/CMakeLists.txt
# ─────────────────────────────────────────────────────────────────────────────
# CTest integration for the Surface Evolver test suite.
# Included from the root CMakeLists.txt when BUILD_TESTS=ON.

# ── C API tests ──────────────────────────────────────────────────────────────

add_executable(test_se_api c/test_se_api.c)

target_include_directories(test_se_api PRIVATE
    ${CMAKE_SOURCE_DIR}/src
    ${CMAKE_SOURCE_DIR}/src/core
    ${CMAKE_SOURCE_DIR}/bindings/c
)

target_link_libraries(test_se_api PRIVATE se m)

# Pass the absolute path to fe/ so the test can locate .fe datafiles
# regardless of where ctest is invoked from.
target_compile_definitions(test_se_api PRIVATE
    FE_DIR="${CMAKE_SOURCE_DIR}/fe"
)

add_test(
    NAME    se_api_tests
    COMMAND test_se_api
)

# Give the test a generous timeout (SE loading can be slow on cold starts).
set_tests_properties(se_api_tests PROPERTIES TIMEOUT 120)
