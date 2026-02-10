# Surfwace Evolver 

## Docker Instructions
    - First, build the program using Docker:
        ```
            docker build -t surface-evolver .
        ```
    - Run by executing the following:
        ```
            docker run -it --rm \ -e DISPLAY=host.docker.internal:0 \ -v /tmp/.X11-unix:/tmp/.X11-unix \ surface-evolver
        ```