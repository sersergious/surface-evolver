# X11Docker Integration for Surface Evolver

This guide explains how to run Surface Evolver with X11 graphics support using x11docker and Docker Compose.

## Prerequisites

### For X11 Forwarding (Linux Only)

- Docker installed and running
- Docker Compose installed
- X11 server running on your host system
- x11docker installed (optional, for direct invocation)

```bash
# Install x11docker on Linux
wget https://raw.githubusercontent.com/mviereck/x11docker/master/x11docker -O x11docker
chmod +x x11docker
sudo mv x11docker /usr/local/bin/
```

### For macOS/Windows Users

X11Docker does not work on macOS or Windows directly. Instead, use the VNC-based approach documented below.

## Method 1: Docker Compose with X11 Forwarding (Linux)

### Setup

Before running the container, allow X11 connections from docker:

```bash
# Allow X11 socket access
xhost +local:docker
```

### Run with Docker Compose

```bash
# Build and run with X11 forwarding
docker-compose up

# Or run in background
docker-compose up -d
```

The container will:
1. Mount your X11 socket (`/tmp/.X11-unix`)
2. Share X11 authentication via `.Xauthority`
3. Run with your user ID/GID to avoid permission issues
4. Launch Surface Evolver directly on your X11 display

### Cleanup

```bash
docker-compose down
```

## Method 2: Direct x11docker Invocation (Linux)

If you prefer to use x11docker directly without Docker Compose:

```bash
# Build the image first
docker build -f dockerfile -t surface-evolver .

# Run with x11docker
x11docker --share $HOME/dev-projects/surface-evolver/fe surface-evolver ./evolver ./fe/cube.fe
```

### x11docker Options

- `--desktop`: Run with a desktop environment (fluxbox, openbox, etc.)
- `--share DIR`: Share a host directory read-write in container
- `--home`: Create persistent home directory in `~/.x11docker/imagename`
- `--gpu`: Enable GPU hardware acceleration
- See `x11docker --help` for more options

## Method 3: VNC/noVNC Fallback (Linux, macOS, Windows)

For headless servers or remote access via web browser, use the VNC-based docker-compose:

### Run with VNC

```bash
# Build and run with VNC stack
docker-compose -f docker-compose-vnc.yml up

# Or run in background
docker-compose -f docker-compose-vnc.yml up -d
```

### Access the GUI

Open your web browser and navigate to:
```
http://localhost:6080
```

Or connect with a VNC client:
```
vnc://localhost:5900
```

### Cleanup

```bash
docker-compose -f docker-compose-vnc.yml down
```

## Configuration

### Custom Display Resolution

Edit `docker-compose-vnc.yml` and change the Xvfb resolution:

```yaml
# In dockerfile.vnc, modify:
Xvfb :99 -screen 0 1920x1080x24 &  # Change 1280x720 to your desired resolution
```

### Custom FE File

Modify the command in either `docker-compose.yml` or `docker-compose-vnc.yml`:

```yaml
command: ["./evolver", "./fe/sphere.fe"]  # Change cube.fe to desired file
```

### Mount Additional Volumes

In `docker-compose.yml`, add to volumes section:

```yaml
volumes:
  - ./your_data:/app/your_data:rw
```

## Troubleshooting

### X11 socket permission denied (Linux)

```bash
# Grant docker access to X11
xhost +local:

# Or be more specific
xhost +local:docker
```

### XAUTHORITY issues

If you see `.Xauthority` errors, ensure the container user ID matches your host:

```bash
# Check your UID and GID
id -u  # UID
id -g  # GID

# Run docker-compose with your user ID
UID=$(id -u) GID=$(id -g) docker-compose up
```

### Container exits immediately

Check logs:

```bash
docker-compose logs surface-evolver
```

### Cannot connect to X11 on macOS

macOS does not support X11 natively. Use the VNC method instead:

```bash
docker-compose -f docker-compose-vnc.yml up
```

## Performance Considerations

- **X11 Forwarding**: Native performance on Linux, minimal overhead
- **VNC**: Suitable for remote access, slight latency and compression artifacts
- **x11docker**: Secure isolation with separate X server per container

## Security Notes

- X11 forwarding exposes X socket - only use on trusted networks
- VNC connections are unencrypted - consider SSH tunneling for remote access:

```bash
# SSH tunnel for VNC
ssh -L 5900:localhost:5900 user@remote-host
```

## References

- [x11docker GitHub](https://github.com/mviereck/x11docker)
- [Docker X11 Forwarding](https://docs.docker.com/engine/run/#ipc-settings---ipc)
- [Surface Evolver Documentation](./doc/)
