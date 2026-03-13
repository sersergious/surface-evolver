# Surfwace Evolver

## Docker Instructions

- First, build the program using Docker:
    ```dockerfile    
    docker build -t surface-evolver .
    ```
- Run by executing the following:
    ```
    docker run -it --rm \ -e DISPLAY=host.docker.internal:0 \ -v /tmp/.X11-unix:/tmp/.X11-unix \ surface-evolver
    ```

**Note:** Unless you're using Linux, you need need Xquartz to run the graphics

**TODO:**