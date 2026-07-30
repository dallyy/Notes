cmake_minimum_required(VERSION 3.14)
project(notes-server LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(server server.cpp)

target_include_directories(server PRIVATE ${CMAKE_SOURCE_DIR})

if(WIN32)
    target_link_libraries(server ws2_32)
endif()
