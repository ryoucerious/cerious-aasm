# =============================================================================
# Cerious AASM — Linux Development & Testing Dockerfile
# =============================================================================
# Provides a Debian-based Linux environment with all dependencies needed to
# run, test, and debug the headless Electron app (xvfb + web server mode).
#
# Targets:
#   base    — System deps + Node.js + npm install (cached layer)
#   test    — Run jest electron tests in Linux
#   headless — Run the full headless Electron app with xvfb
# =============================================================================

# ---------------------------------------------------------------------------
# Stage: base — system dependencies + node modules
# ---------------------------------------------------------------------------
FROM node:22-bookworm AS base

# Avoid interactive prompts during apt-get
ENV DEBIAN_FRONTEND=noninteractive

# Install Electron runtime deps, xvfb (virtual display), and SteamCMD 32-bit libs
RUN dpkg --add-architecture i386 && apt-get update && apt-get install -y --no-install-recommends \
    # Core tools
    curl wget tar gzip unzip p7zip-full \
    # xvfb — required for headless Electron (Chromium needs a display)
    xvfb \
    # Electron / Chromium runtime dependencies
    libasound2 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
    libpango-1.0-0 libcairo2 libgtk-3-0 libx11-xcb1 libxss1 \
    # SteamCMD 32-bit dependencies
    libc6:i386 libstdc++6:i386 \
    # Useful for debugging
    procps htop strace \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user (Electron refuses to run as root without --no-sandbox)
RUN groupadd -r aasm && useradd -r -g aasm -m -d /home/aasm aasm

WORKDIR /app

# Copy package files first for layer caching
COPY package.json package-lock.json* ./

# Skip lifecycle scripts (electron-builder postinstall needs a display),
# then manually run Electron's own install script to download the binary.
RUN npm install --ignore-scripts \
    && node node_modules/electron/install.js \
    && npx electron-rebuild 2>/dev/null || true

# Copy the rest of the source code
COPY . .

# Ensure electron directory JS artifacts are clean (we compile from TS)
RUN find electron/ -name "*.js" -delete 2>/dev/null || true

# Compile TypeScript for the electron layer
RUN npx tsc -p tsconfig.electron.json

# Fix permissions
RUN chown -R aasm:aasm /app /home/aasm

# ---------------------------------------------------------------------------
# Stage: test — run electron-side jest tests in Linux
# ---------------------------------------------------------------------------
FROM base AS test

USER aasm

# Default: run electron tests
CMD ["npx", "jest", "--config", "jest.config.js", "--testPathPatterns", "\\.test\\.ts$", "--forceExit"]

# ---------------------------------------------------------------------------
# Stage: headless — run the full headless app via xvfb
# ---------------------------------------------------------------------------
FROM base AS headless

# Headless mode environment
ENV NODE_ENV=production
ENV DISPLAY=:99
ENV ELECTRON_DISABLE_SANDBOX=1

# Xvfb needs /tmp/.X11-unix — create it before dropping to non-root
RUN mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix

# Expose the web server port (default 3000)
EXPOSE 3000

USER aasm

# Data directory for server instances, configs, etc.
VOLUME ["/home/aasm/.local/share/cerious-aasm", "/home/aasm/.config/Cerious AASM"]

# Start xvfb, then launch the headless Electron app
# --no-sandbox is required in Docker (no user namespace support)
CMD ["sh", "-c", "Xvfb :99 -screen 0 1024x768x24 -nolisten tcp & sleep 1 && npx electron electron/main.js --headless --no-sandbox --disable-gpu --disable-dev-shm-usage --port=3000"]
