cmake_minimum_required(VERSION 3.14)
project(notes-server LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(server server.cpp)
set_target_properties(server PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${CMAKE_SOURCE_DIR})
set_target_properties(server PROPERTIES RUNTIME_OUTPUT_DIRECTORY_RELEASE ${CMAKE_SOURCE_DIR})
set_target_properties(server PROPERTIES RUNTIME_OUTPUT_DIRECTORY_DEBUG ${CMAKE_SOURCE_DIR})

target_include_directories(server PRIVATE ${CMAKE_SOURCE_DIR})

if(MSVC)
    target_compile_options(server PRIVATE /utf-8)
endif()

if(WIN32)
    target_link_libraries(server ws2_32)
endif()
