# tests/CMakeLists.txt
# ─────────────────────────────────────────────────────────────────────────────
# CTest integration for the Surface Evolver test suite.
# Included from the root CMakeLists.txt when BUILD_TESTS=ON.

# ── C API tests ──────────────────────────────────────────────────────────────

add_executable(test_se_api c/test_se_api.c)

target_include_directories(test_se_api PRIVATE
    ${CMAKE_SOURCE_DIR}/engine/src
    ${CMAKE_SOURCE_DIR}/engine/src/core
    ${CMAKE_SOURCE_DIR}/engine/bindings/c
)

target_link_libraries(test_se_api PRIVATE se m)

# Pass the absolute path to fe/ so the test can locate .fe datafiles
# regardless of where ctest is invoked from.
target_compile_definitions(test_se_api PRIVATE
    FE_DIR="${CMAKE_SOURCE_DIR}/fe"
)

# Windows has no rpath: a DLL is found next to the .exe or on PATH. Without
# this copy the test exits 0xc0000135 (STATUS_DLL_NOT_FOUND) before running.
if(WIN32)
    add_custom_command(TARGET test_se_api POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
                $<TARGET_FILE:se> $<TARGET_FILE_DIR:test_se_api>)
endif()

add_test(
    NAME    se_api_tests
    COMMAND test_se_api
)

# Give the test a generous timeout (SE loading can be slow on cold starts).
set_tests_properties(se_api_tests PROPERTIES TIMEOUT 120)
